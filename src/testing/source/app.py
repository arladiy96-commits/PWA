"""Вагоны: standalone Telegram Mini App / JustRun server. Python 3.11+."""
from __future__ import annotations
import trash

import asyncio
import calendar
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import parse_qsl
from zoneinfo import ZoneInfo

import httpx
import xlsxwriter
from word_report import build_docx
from loader_report import build_loader_docx, build_stats_docx, build_person_docx, STAT_TITLES
import catalog_history
import contractor
import document_names
from auto_backup import BackupService
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse, Response, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, KeepTogether
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics

ROOT = Path(__file__).resolve().parent
BOT_TOKEN = os.getenv('BOT_TOKEN', '').strip()
ADMIN_TG_ID = int(os.getenv('ADMIN_TG_ID', '0'))
PUBLIC_URL = os.getenv('PUBLIC_URL', '').strip().rstrip('/')
DB_PATH = Path(os.getenv('DB_PATH', str(ROOT / 'data' / 'vagony.sqlite3')))
TZ = ZoneInfo('Asia/Almaty')
LOGGER = logging.getLogger('vagony')
logging.basicConfig(level=logging.INFO)
WEBHOOK_SECRET = hashlib.sha256((BOT_TOKEN + ':webhook:vagony').encode()).hexdigest() if BOT_TOKEN else ''

ROLES = {'admin', 'manager', 'wagon', 'storekeeper'}
STATUS = {'planned', 'progress', 'loaded'}
TRANSPORT = {'wagon', 'truck'}


def now():
    return datetime.now(TZ).isoformat(timespec='seconds')


def today():
    return datetime.now(TZ).date().isoformat()


@contextmanager
def db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA busy_timeout=20000')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def one(conn, sql, values=()):
    row = conn.execute(sql, values).fetchone()
    return dict(row) if row else None


def rows(conn, sql, values=()):
    return [dict(r) for r in conn.execute(sql, values).fetchall()]


def init_db():
    with db() as c:
        trash.init(c)
        seed_products=not c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='products'").fetchone()
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            tg_id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL DEFAULT 'pending', state TEXT NOT NULL DEFAULT 'pending',
            started INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS loaders (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS tariffs (
            transport TEXT NOT NULL, product_id INTEGER NOT NULL, rate TEXT NOT NULL,
            updated_at TEXT NOT NULL, updated_by INTEGER NOT NULL,
            PRIMARY KEY(transport, product_id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        );
        CREATE TABLE IF NOT EXISTS loads (
            id INTEGER PRIMARY KEY AUTOINCREMENT, transport TEXT NOT NULL,
            reference TEXT NOT NULL DEFAULT '', product_id INTEGER NOT NULL,
            tonnes TEXT NOT NULL, load_date TEXT NOT NULL, buyer TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'planned', created_by INTEGER NOT NULL, created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL, completed_at TEXT,
            rate_snapshot TEXT, total_cents INTEGER NOT NULL DEFAULT 0,
            deleted INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(product_id) REFERENCES products(id)
        );
        CREATE TABLE IF NOT EXISTS load_crew (
            load_id INTEGER NOT NULL, loader_id INTEGER NOT NULL,
            PRIMARY KEY(load_id, loader_id), FOREIGN KEY(load_id) REFERENCES loads(id),
            FOREIGN KEY(loader_id) REFERENCES loaders(id)
        );
        CREATE TABLE IF NOT EXISTS payouts (
            load_id INTEGER NOT NULL, loader_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL,
            PRIMARY KEY(load_id, loader_id), FOREIGN KEY(load_id) REFERENCES loads(id),
            FOREIGN KEY(loader_id) REFERENCES loaders(id)
        );
        CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT, actor INTEGER NOT NULL, action TEXT NOT NULL,
            entity TEXT NOT NULL, entity_id INTEGER NOT NULL, before_json TEXT,
            after_json TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tg_id INTEGER NOT NULL, kind TEXT NOT NULL,
            text TEXT NOT NULL, load_id INTEGER, created_at TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0, delivered_at TEXT, dead INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS load_requests (
            actor INTEGER NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
            load_id INTEGER NOT NULL REFERENCES loads(id), PRIMARY KEY(actor, request_id)
        );
        CREATE INDEX IF NOT EXISTS ix_loads_date ON loads(load_date, status, deleted);
        CREATE INDEX IF NOT EXISTS ix_notifications_pending ON notifications(delivered_at, dead, id);
        ''')
        if 'vehicle_kind' not in {r[1] for r in c.execute('PRAGMA table_info(loads)')}:
            c.execute("ALTER TABLE loads ADD COLUMN vehicle_kind TEXT NOT NULL DEFAULT 'fura'")
        columns = {r[1] for r in c.execute('PRAGMA table_info(tariffs)')}
        if 'rate_over20' not in columns:
            c.execute('ALTER TABLE tariffs ADD COLUMN rate_over20 TEXT')
            c.execute("UPDATE tariffs SET rate_over20=rate WHERE transport='truck'")
        migrate_daily_crews = not c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='daily_crews'").fetchone()
        c.executescript("""
        CREATE TABLE IF NOT EXISTS daily_crews (
          load_date TEXT PRIMARY KEY, crew_json TEXT NOT NULL,
          source_load_id INTEGER NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS statements (
          id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
          actor INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, snapshot TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS statement_lines (
          statement_id INTEGER NOT NULL REFERENCES statements(id),
          load_id INTEGER NOT NULL REFERENCES loads(id),
          loader_id INTEGER NOT NULL REFERENCES loaders(id), amount_cents INTEGER NOT NULL,
          PRIMARY KEY(statement_id,load_id,loader_id)
        );
        CREATE INDEX IF NOT EXISTS ix_statement_load ON statement_lines(load_id,loader_id);
        """)
        c.execute('CREATE TABLE IF NOT EXISTS notice_keys (key TEXT PRIMARY KEY)')
        if 'cancelled' not in {r[1] for r in c.execute('PRAGMA table_info(statements)')}:
            c.execute('ALTER TABLE statements ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0')
        contractor.init(c)
        for table in ['loaders','products']:
            if 'deleted' not in {r[1] for r in c.execute('PRAGMA table_info('+table+')')}:
                c.execute('ALTER TABLE '+table+' ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0')
        if migrate_daily_crews:
            # Reconstruct the first saved composition by audit order, not vehicle ID.
            load_dates = {}
            for event in rows(c, "SELECT * FROM audit WHERE entity='load' AND action IN ('load_created','load_updated','crew_updated') ORDER BY id"):
                data = json.loads(event['after_json'] or '{}')
                if data.get('load_date'):
                    load_dates[event['entity_id']] = data['load_date']
                day = load_dates.get(event['entity_id'])
                crew = data.get('crew')
                if day and crew:
                    c.execute('INSERT OR IGNORE INTO daily_crews VALUES(?,?,?,?)',
                              (day,json.dumps(sorted(set(crew))),event['entity_id'],event['created_at']))
        for name in (['Мука', 'Отруби'] if seed_products else []):
            c.execute('INSERT OR IGNORE INTO products(name) VALUES(?)', (name,))
        catalog_history.init(c)


def issue(code, message):
    raise HTTPException(status_code=code, detail=message)


def decimal_str(raw, field, max_value='100000000'):
    try:
        number = Decimal(str(raw).replace(',', '.'))
    except (InvalidOperation, TypeError, ValueError):
        issue(400, f'Некорректное значение: {field}')
    if not number.is_finite() or number <= 0 or number > Decimal(max_value) or number.as_tuple().exponent < -3:
        issue(400, f'{field}: значение должно быть положительным, максимум 3 знака после запятой')
    return format(number.normalize(), 'f')


def check_date(raw):
    try:
        return date.fromisoformat(str(raw)).isoformat()
    except (ValueError, TypeError):
        issue(400, 'Укажи корректную дату')


def cents_for(tonnes, rate):
    total = (Decimal(tonnes) * Decimal(rate) * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP)
    return int(total)


def auth_telegram(init_data):
    if not BOT_TOKEN:
        issue(503, 'BOT_TOKEN ещё не настроен на сервере')
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=True, max_num_fields=50))
        actual_hash = pairs.pop('hash')
        # Preserve 'signature': newer Telegram initData includes it in bot-token HMAC.
        if not re.fullmatch(r'[a-fA-F0-9]{64}', actual_hash):
            raise ValueError('hash')
        check = '\n'.join(f'{k}={v}' for k, v in sorted(pairs.items()))
        secret = hmac.new(b'WebAppData', BOT_TOKEN.encode(), hashlib.sha256).digest()
        expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(actual_hash.lower(), expected):
            raise ValueError('signature')
        auth_date = int(pairs['auth_date'])
        if auth_date > time.time() + 120 or time.time() - auth_date > 86400:
            raise ValueError('expired')
        user = json.loads(pairs['user'])
        uid = int(user['id'])
        if uid <= 0 or user.get('is_bot'):
            raise ValueError('user')
        name = (' '.join(x for x in [user.get('first_name', ''), user.get('last_name', '')] if x).strip() or 'Пользователь')[:120]
        username = (user.get('username') or '')[:80]
        return uid, name, username
    except Exception:
        issue(401, 'Недействительные данные Telegram. Открой приложение кнопкой из бота.')


def current_user(request: Request):
    init_data = request.headers.get('X-Telegram-Init-Data', '')
    uid, name, username = auth_telegram(init_data)
    stamp = now()
    with db() as c:
        old = one(c, 'SELECT * FROM users WHERE tg_id=?', (uid,))
        if not old:
            role = 'admin' if ADMIN_TG_ID and uid == ADMIN_TG_ID else 'pending'
            state = 'active' if role == 'admin' else 'pending'
            c.execute('INSERT INTO users(tg_id,name,username,role,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                      (uid, name, username, role, state, stamp, stamp))
            if role == 'pending' and ADMIN_TG_ID:
                queue_notice(c, [ADMIN_TG_ID], 'request', f'👤 Новая заявка: {name} (@{username or "нет ника"}). Открой раздел «Доступ».', None)
        else:
            role = 'admin' if ADMIN_TG_ID and uid == ADMIN_TG_ID else old['role']
            state = 'active' if role == 'admin' else old['state']
            c.execute('UPDATE users SET name=?,username=?,role=?,state=?,updated_at=? WHERE tg_id=?',
                      (name, username, role, state, stamp, uid))
        result = one(c, 'SELECT * FROM users WHERE tg_id=?', (uid,))
    return result


def active(user=Depends(current_user)):
    if user['state'] != 'active' or user['role'] not in ROLES:
        issue(403, 'Доступ пока не одобрен' if user['state'] == 'pending' else 'Доступ заблокирован')
    return user


def require(user, *roles):
    if user['role'] not in roles and user['role'] != 'admin':
        issue(403, 'Нет прав для этого действия')


def audit(c, user, action, entity, entity_id, before=None, after=None):
    if entity=='load' and after is not None:
        saved=one(c,'SELECT deleted FROM loads WHERE id=?',(entity_id,))
        if saved and not saved['deleted']:
            after={**after,**load_detail(c,entity_id)}
    c.execute('INSERT INTO audit(actor,action,entity,entity_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)',
              (user['tg_id'], action, entity, entity_id,
               json.dumps(before, ensure_ascii=False) if before is not None else None,
               json.dumps(after, ensure_ascii=False) if after is not None else None, now()))
    event_notices(c,user,action,entity,entity_id,before,after)


def queue_notice(c, ids, kind, text, load_id):
    for uid in set(ids):
        c.execute('INSERT INTO notifications(tg_id,kind,text,load_id,created_at) VALUES(?,?,?,?,?)',
                  (uid, kind, text, load_id, now()))


def notify_roles(c, roles, kind, text, load_id=None, except_tg=None):
    recipients = rows(c, 'SELECT tg_id FROM users WHERE state="active" AND started=1 AND role IN (' + ','.join('?' for _ in roles) + ')', tuple(roles))
    queue_notice(c, [r['tg_id'] for r in recipients if r['tg_id'] != except_tg], kind, text, load_id)


def policy_notice(c,roles,kind,text,load_id,actor,key=None):
    for recipient in rows(c,'SELECT tg_id FROM users WHERE state="active" AND started=1 AND role IN ('+','.join('?' for _ in roles)+')',roles):
        uid=recipient['tg_id']
        if uid==actor: continue
        if key and not c.execute('INSERT OR IGNORE INTO notice_keys VALUES(?)',(key+':'+str(uid),)).rowcount: continue
        previous=one(c,'SELECT id,text FROM notifications WHERE tg_id=? AND kind=? AND load_id IS ? AND delivered_at IS NULL AND dead=0 AND attempts=0 ORDER BY id DESC LIMIT 1',(uid,kind,load_id))
        if previous and kind in ('load_change','money_change'):
            text=previous['text']+'\n'+text if previous['text']!=text else text
            c.execute('UPDATE notifications SET text=?,created_at=? WHERE id=?',(text[-3900:],now(),previous['id']))
        else: queue_notice(c,[uid],kind,text,load_id)


def event_notices(c,user,action,entity,eid,before,after):
    actor=user['tg_id'];before=before or {};after=after or {}
    if action in ('statement_submitted','statement_resubmitted'):
        c.execute("UPDATE notifications SET dead=1 WHERE kind='after_statement' AND delivered_at IS NULL")
        return
    if action=='statement_cancelled':
        dates=sorted({x['load_date'] for x in before.get('loads',[])})
        policy_notice(c,['manager'],'money_change',f'↩️ Отменена сдача ведомости № {eid}\nПогрузки: '+(' — '.join([dates[0],dates[-1]]) if len(dates)>1 else ''.join(dates))+'\nВедомость на исправлении. Её состав сохранён отдельно для повторной сдачи.',None,actor)
        return
    if action=='tariff_updated':
        c.execute('DELETE FROM notice_keys WHERE key LIKE ?',(f'tariff:{eid}:{after["transport"]}:%',))
        c.execute("UPDATE notifications SET dead=1 WHERE kind='missing_tariff' AND delivered_at IS NULL AND load_id IN (SELECT id FROM loads WHERE product_id=? AND transport=?)",(eid,after['transport']))
        return
    if entity!='load': return
    obj=one(c,'SELECT l.*,COALESCE(l.product_name_snapshot,p.name) product_name FROM loads l JOIN products p ON p.id=l.product_id WHERE l.id=?',(eid,))
    if not obj:return
    name=transport_name(obj)+' № '+(obj['reference'] or str(eid))
    caption=f'{name} · {obj["load_date"]}'
    if action=='load_created':
        if obj['transport']=='wagon':
            policy_notice(c,['storekeeper'],'new_wagon',f'🚃 Новый {name}\n{obj["product_name"]} · {obj["tonnes"]} т · {obj["load_date"]}\nНазначь бригаду грузчиков.',eid,actor)
        last=one(c,'SELECT id,revision FROM statements WHERE cancelled=0 ORDER BY id DESC LIMIT 1')
        if last:policy_notice(c,['manager'],'after_statement','🚚 После сдачи ведомости появились новые погрузки.\nПроверь начисления перед следующей сдачей.',None,actor,'after_statement:'+str(last['id'])+':'+str(last['revision']))
        return
    if action=='status_updated' and after.get('status')=='loaded' and obj['transport']=='wagon':
        policy_notice(c,['wagon'],'wagon_completed',f'✅ Погрузка {name} завершена\n{obj["product_name"]} · {obj["tonnes"]} т · {obj["load_date"]}',eid,actor)
    changes=[]
    if action=='load_updated':
        for key,label in [('reference','Номер'),('tonnes','Вес, т'),('load_date','Дата'),('product_id','Продукция'),('buyer','Покупатель'),('vehicle_kind','Тип машины')]:
            if key in before and key in after and before[key]!=after[key]:
                old,new=before[key],after[key]
                if key=='product_id':
                    old=before.get('product_name',old);new=obj['product_name']
                changes.append(f'{label}: {old} → {new}')
    if action in ('crew_updated','load_updated','crew_member_deleted') and (before.get('crew')!=after.get('crew') or action=='crew_member_deleted'):
        crew=rows(c,'SELECT COALESCE((SELECT name FROM load_names WHERE load_id=q.load_id AND loader_id=x.id),x.name) name FROM load_crew q JOIN loaders x ON x.id=q.loader_id WHERE q.load_id=? ORDER BY name',(eid,))
        changes.append('Бригада: '+(', '.join(x['name'] for x in crew) if crew else 'снята. Нужно назначить грузчиков'))
    if action=='load_deleted':changes.append('Погрузка удалена')
    if before.get('status')=='loaded' and obj['status']!='loaded':changes.append('Завершение отменено. Статус: '+('Ожидает' if obj['status']=='planned' else 'В работе'))
    if changes:policy_notice(c,['storekeeper'],'load_change','✏️ '+caption+'\n'+'\n'.join(changes),None if obj['deleted'] else eid,actor)
    if action in ('load_updated','crew_updated','crew_member_deleted','status_updated','load_deleted'):
        paid=rows(c,'SELECT loader_id,SUM(amount_cents) amount FROM statement_lines WHERE load_id=? GROUP BY loader_id',(eid,))
        if paid:
            entries=[x for x in pending_statement(c,'0001-01-01','9999-12-31')['details'] if x['load_id']==eid]
            lines=[f'{x["loader_name"]}: {x["amount_cents"]/100:+,.2f} ₸' for x in entries]
            policy_notice(c,['manager'],'money_change','⚠️ Исправлена погрузка со сданными начислениями\n'+caption+'\n'+('Корректировка к сдаче:\n'+'\n'.join(lines) if lines else 'Остаток по этой погрузке: 0 ₸. Проверь обновлённые данные.'),None,actor)


def load_detail(c, load_id):
    obj = one(c, '''SELECT l.*,COALESCE(l.product_name_snapshot,p.name) AS product_name FROM loads l JOIN products p ON p.id=l.product_id
                     WHERE l.id=? AND l.deleted=0''', (load_id,))
    if not obj:
        issue(404, 'Погрузка не найдена')
    obj['crew'] = [r['loader_id'] for r in rows(c, 'SELECT loader_id FROM load_crew WHERE load_id=? ORDER BY loader_id', (load_id,))]
    obj['crew_names'] = [r['name'] for r in rows(c, '''SELECT COALESCE((SELECT name FROM load_names WHERE load_id=lc.load_id AND loader_id=x.id),x.name) name FROM loaders x JOIN load_crew lc ON lc.loader_id=x.id
                                            WHERE lc.load_id=? ORDER BY name''', (load_id,))]
    obj['crew_labels'] = {str(r['loader_id']):r['name'] for r in rows(c,'SELECT loader_id,name FROM load_names WHERE load_id=?',(load_id,))}
    obj['payouts']=rows(c,'SELECT loader_id,amount_cents FROM payouts WHERE load_id=? ORDER BY loader_id',(load_id,))
    obj['contractor']=one(c,'SELECT * FROM contractor_payouts WHERE load_id=?',(load_id,))
    return obj


def recompute(c, obj):
    crew = obj['crew']
    if not crew:
        issue(400, 'Нельзя завершить погрузку без назначенных грузчиков')
    if not obj['rate_snapshot']:
        rate = one(c, 'SELECT rate,rate_over20 FROM tariffs WHERE product_id=? AND transport=?',
                   (obj['product_id'], obj['transport']))
        if not rate:
            issue(400, 'Лев ещё не установил тариф для этой продукции и транспорта')
        use_rate = rate['rate_over20'] if obj['transport']=='truck' and Decimal(obj['tonnes'])>20 else rate['rate']
        if not use_rate: issue(400,'Установи тариф для машины свыше 20 тонн')
    else:
        use_rate = obj['rate_snapshot']
    contractor.sync(c, obj)
    # Wagon rates are a fixed crew payment per vehicle; trucks remain per tonne.
    total = cents_for('1' if obj['transport'] == 'wagon' else obj['tonnes'], use_rate)
    c.execute('DELETE FROM payouts WHERE load_id=?', (obj['id'],))
    unit, remainder = divmod(total, len(crew))
    for i, lid in enumerate(sorted(crew)):
        c.execute('INSERT INTO payouts(load_id,loader_id,amount_cents) VALUES(?,?,?)',
                  (obj['id'], lid, unit + (1 if i < remainder else 0)))
    c.execute('UPDATE loads SET rate_snapshot=?,total_cents=?,completed_at=COALESCE(completed_at,?) WHERE id=?',
              (use_rate, total, now(), obj['id']))


def transport_name(obj):
    return contractor.NAME if obj.get('is_contractor') else 'Вагон' if obj['transport'] == 'wagon' else ('КамАЗ' if obj.get('vehicle_kind') == 'kamaz' else 'Фура')


def parse_load(body, transport):
    vehicle_kind = body.get('vehicle_kind', 'fura') if transport == 'truck' else 'fura'
    if vehicle_kind not in ('fura', 'kamaz'):
        issue(400, 'Выбери тип машины: Фура или КамАЗ')
    ref = str(body.get('reference') or '').strip()[:80]
    if transport == 'wagon' and not ref:
        issue(400, 'Номер вагона обязателен')
    buyer = str(body.get('buyer') or '').strip()[:150]
    if not buyer:
        issue(400, 'Укажи покупателя')
    product_id = body.get('product_id')
    try:
        product_id = int(product_id)
    except (ValueError, TypeError):
        issue(400, 'Выбери продукцию')
    return {'transport': transport, 'vehicle_kind': vehicle_kind, 'reference': ref, 'product_id': product_id,
            'tonnes': decimal_str(body.get('tonnes'), 'Тоннаж', '100000'),
            'load_date': check_date(body.get('load_date') or today()),
            'buyer': buyer}


def parse_crew(c, crew, existing=()):
    if not isinstance(crew, list) or len(crew) > 150:
        issue(400, 'Некорректный список грузчиков')
    try:
        crew = list(dict.fromkeys(int(x) for x in crew))
    except (TypeError, ValueError):
        issue(400, 'Некорректный список грузчиков')
    if crew:
        vals = rows(c, 'SELECT id FROM loaders WHERE ((deleted=0 AND active=1) OR id IN (' + ','.join('?' for _ in existing) + ')) AND id IN (' + ','.join('?' for _ in crew) + ')', [*existing,*crew])
        if len(vals) != len(crew):
            issue(400, 'В списке есть неактивные или неизвестные грузчики')
    return crew


def remember_daily_crew(c, load_id, crew):
    if not crew:
        return
    day = one(c, 'SELECT load_date FROM loads WHERE id=?', (load_id,))['load_date']
    c.execute('INSERT OR IGNORE INTO daily_crews(load_date,crew_json,source_load_id,created_at) VALUES(?,?,?,?)',
              (day, json.dumps(sorted(set(crew))), load_id, now()))


def set_crew(c, load_id, crew):
    c.execute('DELETE FROM load_crew WHERE load_id=?', (load_id,))
    c.executemany('INSERT INTO load_crew(load_id,loader_id) VALUES(?,?)', [(load_id, lid) for lid in crew])
    if crew:
        remember_daily_crew(c, load_id, crew)
        c.execute("UPDATE loads SET status='progress',updated_at=? WHERE id=? AND status='planned'", (now(),load_id))
    else:
        c.execute("UPDATE loads SET status='planned',updated_at=? WHERE id=? AND status='progress'", (now(),load_id))


async def telegram(method, payload):
    if not BOT_TOKEN:
        return None
    async with httpx.AsyncClient(timeout=12) as client:
        result = await client.post(f'https://api.telegram.org/bot{BOT_TOKEN}/{method}', json=payload)
        result.raise_for_status()
        data = result.json()
        if not data.get('ok'):
            raise RuntimeError(f'Telegram {method}: {data.get("description")}')
        return data


async def dispatch_notifications():
    while True:
        try:
            await asyncio.sleep(12)
            with db() as c:
                pending = rows(c, '''SELECT * FROM notifications WHERE delivered_at IS NULL AND dead=0 AND attempts<6
                                      AND created_at<=? ORDER BY id LIMIT 120''',
                               (datetime.fromtimestamp(time.time()-60, TZ).isoformat(timespec='seconds'),))
            # Group rapid wagon additions and other same-event updates by recipient.
            grouped = {}
            for item in pending:
                grouped.setdefault((item['tg_id'], item['kind']), []).append(item)
            for (uid, kind), items in grouped.items():
                with db() as c:
                    recipient=one(c,'SELECT * FROM users WHERE tg_id=?',(uid,))
                    roles={'new_wagon':{'storekeeper'},'load_change':{'storekeeper'},'wagon_completed':{'wagon'},'after_statement':{'manager'},'money_change':{'manager'},'missing_tariff':{'manager'},'request':{'admin'}}
                    if not recipient or not recipient['started'] or (kind!='access' and (recipient['state']!='active' or recipient['role'] not in roles.get(kind,set()))):
                        c.executemany('UPDATE notifications SET dead=1 WHERE id=?',[(x['id'],) for x in items])
                        continue

                if kind == 'new_wagon' and len(items) > 1:
                    message = '🚂 Добавлено вагонов: ' + str(len(items)) + '\n' + '\n'.join(x['text'] for x in items[:10])
                    if len(items) > 10:
                        message += f'\n… и ещё {len(items)-10}'
                    link_id = None
                else:
                    message = '\n\n'.join(x['text'] for x in items[:4])
                    if len(items) > 4:
                        message += f'\n… и ещё {len(items)-4} событий'
                    link_id = items[0]['load_id'] if len(items) == 1 else None
                payload = {'chat_id': uid, 'text': message[:4000]}
                if PUBLIC_URL:
                    section='report' if kind in ('money_change','after_statement') else 'tariffs' if kind=='missing_tariff' else 'users' if kind=='request' else ''
                    url = PUBLIC_URL.rstrip('/') + ('/?section='+section if section else '/?load='+str(link_id) if link_id else '/')
                    payload['reply_markup'] = {'inline_keyboard': [[{'text': 'Открыть начисления' if section=='report' else 'Открыть тарифы' if section=='tariffs' else 'Открыть доступы' if section=='users' else 'Открыть погрузку' if link_id else 'Открыть приложение', 'web_app': {'url': url}}]]}
                try:
                    await telegram('sendMessage', payload)
                    with db() as c:
                        c.executemany('UPDATE notifications SET delivered_at=? WHERE id=?', [(now(), r['id']) for r in items])
                except Exception as e:
                    LOGGER.warning('Notification failed for %s: %s', uid, type(e).__name__)
                    with db() as c:
                        c.executemany('UPDATE notifications SET attempts=attempts+1, dead=CASE WHEN attempts>=5 THEN 1 ELSE 0 END WHERE id=?', [(r['id'],) for r in items])
        except asyncio.CancelledError:
            raise
        except Exception:
            LOGGER.exception('Notification loop failure')


async def configure_bot():
    if not (BOT_TOKEN and PUBLIC_URL and PUBLIC_URL.startswith('https://')):
        LOGGER.warning('Configure BOT_TOKEN and HTTPS PUBLIC_URL to enable bot messages')
        return
    try:
        await telegram('setWebhook', {'url': PUBLIC_URL+'/telegram/webhook', 'secret_token': WEBHOOK_SECRET,
                                     'allowed_updates': ['message']})
        await telegram('setChatMenuButton', {'menu_button': {'type': 'web_app', 'text': 'ГрузКонтроль', 'web_app': {'url': PUBLIC_URL}}})
        await telegram('setMyCommands', {'commands':[{'command':'start','description':'Открыть ГрузКонтроль'}, {'command':'id','description':'Мой Telegram ID'}]})
        LOGGER.info('Telegram webhook configured')
    except Exception:
        LOGGER.exception('Could not configure Telegram webhook')


@asynccontextmanager
async def lifespan(app):
    init_db()
    if not BOT_TOKEN or not ADMIN_TG_ID:
        LOGGER.warning('BOT_TOKEN / ADMIN_TG_ID missing: app not fully configured')
    await configure_bot()
    task = asyncio.create_task(dispatch_notifications())
    backup_task = None
    app.state.backup_service = None
    try:
        app.state.backup_service = BackupService(ROOT,DB_PATH,BOT_TOKEN,ADMIN_TG_ID)
        backup_task = asyncio.create_task(app.state.backup_service.run())
    except ValueError:
        LOGGER.error('Invalid backup configuration; check BACKUP_TIME and GITHUB_BACKUP_REPO')
    yield
    if backup_task:
        backup_task.cancel()
        try:
            await backup_task
        except asyncio.CancelledError:
            pass
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title='ГрузКонтроль', docs_url=None, redoc_url=None, lifespan=lifespan)
app.mount('/static', StaticFiles(directory=ROOT/'static'), name='static')


@app.get('/')
def index():
    html=(ROOT/'static'/'index.html').read_text(encoding='utf-8')
    def asset_version(match):
        path=match.group(1)
        file=(ROOT/path.lstrip('/')).resolve()
        if not file.is_relative_to((ROOT/'static').resolve()) or not file.is_file():
            return match.group(0)
        digest=hashlib.sha256(file.read_bytes()).hexdigest()[:16]
        return path+'?v='+digest
    html=re.sub(r'/static/[A-Za-z0-9_./-]+\.(?:js|css)(?:\?v=[A-Za-z0-9_-]+)?',
                lambda m:asset_version(re.match(r'([^?]+)(?:\?.*)?',m.group(0))),html)
    return HTMLResponse(html,headers={'Cache-Control':'no-store'})


@app.get('/healthz')
def health():
    try:
        with db() as c:
            c.execute('SELECT 1').fetchone()
        return {'ok':True, 'configured':bool(BOT_TOKEN and ADMIN_TG_ID and PUBLIC_URL)}
    except Exception:
        issue(503, 'Database unavailable')


@app.post('/telegram/webhook')
async def webhook(request: Request):
    if not WEBHOOK_SECRET or not secrets.compare_digest(request.headers.get('X-Telegram-Bot-Api-Secret-Token', ''), WEBHOOK_SECRET):
        issue(403, 'Forbidden')
    data = await request.json()
    msg = data.get('message') or {}
    chat = msg.get('chat') or {}
    sender = msg.get('from') or {}
    if chat.get('type') != 'private' or not sender.get('id'):
        return {'ok': True}
    uid = int(sender['id'])
    name = (' '.join(x for x in [sender.get('first_name',''), sender.get('last_name','')] if x) or 'Пользователь')[:120]
    username = (sender.get('username') or '')[:80]
    stamp = now()
    with db() as c:
        user = one(c, 'SELECT * FROM users WHERE tg_id=?', (uid,))
        if user:
            c.execute('UPDATE users SET started=1,name=?,username=?,updated_at=? WHERE tg_id=?', (name, username, stamp, uid))
        else:
            role = 'admin' if ADMIN_TG_ID and uid == ADMIN_TG_ID else 'pending'
            c.execute('INSERT INTO users(tg_id,name,username,role,state,started,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)',
                      (uid,name,username,role,'active' if role=='admin' else 'pending',stamp,stamp))
            if role == 'pending' and ADMIN_TG_ID:
                queue_notice(c, [ADMIN_TG_ID], 'request', f'👤 Новая заявка: {name} (@{username or "нет ника"}). Открой раздел «Доступ».', None)
    if (msg.get('text') or '').startswith(('/start','/id')):
        text = ('ГрузКонтроль\nВаш Telegram ID: '+str(uid) + '\n\nОткрой мини-приложение по кнопке ниже.\nЕсли ты новый сотрудник, администратор сначала подтвердит доступ.')
        payload = {'chat_id':uid,'text':text}
        if PUBLIC_URL:
            payload['reply_markup']={'inline_keyboard':[[{'text':'ГрузКонтроль','web_app':{'url':PUBLIC_URL}}]]}
        try:
            await telegram('sendMessage', payload)
        except Exception:
            LOGGER.exception('Could not reply to /start')
    return {'ok':True}


@app.get('/api/me')
def get_me(user=Depends(current_user)):
    return {'user':user,'today':today(),'is_admin':user['role']=='admin', 'app_ready':bool(BOT_TOKEN and PUBLIC_URL and ADMIN_TG_ID)}


@app.get('/api/events')
async def live_events(request:Request,user=Depends(active)):
    expires=int(dict(parse_qsl(request.headers.get('X-Telegram-Init-Data','')))['auth_date'])+86400
    # Committed audit IDs work across restarts and multiple server workers.
    async def stream():
        last=-1
        heartbeat=time.monotonic()
        while not await request.is_disconnected():
            with db() as c:
                version=one(c,'SELECT COALESCE(MAX(id),0) version FROM audit')['version']
                person=one(c,'SELECT role,state FROM users WHERE tg_id=?',(user['tg_id'],))
            if time.time()>expires or not person or person['state']!='active' or person['role']!=user['role']:
                yield 'event: access\ndata: {}\n\n'
                return
            if version!=last:
                yield f'event: change\nid: {version}\ndata: {{"version":{version}}}\n\n'
                last=version
            if time.monotonic()-heartbeat>=15:
                yield ': heartbeat\n\n'
                heartbeat=time.monotonic()
            await asyncio.sleep(0.3)
    return StreamingResponse(stream(),media_type='text/event-stream',headers={
        'Cache-Control':'no-cache, no-store','X-Accel-Buffering':'no'})


@app.get('/api/day-crew')
def day_crew(date:str, user=Depends(active)):
    require(user, 'storekeeper', 'manager')
    day = check_date(date)
    with db() as c:
        saved = one(c, 'SELECT * FROM daily_crews WHERE load_date=?', (day,))
        ids = json.loads(saved['crew_json']) if saved else []
        active_ids = {r['id'] for r in rows(c, 'SELECT id FROM loaders WHERE active=1')}
        crew = [lid for lid in ids if lid in active_ids]
        return {'date': day, 'crew': crew, 'exists': saved is not None}


@app.get('/api/bootstrap')
def bootstrap(user=Depends(active)):
    with db() as c:
        return {'products':rows(c,'SELECT * FROM products WHERE active=1 ORDER BY name'),
                'loaders':rows(c,'SELECT * FROM loaders WHERE active=1 ORDER BY name'),
                'contractor_rates':rows(c,'SELECT * FROM contractor_rates ORDER BY product_id'),
                'tariffs':rows(c,'''SELECT t.*,p.name AS product_name FROM tariffs t JOIN products p ON p.id=t.product_id ORDER BY p.name,t.transport''')}


@app.get('/api/buyers')
def buyer_suggestions(transport:str|None=None,user=Depends(active)):
    transport=transport or ('wagon' if user['role']=='wagon' else 'truck')
    if transport not in TRANSPORT: issue(400,'Выбери транспорт')
    if user['role']=='wagon' and transport!='wagon': issue(403,'Нет доступа')
    if user['role']=='storekeeper' and transport!='truck': issue(403,'Нет доступа')
    with db() as c:
        return [r['name'] for r in rows(c,'SELECT name FROM buyers WHERE transport=? AND deleted=0 ORDER BY name',(transport,))]


@app.get('/api/admin/buyers')
def admin_buyers(transport:str,user=Depends(active)):
    require(user,'admin')
    if transport not in TRANSPORT: issue(400,'Выбери транспорт')
    with db() as c:
        return rows(c,'SELECT id,name FROM buyers WHERE transport=? AND deleted=0 ORDER BY name',(transport,))


@app.patch('/api/admin/buyers/{bid}')
async def edit_buyer(bid:int,request:Request,user=Depends(active)):
    require(user,'admin');b=await request.json()
    name=catalog_history.buyer_name(b.get('name'))
    if not name: issue(400,'Укажи покупателя')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        old=one(c,'SELECT * FROM buyers WHERE id=? AND deleted=0',(bid,))
        if not old: issue(404,'Покупатель не найден')
        key=name.casefold()
        duplicate=one(c,'SELECT id FROM buyers WHERE transport=? AND name_key=? AND id!=?',(old['transport'],key,bid))
        if duplicate: issue(409,'Такой покупатель уже есть или был удалён. Выбери другое название.')
        if old['name_key']!=key:
            c.execute('INSERT OR IGNORE INTO buyer_blocked VALUES(?,?)',(old['transport'],old['name_key']))
        c.execute('DELETE FROM buyer_blocked WHERE transport=? AND name_key=?',(old['transport'],key))
        c.execute('UPDATE buyers SET name=?,name_key=? WHERE id=?',(name,key,bid))
        audit(c,user,'buyer_updated','buyer',bid,old,{'name':name})
    return {'ok':True}


@app.delete('/api/admin/buyers/{bid}')
def delete_buyer(bid:int,user=Depends(active)):
    require(user,'admin')
    with db() as c:
        old=one(c,'SELECT * FROM buyers WHERE id=? AND deleted=0',(bid,))
        if not old: issue(404,'Покупатель не найден')
        c.execute('UPDATE buyers SET deleted=1 WHERE id=?',(bid,))
        c.execute('INSERT OR IGNORE INTO buyer_blocked VALUES(?,?)',(old['transport'],old['name_key']))
        audit(c,user,'buyer_deleted','buyer',bid,old,None)
    return {'ok':True}


@app.get('/api/users')
def users(user=Depends(active)):
    require(user,'admin')
    with db() as c:
        return rows(c, 'SELECT tg_id,name,username,role,state,started,created_at FROM users ORDER BY CASE WHEN state="pending" THEN 0 ELSE 1 END, name')


@app.post('/api/users/{uid}/access')
async def access(uid:int, request:Request, user=Depends(active)):
    require(user,'admin')
    b = await request.json()
    role = str(b.get('role',''))
    state = str(b.get('state',''))
    if role not in {'wagon','storekeeper','manager'} or state not in {'active','blocked','denied'}:
        issue(400,'Выбери корректную роль и статус')
    if uid == ADMIN_TG_ID:
        issue(400,'Главного администратора нельзя изменить')
    with db() as c:
        old = one(c,'SELECT * FROM users WHERE tg_id=?',(uid,))
        if not old:
            issue(404,'Пользователь не найден')
        c.execute('UPDATE users SET role=?,state=?,updated_at=? WHERE tg_id=?',(role,state,now(),uid))
        audit(c,user,'access','user',uid,{'role':old['role'],'state':old['state']},{'role':role,'state':state})
        if (role,state)!=(old['role'],old['state']) and old['started']:
            role_label={'wagon':'Вагоны','storekeeper':'Заведующий складом','manager':'Отчёты и тарифы'}[role]
            text=('✅ Доступ открыт\nТвоя роль: '+role_label if old['state']!='active' else '🔄 Твоя роль изменена\nНовая роль: '+role_label) if state=='active' else ('Доступ к приложению приостановлен. Обратись к администратору.' if state=='blocked' else 'Заявка на доступ отклонена. Если это ошибка, обратись к администратору.')
            queue_notice(c,[uid],'access',text,None)
    return {'ok':True}


@app.get('/api/products')
def products(user=Depends(active)):
    with db() as c:
        return rows(c, 'SELECT * FROM products WHERE deleted=0 ORDER BY active DESC,name')


@app.post('/api/products')
async def create_product(request:Request,user=Depends(active)):
    require(user,'manager')
    b=await request.json(); name=str(b.get('name','')).strip()[:100]
    if not name:
        issue(400,'Введи название продукции')
    with db() as c:
        existing=one(c,'SELECT id,active FROM products WHERE name=?',(name,))
        if existing:
            c.execute('UPDATE products SET active=1,deleted=0 WHERE id=?',(existing['id'],))
            pk=existing['id']
        else:
            pk=c.execute('INSERT INTO products(name) VALUES(?)',(name,)).lastrowid
        audit(c,user,'product_saved','product',pk,None,{'name':name})
    return {'id':pk}


@app.post('/api/products/{pid}/archive')
def archive_product(pid:int,user=Depends(active)):
    require(user,'manager')
    with db() as c:
        old=one(c,'SELECT * FROM products WHERE id=?',(pid,))
        if not old: issue(404,'Продукция не найдена')
        c.execute('UPDATE products SET active=0 WHERE id=?',(pid,))
        audit(c,user,'product_archived','product',pid,old,None)
    return {'ok':True}


@app.get('/api/loaders')
def get_loaders(user=Depends(active)):
    with db() as c:
        return rows(c,'SELECT * FROM loaders WHERE deleted=0 ORDER BY active DESC,name')


@app.post('/api/loaders')
async def add_loader(request:Request,user=Depends(active)):
    require(user,'manager','storekeeper')
    b=await request.json(); name=str(b.get('name','')).strip()[:120]
    if not name:
        issue(400,'Укажи имя грузчика')
    with db() as c:
        pk=c.execute('INSERT INTO loaders(name,created_at) VALUES(?,?)',(name,now())).lastrowid
        audit(c,user,'loader_created','loader',pk,None,{'name':name})
    return {'id':pk}


@app.patch('/api/loaders/{lid}')
async def edit_loader(lid:int,request:Request,user=Depends(active)):
    require(user,'manager')
    b=await request.json()
    with db() as c:
        old=one(c,'SELECT * FROM loaders WHERE id=?',(lid,))
        if not old: issue(404,'Грузчик не найден')
        name=str(b.get('name',old['name'])).strip()[:120]
        active_flag=int(bool(b.get('active',old['active'])))
        if not name: issue(400,'Укажи имя')
        c.execute('UPDATE loaders SET name=?,active=? WHERE id=?',(name,active_flag,lid))
        audit(c,user,'loader_updated','loader',lid,old,{'name':name,'active':active_flag})
    return {'ok':True}


@app.put('/api/tariffs')
async def update_tariff(request:Request,user=Depends(active)):
    require(user,'manager')
    b=await request.json(); transport=str(b.get('transport','')); pid=int(b.get('product_id',0))
    if transport not in TRANSPORT:
        issue(400,'Некорректный транспорт')
    rate=decimal_str(b.get('rate'),'Тариф', '1000000')
    high=decimal_str(b['rate_over20'],'Тариф свыше 20 т','1000000') if transport=='truck' and b.get('rate_over20') else None
    with db() as c:
        if not one(c,'SELECT id FROM products WHERE id=?',(pid,)):
            issue(404,'Продукция не найдена')
        old=one(c,'SELECT * FROM tariffs WHERE transport=? AND product_id=?',(transport,pid))
        c.execute('''INSERT INTO tariffs(transport,product_id,rate,updated_at,updated_by) VALUES(?,?,?,?,?)
                    ON CONFLICT(transport,product_id) DO UPDATE SET rate=excluded.rate,updated_at=excluded.updated_at,updated_by=excluded.updated_by''',
                  (transport,pid,rate,now(),user['tg_id']))
        if transport=='truck':
            high = high or (old.get('rate_over20') if old else None) or rate
            c.execute('UPDATE tariffs SET rate_over20=? WHERE transport=? AND product_id=?',(high,transport,pid))
        audit(c,user,'tariff_updated','product',pid,old,{'transport':transport,'rate':rate,'rate_over20':high})
    return {'ok':True}


@app.get('/api/loads')
def list_loads(start:str|None=None,end:str|None=None,transport:str|None=None,status:str|None=None,
               search:str|None=None,user=Depends(active)):
    start=check_date(start or today()); end=check_date(end or start)
    if start>end: issue(400,'Некорректный период')
    where=['l.deleted=0','l.load_date BETWEEN ? AND ?']; params=[start,end]
    if transport in TRANSPORT: where.append('l.transport=?'); params.append(transport)
    if status in STATUS: where.append('l.status=?'); params.append(status)
    if search: where.append('(l.reference LIKE ? OR COALESCE(l.product_name_snapshot,p.name) LIKE ? OR l.buyer LIKE ?)'); params += [f'%{search.strip()[:80]}%']*3
    with db() as c:
        items=rows(c,'''SELECT l.*,COALESCE(l.product_name_snapshot,p.name) AS product_name,(SELECT COUNT(*) FROM load_crew q WHERE q.load_id=l.id) AS crew_count
                      FROM loads l JOIN products p ON p.id=l.product_id WHERE '''+' AND '.join(where)+''' ORDER BY
                      CASE WHEN l.status='loaded' THEN 1 ELSE 0 END, l.load_date DESC, l.id DESC LIMIT 1000''',params)
        return items


@app.get('/api/overdue-loads')
def overdue_loads(user=Depends(active)):
    with db() as c:
        return rows(c,"""SELECT l.id,l.transport,l.vehicle_kind,l.reference,l.buyer,l.load_date,l.tonnes,l.status,
                 COALESCE(l.product_name_snapshot,p.name) product_name FROM loads l JOIN products p ON p.id=l.product_id
                 WHERE l.deleted=0 AND l.status IN ('planned','progress') AND l.load_date<?
                 AND (?!='wagon' OR l.transport='wagon') ORDER BY l.load_date,l.id""",(today(),user['role']))


@app.get('/api/warehouse-stats')
def warehouse_stats(start: str, end: str, transport: str = 'all', user=Depends(active)):
    require(user, 'storekeeper', 'manager')
    start, end = check_date(start), check_date(end)
    if start > end: issue(400, 'Начало периода позже окончания')
    if transport not in ('all', 'wagon', 'truck'): issue(400, 'Некорректный транспорт')
    with db() as c:
        items = rows(c, """SELECT l.load_date,l.transport,l.status,l.tonnes,
          EXISTS(SELECT 1 FROM load_crew q WHERE q.load_id=l.id) AS has_crew
          FROM loads l WHERE l.deleted=0 AND l.load_date BETWEEN ? AND ?
          AND (?='all' OR l.transport=?) ORDER BY l.load_date DESC""", (start,end,transport,transport))
    def blank():
        return dict(total=0,loaded=0,planned=0,progress=0,no_crew=0,wagons=0,trucks=0,tonnes_loaded=Decimal(0))
    totals, days = blank(), {}
    for item in items:
        day = days.setdefault(item['load_date'], blank())
        for target in (totals, day):
            target['total'] += 1
            target[item['status']] += 1
            if item['status']=='loaded':
                target['tonnes_loaded'] += Decimal(item['tonnes'])
                target['wagons' if item['transport']=='wagon' else 'trucks'] += 1
            elif not item['has_crew']:
                target['no_crew'] += 1
    for target in [totals, *days.values()]:
        target['tonnes_loaded'] = format(target['tonnes_loaded'], '.3f')
    return dict(start=start,end=end,transport=transport,totals=totals,
                days=[dict(date=day,**values) for day,values in days.items()])


@app.get('/api/manager-stats')
def manager_stats(start:str,end:str,transport:str='all',user=Depends(active)):
    require(user,'manager')
    start=check_date(start);end=check_date(end)
    if start>end: issue(400,'Начало периода позже окончания')
    if transport not in ('all','wagon','truck'): issue(400,'Некорректный транспорт')
    with db() as c:
        items=rows(c,"""SELECT l.*,COALESCE(l.product_name_snapshot,p.name) product_name FROM loads l JOIN products p ON p.id=l.product_id
          WHERE l.deleted=0 AND l.load_date BETWEEN ? AND ? AND (?='all' OR l.transport=?)
          ORDER BY l.load_date DESC,l.id""",(start,end,transport,transport))
        paid=one(c,"""SELECT COALESCE(SUM(s.amount_cents),0) amount FROM statement_lines s JOIN loads l ON l.id=s.load_id
          WHERE l.load_date BETWEEN ? AND ? AND (?='all' OR l.transport=?)""",(start,end,transport,transport))['amount']
        people=rows(c,"""SELECT x.id loader_id,COALESCE((SELECT name FROM load_names WHERE load_id=l.id AND loader_id=x.id),x.name) name,COUNT(*) loads,SUM(p.amount_cents) amount_cents FROM payouts p
          JOIN loaders x ON x.id=p.loader_id JOIN loads l ON l.id=p.load_id
          WHERE l.deleted=0 AND l.status='loaded' AND l.load_date BETWEEN ? AND ? AND (?='all' OR l.transport=?)
          GROUP BY x.id ORDER BY amount_cents DESC,name""",(start,end,transport,transport))
        known={p['loader_id'] for p in people}
        for p in rows(c,'''SELECT DISTINCT x.id loader_id,x.name FROM statement_lines s
          JOIN loads l ON l.id=s.load_id JOIN loaders x ON x.id=s.loader_id
          WHERE l.load_date BETWEEN ? AND ? AND (?='all' OR l.transport=?)''',(start,end,transport,transport)):
            if p['loader_id'] not in known:people.append({**p,'loads':0,'amount_cents':0})
        if transport!='truck':
            extra=contractor.entries(c,start,end)
            by_load={x['load_id']:x['earned_cents'] for x in extra}
            for x in items:x['total_cents']+=by_load.get(x['id'],0)
            paid+=sum(x['paid_cents'] for x in extra)
            if extra:people.append({'loader_id':contractor.PERSON_ID,'name':contractor.NAME,'loads':sum(x['earned_cents']>0 for x in extra),'amount_cents':sum(x['earned_cents'] for x in extra)})
    def blank():return dict(total=0,loaded=0,planned=0,progress=0,tonnes=Decimal(0),amount_cents=0)
    totals=blank(); types={'wagon':blank(),'truck':blank()};products={};days={}
    for x in items:
        prod=products.setdefault(x['product_id'],dict(name=x['product_name'],**blank()))
        day=days.setdefault(x['load_date'],dict(date=x['load_date'],**blank()))
        for target in [totals,types[x['transport']],prod,day]:
            target['total']+=1;target[x['status']]+=1
            if x['status']=='loaded':target['tonnes']+=Decimal(x['tonnes']);target['amount_cents']+=x['total_cents']
    for t in [totals,*types.values(),*products.values(),*days.values()]:
        t['cost_per_tonne_cents']=int(Decimal(t['amount_cents'])/t['tonnes']) if t['tonnes'] else 0
        t['tonnes']=str(t['tonnes'])
    return dict(start=start,end=end,totals=totals,transport=types,products=list(products.values()),days=list(days.values()),people=people,
      paid_cents=paid,balance_cents=totals['amount_cents']-paid)


@app.get('/api/manager-stats/export/{section}')
def export_stats_section(section:str,start:str,end:str,transport:str='all',user=Depends(active)):
    require(user,'manager')
    if section not in STAT_TITLES: issue(400,'Неизвестный раздел статистики')
    stats=manager_stats(start,end,transport,user)
    contents=build_stats_docx(stats,section,transport)
    return Response(contents,media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      headers={'Content-Disposition':document_names.disposition(f'{STAT_TITLES[section]}_{start}_{end}_{transport}.docx'),'Cache-Control':'private, no-store'})


@app.get('/api/wagon-journal')
def wagon_journal(month: str | None = None, user=Depends(active)):
    """Сводка Максима по дате погрузки без ограничения /api/loads в 1000 строк.

    Тоннаж считаем в целых тысячных долях тонны: исходный вес хранится
    как TEXT с точностью до 0.001 т, а floating-point SUM даст погрешность.
    """
    require(user, 'wagon')
    month = month or today()[:7]
    if not re.fullmatch(r'[0-9]{4}-(?:0[1-9]|1[0-2])', month):
        issue(400, 'Укажи месяц в формате ГГГГ-ММ')
    try:
        year, number = map(int, month.split('-'))
        if not 1 <= year <= 9999: issue(400, 'Некорректный месяц')
        last_day = calendar.monthrange(year, number)[1]
    except ValueError:
        issue(400, 'Некорректный месяц')
    first, last = month + '-01', f'{month}-{last_day:02d}'
    with db() as c:
        grouped = rows(c, '''
          SELECT load_date AS date, COUNT(*) AS total,
            SUM(CASE WHEN status='loaded' THEN 1 ELSE 0 END) AS loaded,
            SUM(CASE WHEN status='progress' THEN 1 ELSE 0 END) AS progress,
            SUM(CASE WHEN status='loaded'
              THEN CAST(ROUND(CAST(tonnes AS REAL)*1000) AS INTEGER)
              ELSE 0 END) AS loaded_millitons
          FROM loads
          WHERE transport='wagon' AND deleted=0 AND load_date BETWEEN ? AND ?
          GROUP BY load_date ORDER BY load_date DESC
        ''', (first, last))
    days = []
    for record in grouped:
        loaded = record['loaded']
        days.append({
            'date': record['date'], 'total': record['total'],
            'loaded': loaded, 'progress': record['progress'],
            'remaining': record['total']-loaded,
            'tonnes_loaded': format(Decimal(record['loaded_millitons']) / 1000, '.3f'),
        })
    return {
        'month': month, 'start': first, 'end': last,
        'total': sum(r['total'] for r in days),
        'loaded': sum(r['loaded'] for r in days),
        'remaining': sum(r['remaining'] for r in days),
        'progress': sum(r['progress'] for r in days),
        'tonnes_loaded': format(sum((Decimal(r['tonnes_loaded']) for r in days), Decimal('0')), '.3f'),
        'days': days,
    }


@app.get('/api/loads/{load_id}')
def get_load(load_id:int,user=Depends(active)):
    with db() as c:
        return load_detail(c,load_id)


@app.post('/api/loads')
async def create_load(request:Request,user=Depends(active)):
    b=await request.json(); transport=str(b.get('transport',''))
    if transport not in TRANSPORT: issue(400,'Тип погрузки не определён')
    require(user,'wagon' if transport=='wagon' else 'storekeeper','manager')
    fields=parse_load(b,transport)
    request_id=str(b.get('_request_id',''))
    if request_id and not re.fullmatch(r'[A-Za-z0-9_-]{16,80}',request_id):
        issue(400,'Обнови мини-приложение и повтори сохранение')
    payload_hash=hashlib.sha256(json.dumps({**fields,'crew':b.get('crew',[]) if transport=='truck' or user['role']=='admin' else []},sort_keys=True).encode()).hexdigest()
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        previous=one(c,'SELECT * FROM load_requests WHERE actor=? AND request_id=?',(user['tg_id'],request_id))
        if request_id and previous:
            if previous['payload_hash']!=payload_hash: issue(409,'Состав повторного запроса изменился. Открой новую форму.')
            return {'id':previous['load_id']}
        if not one(c,'SELECT id FROM products WHERE id=? AND active=1',(fields['product_id'],)):
            issue(400,'Продукция не найдена или архивирована')
        crew=parse_crew(c,b.get('crew',[])) if transport=='truck' or user['role']=='admin' else []
        stamp=now()
        pk=c.execute('''INSERT INTO loads(transport,reference,product_id,tonnes,load_date,buyer,vehicle_kind,status,created_by,created_at,updated_at)
                         VALUES(:transport,:reference,:product_id,:tonnes,:load_date,:buyer,:vehicle_kind,'planned',:creator,:created,:updated)''',
                     {**fields,'creator':user['tg_id'],'created':stamp,'updated':stamp}).lastrowid
        catalog_history.remember_buyer(c,transport,fields['buyer'])
        if request_id:
            c.execute('INSERT INTO load_requests VALUES(?,?,?,?)',(user['tg_id'],request_id,payload_hash,pk))
        if crew:
            set_crew(c,pk,crew)
        audit(c,user,'load_created','load',pk,None,{**fields,'crew':crew,'status':load_detail(c,pk)['status']})
        return {'id':pk}


@app.patch('/api/loads/{load_id}')
async def edit_load(load_id:int,request:Request,user=Depends(active)):
    b=await request.json()
    with db() as c:
        old=load_detail(c,load_id)
        require(user,'wagon' if old['transport']=='wagon' else 'storekeeper','manager')
        if old['status']=='loaded' and user['role']!='admin': issue(409,'Завершённую погрузку может исправлять только администратор')
        fields=parse_load({**old,**b},old['transport'])
        if fields['buyer']!=old['buyer']:
            catalog_history.remember_buyer(c,old['transport'],fields['buyer'])
        if fields['transport']!=old['transport']: issue(400,'Тип погрузки менять нельзя')
        if not one(c,'SELECT id FROM products WHERE id=?',(fields['product_id'],)):
            issue(400,'Продукция не найдена')
        crew=old['crew']
        if (old['transport']=='truck' or user['role']=='admin') and 'crew' in b:
            crew=parse_crew(c,b.get('crew',[]),old['crew'] if user['role']=='admin' else ())
        c.execute('''UPDATE loads SET reference=:reference,product_id=:product_id,tonnes=:tonnes,
                   load_date=:load_date,buyer=:buyer,vehicle_kind=:vehicle_kind,updated_at=:updated WHERE id=:id''',
                  {**fields,'updated':now(),'id':load_id})
        if (old['transport']=='truck' or user['role']=='admin') and 'crew' in b:
            set_crew(c,load_id,crew)
        remember_daily_crew(c,load_id,crew)
        if old['status']=='loaded' and not crew:
            c.execute('DELETE FROM payouts WHERE load_id=?',(load_id,))
            c.execute("UPDATE loads SET status='planned',total_cents=0,rate_snapshot=NULL,completed_at=NULL WHERE id=?",(load_id,))
        elif old['status']=='loaded':
            updated=load_detail(c,load_id)
            if user['role']=='admin' and 'rate_snapshot' in b:
                updated['rate_snapshot']=decimal_str(b['rate_snapshot'],'Тариф')
            elif fields['product_id']!=old['product_id'] or (old['transport']=='truck' and (Decimal(fields['tonnes'])>20)!=(Decimal(old['tonnes'])>20)):
                updated['rate_snapshot']=None
            recompute(c,updated)
        audit(c,user,'load_updated','load',load_id,old,{**fields,'crew':crew,'reason':str(b.get('reason','')).strip()[:500],'status':load_detail(c,load_id)['status']})
    return {'ok':True}


@app.put('/api/loads/{load_id}/crew')
async def update_crew(load_id:int,request:Request,user=Depends(active)):
    require(user,'storekeeper','manager')
    b=await request.json()
    with db() as c:
        old=load_detail(c,load_id)
        if old['status']=='loaded' and user['role']!='admin': issue(409,'Завершённую погрузку может исправлять только администратор')
        crew=parse_crew(c,b.get('crew',[]),old['crew'] if user['role']=='admin' else ())
        set_crew(c,load_id,crew)
        if old['status']=='loaded':
            if crew: recompute(c,load_detail(c,load_id))
            else:
                c.execute('DELETE FROM payouts WHERE load_id=?',(load_id,))
                c.execute("UPDATE loads SET status='planned',total_cents=0,rate_snapshot=NULL,completed_at=NULL WHERE id=?",(load_id,))
        audit(c,user,'crew_updated','load',load_id,old,{'crew':crew,'status':load_detail(c,load_id)['status']})
    return {'ok':True}


@app.post('/api/loads/{load_id}/status')
async def set_status(load_id:int,request:Request,user=Depends(active)):
    b=await request.json(); status=str(b.get('status',''))
    if status not in STATUS: issue(400,'Неизвестный статус')
    missing=False
    if status=='loaded':
        with db() as c:
            obj=load_detail(c,load_id)
            require(user,'storekeeper','manager')
            if obj['status']!='loaded' and obj['crew'] and not obj['rate_snapshot']:
                tariff=one(c,'SELECT * FROM tariffs WHERE transport=? AND product_id=?',(obj['transport'],obj['product_id']))
                band='rate_over20' if obj['transport']=='truck' and Decimal(obj['tonnes'])>20 else 'rate'
                missing=not tariff or not tariff.get(band)
                if missing:
                    label='Вагон' if obj['transport']=='wagon' else ('Машина свыше 20 т' if band=='rate_over20' else 'Машина до 20 т')
                    policy_notice(c,['manager'],'missing_tariff',f'⚠️ Не установлен тариф\n{obj["product_name"]} · {label}\nЗавершение погрузки заблокировано.',load_id,user['tg_id'],f'tariff:{obj["product_id"]}:{obj["transport"]}:{band}')
        if missing:issue(400,'Лев ещё не установил тариф для этой продукции и транспорта')
    with db() as c:
        obj=load_detail(c,load_id)
        require(user,'storekeeper','manager')
        if obj['status']=='loaded' and user['role']!='admin': issue(409,'Изменить закрытый объект может только администратор')
        if status!='loaded':
            status='progress' if obj['crew'] else 'planned'
            if b.get('status')=='progress' and not obj['crew']:
                issue(400,'Сначала назначь бригаду')
        if obj['status']==status: return {'ok':True}
        if status=='loaded':
            recompute(c,obj)
        elif obj['status']=='loaded':
            c.execute('DELETE FROM payouts WHERE load_id=?',(load_id,))
            c.execute('UPDATE loads SET rate_snapshot=NULL,total_cents=0,completed_at=NULL WHERE id=?',(load_id,))
        c.execute('UPDATE loads SET status=?,updated_at=? WHERE id=?',(status,now(),load_id))
        audit(c,user,'status_updated','load',load_id,obj,{'status':status,'reason':str(b.get('reason','')).strip()[:500]})
    return {'ok':True}


@app.delete('/api/loads/{load_id}')
def delete_load(load_id:int,user=Depends(active)):
    require(user,'admin')
    with db() as c:
        obj=load_detail(c,load_id)
        with trash.deletion(c,'load',load_id,obj['reference'],now()):
            c.execute('UPDATE loads SET deleted=1,updated_at=? WHERE id=?',(now(),load_id))
            c.execute('UPDATE notifications SET dead=1 WHERE load_id=? AND delivered_at IS NULL',(load_id,))
            audit(c,user,'load_deleted','load',load_id,obj,None)
    return {'ok':True}


def report_data(start,end):
    start=check_date(start); end=check_date(end)
    if start>end: issue(400,'Дата начала позже даты окончания')
    with db() as c:
        completed=rows(c,'''SELECT l.*,COALESCE(l.product_name_snapshot,p.name) AS product_name FROM loads l JOIN products p ON p.id=l.product_id
                            WHERE l.deleted=0 AND l.status='loaded' AND l.load_date BETWEEN ? AND ?
                            ORDER BY l.load_date,l.id''',(start,end))
        details=rows(c,'''SELECT l.id AS load_id,l.load_date,l.transport,l.vehicle_kind,l.reference,l.tonnes,l.rate_snapshot,
                          COALESCE(l.product_name_snapshot,p.name) AS product_name,x.id AS loader_id,COALESCE((SELECT name FROM load_names WHERE load_id=l.id AND loader_id=x.id),x.name) AS loader_name,pay.amount_cents
                          FROM payouts pay JOIN loads l ON pay.load_id=l.id JOIN loaders x ON pay.loader_id=x.id
                          JOIN products p ON l.product_id=p.id
                          WHERE l.deleted=0 AND l.status='loaded' AND l.load_date BETWEEN ? AND ?
                          ORDER BY loader_name,l.load_date,l.id''',(start,end))
        extra=[x for x in contractor.entries(c,start,end) if x['status']=='loaded' and not x['deleted']]
        details+=extra
        extra_amount={x['load_id']:x['earned_cents'] for x in extra}
        for x in completed:x['total_cents']+=extra_amount.get(x['id'],0)
    totals={}
    for d in details:
        pid=d['loader_id']
        if pid not in totals: totals[pid]={'loader_id':pid,'name':d['loader_name'],'wagon_count':0,'truck_count':0,'amount_cents':0}
        totals[pid]['wagon_count' if d['transport']=='wagon' else 'truck_count']+=1
        totals[pid]['amount_cents']+=d['amount_cents']
    stats={'loads':len(completed),'wagons':sum(x['transport']=='wagon' for x in completed),
           'trucks':sum(x['transport']=='truck' for x in completed),
           'tonnes':str(sum((Decimal(x['tonnes']) for x in completed),Decimal(0))),
           'total_cents':sum(x['total_cents'] for x in completed)}
    return {'from':start,'to':end,'stats':stats,'by_loader':sorted(totals.values(),key=lambda x:(x['loader_id']==contractor.PERSON_ID,x['name'])),
            'loads':completed,'details':details}


@app.get('/api/report')
def report(start:str|None=None,end:str|None=None,user=Depends(active)):
    require(user,'manager')
    return report_data(start or today(),end or today())


def build_xlsx(data):
    mem=io.BytesIO()
    wb=xlsxwriter.Workbook(mem,{'in_memory':True})
    heading=wb.add_format({'bold':True,'font_color':'white','bg_color':'#173A61','border':0,'align':'center'})
    money=wb.add_format({'num_format':'#,##0.00 "₸"'})
    num=wb.add_format({'num_format':'0.000'})
    title=wb.add_format({'bold':True,'font_size':16,'font_color':'#173A61'})
    def sheet(name,cols,data_rows,widths):
        ws=wb.add_worksheet(name)
        ws.merge_range(0,0,0,len(cols)-1,document_names.title(data)+' · '+name,title)
        ws.write(1,0,'Период: '+document_names.period(data) if document_names.period(data) else 'К сдаче · нет начислений')
        for col,h in enumerate(cols): ws.write(3,col,h,heading)
        for i,row in enumerate(data_rows,4):
            for j,v in enumerate(row):
                fm=money if (('Сумма' in cols[j]) or ('Начислено' in cols[j])) else (num if 'Тонн' in cols[j] or 'Тоннаж' in cols[j] else None)
                if isinstance(v,(int,float)) and fm: ws.write_number(i,j,v,fm)
                else:
                    # Prevent spreadsheet formula injection from free text fields.
                    if isinstance(v,str) and v[:1] in ('=','+','-','@'): v="'"+v
                    ws.write(i,j,v)
        total_row=4+len(data_rows)
        ws.write(total_row,0,'ИТОГО',heading)
        ws.write_number(total_row,len(cols)-1,sum(float(r[-1]) for r in data_rows),money)
        ws.set_landscape(); ws.fit_to_pages(1,0); ws.repeat_rows(0,3)
        for j,w in enumerate(widths): ws.set_column(j,j,w)
        ws.freeze_panes(4,0); ws.autofilter(3,0,3+len(data_rows),len(cols)-1)
    sheet('Начисления',['Грузчик','Вагонов','Машин','Сумма начислений'],
          [[r['name'],r['wagon_count'],r['truck_count'],r['amount_cents']/100] for r in data['by_loader']], [30,14,12,23])
    sheet('Погрузки',['Дата','Тип','Номер','Продукция','Тоннаж, т','Тариф, ₸','Единица тарифа','Сумма, ₸'],
          [[r['load_date'],transport_name(r),r['reference'],r['product_name'],float(r['tonnes']),float(r['rate_snapshot'] or 0),'за вагон' if r['transport']=='wagon' else 'за тонну',r['total_cents']/100] for r in contractor.work_rows(data)],
          [17,14,22,24,15,18,18,20])
    sheet('Детализация',['Грузчик','Дата','Тип','Номер','Продукция','Тоннаж, т','Начислено, ₸'],
          [[r['loader_name'],r['load_date'],transport_name(r),r['reference'],r['product_name'],float(r['tonnes']),r['amount_cents']/100] for r in data['details']],
          [30,17,13,22,22,16,21])
    if data.get('token'):
        sheet('Расчёт к сдаче',['Грузчик','Дата','Тип','Номер','Продукция','Начислено всего, ₸','Учтено ранее, ₸','Сумма к сдаче, ₸'],
              [[r['loader_name'],r['load_date'],transport_name(r),r['reference'],r['product_name'],r.get('earned_cents',r['amount_cents'])/100,r.get('paid_cents',0)/100,r['amount_cents']/100] for r in data['details']],
              [30,17,13,22,22,23,23,23])
    wb.close()
    return mem.getvalue()


def build_pdf(data):
    font='Helvetica'
    for path in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                 '/usr/local/share/fonts/DejaVuSans.ttf']:
        if Path(path).exists():
            pdfmetrics.registerFont(TTFont('VagonyDejaVu',path));font='VagonyDejaVu';break
    if font=='Helvetica':
        issue(503,'На сервере не установлен шрифт DejaVu для русского PDF')
    mem=io.BytesIO()
    doc=SimpleDocTemplate(mem,pagesize=landscape(A4),leftMargin=30,rightMargin=30,topMargin=35,bottomMargin=35)
    styles=getSampleStyleSheet()
    tstyle=ParagraphStyle('v_title',parent=styles['Title'],fontName=font,fontSize=15,leading=22,spaceAfter=12)
    sub=ParagraphStyle('v_sub',parent=styles['Normal'],fontName=font,fontSize=10,leading=15,spaceAfter=8)
    body=ParagraphStyle('v_cell',fontName=font,fontSize=8,leading=12)
    white_cell=ParagraphStyle('v_white_cell', parent=body, textColor=colors.white)
    def cell(text,header=False): return Paragraph(str(text if text is not None and text != '' else '—').replace('&','&amp;').replace('<','&lt;').replace('>','&gt;'),white_cell if header else body)
    story=[Paragraph(document_names.title(data),tstyle),Paragraph('Период: '+document_names.period(data),sub),
           Paragraph(f'Вагонов: {data["stats"]["wagons"]}   Машин: {data["stats"]["trucks"]}   '
                     f'Всего: {data["stats"]["tonnes"]} т   Начислено: {data["stats"]["total_cents"]/100:,.2f} тг',sub)]
    def add_table(heading,grid,widths):
        story.append(Paragraph(heading,sub))
        arr=[[cell(x,header=i==0) for x in line] for i,line in enumerate(grid)]
        if len(arr)==1:arr.append([cell('Нет данных')]+[cell('') for _ in range(len(grid[0])-1)])
        tbl=Table(arr,colWidths=widths,repeatRows=1,hAlign='LEFT')
        tbl.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#173A61')),
                                 ('TEXTCOLOR',(0,0),(-1,0),colors.white),
                                 ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.whitesmoke,colors.white]),
                                 ('VALIGN',(0,0),(-1,-1),'TOP'),('BOTTOMPADDING',(0,0),(-1,-1),7),
                                 ('TOPPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,0),.5,colors.HexColor('#173A61'))]))
        story.append(tbl);story.append(Spacer(1,14))
    add_table('Начисления по грузчикам',
              [['Грузчик','Вагонов','Машин','Сумма, тг']]+[[x['name'],x['wagon_count'],x['truck_count'],f'{x["amount_cents"]/100:,.2f}'] for x in data['by_loader']],
              [320,110,100,155])
    add_table('Завершённые погрузки',
              [['Дата','Тип','Номер','Продукция','Тоннаж, т','Тариф, тг','Сумма, тг']]+[[x['load_date'],transport_name(x),x['reference'],x['product_name'],x['tonnes'],str(x['rate_snapshot'])+(' / вагон' if x['transport']=='wagon' else ' / т'),f'{x["total_cents"]/100:,.2f}'] for x in contractor.work_rows(data)],
              [90,75,115,115,86,102,102])
    add_table('Детализация по каждому грузчику',
              [['Грузчик','Дата','Тип','Номер','Продукция','Начислено, тг']]+[[x['loader_name'],x['load_date'],transport_name(x),x['reference'],x['product_name'],f'{x["amount_cents"]/100:,.2f}'] for x in data['details']],
              [165,95,80,110,125,110])
    doc.build(story)
    return mem.getvalue()


@app.get('/api/report/export/{fmt}')
def export_report(fmt:str,start:str|None=None,end:str|None=None,user=Depends(active)):
    require(user,'manager')
    if fmt not in {'pdf','xlsx','docx'}: issue(404,'Неизвестный формат')
    data=report_data(start or today(),end or today())
    binary=build_pdf(data) if fmt=='pdf' else (build_docx(data) if fmt=='docx' else build_xlsx(data))
    media='application/pdf' if fmt=='pdf' else ('application/vnd.openxmlformats-officedocument.wordprocessingml.document' if fmt=='docx' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return Response(binary,media_type=media,headers={'Content-Disposition':document_names.disposition(document_names.metadata(data,fmt)[0]),
                                                      'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})


@app.get('/api/audit')
def get_audit(user=Depends(active)):
    require(user,'admin')
    with db() as c:
        return rows(c,'''SELECT a.*,u.name AS actor_name FROM audit a LEFT JOIN users u ON u.tg_id=a.actor
                         ORDER BY a.id DESC LIMIT 150''')


def pending_statement(c, start, end, include_reserved=False):
    start=check_date(start); end=check_date(end)
    if start>end: issue(400,'Дата начала позже даты окончания')
    # Union includes removed crew and deleted/reopened loads: these produce reversals.
    entries=rows(c,"""WITH paid AS (
      SELECT load_id,loader_id,SUM(amount_cents) amount FROM statement_lines GROUP BY load_id,loader_id
    ), keys AS (SELECT load_id,loader_id FROM payouts UNION SELECT load_id,loader_id FROM paid)
    SELECT l.id load_id,l.load_date,l.transport,l.vehicle_kind,l.reference,l.buyer,l.tonnes,l.rate_snapshot,
      COALESCE(l.product_name_snapshot,pr.name) product_name,x.id loader_id,COALESCE((SELECT name FROM load_names WHERE load_id=l.id AND loader_id=x.id),x.name) loader_name,
      (CASE WHEN l.deleted=0 AND l.status='loaded' THEN COALESCE(p.amount_cents,0) ELSE 0 END)-COALESCE(pd.amount,0) amount_cents,
      COALESCE(pd.amount,0) paid_cents,
      CASE WHEN l.deleted=0 AND l.status='loaded' THEN COALESCE(p.amount_cents,0) ELSE 0 END earned_cents
    FROM keys k JOIN loads l ON l.id=k.load_id JOIN loaders x ON x.id=k.loader_id
    JOIN products pr ON pr.id=l.product_id
    LEFT JOIN payouts p ON p.load_id=k.load_id AND p.loader_id=k.loader_id
    LEFT JOIN paid pd ON pd.load_id=k.load_id AND pd.loader_id=k.loader_id
    WHERE l.load_date BETWEEN ? AND ? ORDER BY l.id,x.id""",(start,end))
    entries += contractor.entries(c,start,end,pending=True)
    excluded=set() if include_reserved else contractor.reserved(c)
    entries=[x for x in entries if x['amount_cents'] and x['load_id'] not in excluded]
    data=statement_report(entries,start,end)
    data['ledger_version']=one(c,'SELECT COALESCE(MAX(id),0) version,COALESCE(SUM(cancelled),0) cancellations FROM statements')
    data['token']=hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    return data


def statement_report(entries,start,end):
    people={}; loads={}
    for d in entries:
        person=people.setdefault(d['loader_id'],{'loader_id':d['loader_id'],'name':d['loader_name'],
          'wagon_count':0,'truck_count':0,'amount_cents':0})
        person[d['transport']+'_count']+=1
        person['amount_cents']+=d['amount_cents']
        obj=loads.setdefault(d['load_id'],{**d,'id':d['load_id'],'total_cents':0})
        obj['total_cents']+=d['amount_cents']
    entries.sort(key=lambda x:x['loader_id']==contractor.PERSON_ID)
    items=list(loads.values())
    dates=sorted({x['load_date'] for x in items})
    if dates:start,end=dates[0],dates[-1]
    return {'from':start,'to':end,'details':entries,'loads':items,'by_loader':sorted(people.values(),key=lambda x:x['loader_id']==contractor.PERSON_ID),
      'stats':{'loads':len(items),'wagons':sum(x['transport']=='wagon' for x in items),
      'trucks':sum(x['transport']=='truck' for x in items),
      'tonnes':str(sum((Decimal(x['tonnes']) for x in items),Decimal(0))),
      'total_cents':sum(x['amount_cents'] for x in entries)}}


@app.get('/api/statements/pending')
def statement_pending(start:str='0001-01-01',end:str='9999-12-31',user=Depends(active)):
    require(user,'manager')
    with db() as c: return pending_statement(c,start,end)


@app.get('/api/statements')
def statement_list(user=Depends(active)):
    require(user,'manager')
    with db() as c:
        result=[]
        for row in rows(c,'SELECT * FROM statements WHERE cancelled=0 OR EXISTS(SELECT 1 FROM statement_reservations r WHERE r.statement_id=statements.id) ORDER BY id DESC'):
            if row['cancelled'] and user['role']!='admin':continue
            d=json.loads(row.pop('snapshot'))
            dates=sorted({x['load_date'] for x in d['loads']})
            result.append({**row,'from':d.get('from_original',dates[0] if dates else d['from']),'to':d.get('to_original',dates[-1] if dates else d['to']),'stats':d['stats']})
        return result


@app.post('/api/statements')
async def statement_submit(request:Request,user=Depends(active)):
    require(user,'manager'); b=await request.json()
    token=str(b.get('token',''))
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        previous=one(c,'SELECT id FROM statements WHERE token=? AND cancelled=0',(token,))
        if previous: return {'ok':True,'id':previous['id']}
        d=pending_statement(c,b.get('start') or '0001-01-01',b.get('end') or '9999-12-31')
        if token!=d['token']: issue(409,'Начисления изменились. Обнови ведомость и проверь сумму.')
        if not d['details']: issue(400,'Нет новых начислений')
        sid=c.execute('INSERT INTO statements(created_at,actor,token,snapshot) VALUES(?,?,?,?)',
          (now(),user['tg_id'],token,json.dumps(d,ensure_ascii=False))).lastrowid
        contractor.save_lines(c,sid,d['details'])
        audit(c,user,'statement_submitted','statement',sid,None,{'total_cents':d['stats']['total_cents'],'lines':len(d['details'])})
    return {'ok':True,'id':sid}


@app.get('/api/statements/pending/export')
def pending_export(fmt:str='docx',user=Depends(active)):
    data=statement_pending(user=user)
    if fmt not in {'docx','xlsx'}: issue(400,'Неизвестный формат')
    return Response(build_docx(data) if fmt=='docx' else build_xlsx(data),media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document' if fmt=='docx' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      headers={'Content-Disposition':document_names.disposition(document_names.metadata(data,fmt)[0]),'Cache-Control':'private, no-store'})


@app.get('/api/contractor-rates')
def contractor_rates(user=Depends(active)):
    require(user,'manager')
    with db() as c:return rows(c,'SELECT * FROM contractor_rates ORDER BY product_id')


@app.put('/api/contractor-rates')
async def save_contractor_rate(request:Request,user=Depends(active)):
    require(user,'manager');b=await request.json()
    try:pid=int(b.get('product_id'))
    except (TypeError,ValueError):issue(400,'Выбери продукцию')
    value=decimal_str(b.get('rate'),'Тариф')
    with db() as c:
        if not one(c,'SELECT id FROM products WHERE id=? AND deleted=0',(pid,)):issue(400,'Продукция не найдена')
        old=one(c,'SELECT * FROM contractor_rates WHERE product_id=?',(pid,))
        c.execute('INSERT OR REPLACE INTO contractor_rates VALUES(?,?,?,?)',(pid,value,now(),user['tg_id']))
        audit(c,user,'contractor_rate_updated','product',pid,old,{'rate':value})
    return {'ok':True}


@app.get('/api/admin/statements/{sid}/revision')
def statement_revision(sid:int,include_contractor:bool=False,user=Depends(active)):
    require(user,'admin')
    with db() as c:
        row=one(c,'SELECT * FROM statements WHERE id=?',(sid,))
        if not row:issue(404,'Ведомость не найдена')
        return contractor.preview(c,row,include_contractor,pending_statement,statement_report)[0]


@app.post('/api/admin/statements/{sid}/resubmit')
async def statement_resubmit(sid:int,request:Request,user=Depends(active)):
    require(user,'admin');b=await request.json()
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=one(c,'SELECT * FROM statements WHERE id=?',(sid,))
        if not row:issue(404,'Ведомость не найдена')
        if not row['cancelled']:
            if b.get('token')==row['token']:return {'ok':True,'id':sid}
            issue(409,'Эта ведомость уже сдана. Открой её заново.')
        d,additions=contractor.preview(c,row,b.get('include_contractor') is True,pending_statement,statement_report)
        if b.get('token')!=d['token']:issue(409,'Начисления или тарифы изменились. Обнови расчёт и проверь сумму.')
        for x in additions:
            c.execute('INSERT INTO contractor_payouts VALUES(?,?,?,?)',(x['load_id'],x['product_id'],x['rate_snapshot'],x['amount_cents']))
        contractor.save_lines(c,sid,d['details'])
        d['cancelled']=False;d['revision']=row['revision']+1
        c.execute('UPDATE statements SET cancelled=0,revision=?,token=?,snapshot=? WHERE id=?',
                  (d['revision'],d['token'],json.dumps(d,ensure_ascii=False),sid))
        c.execute('DELETE FROM statement_reservations WHERE statement_id=?',(sid,))
        audit(c,user,'statement_resubmitted','statement',sid,json.loads(row['snapshot']),
              {'total_cents':d['stats']['total_cents'],'revision':d['revision'],'contractor_added':len(additions)})
    return {'ok':True,'id':sid}


@app.get('/api/statements/{sid}')
def statement_get(sid:int,user=Depends(active)):
    require(user,'manager')
    with db() as c:
        row=one(c,'SELECT * FROM statements WHERE id=?',(sid,))
        if not row or row['cancelled']: issue(404,'Ведомость не найдена или отменена')
        d=json.loads(row['snapshot']);dates=sorted({x['load_date'] for x in d['loads']})
        return {**d,'from':d.get('from_original',dates[0] if dates else d['from']),'to':d.get('to_original',dates[-1] if dates else d['to']),'id':sid,'created_at':row['created_at'],'revision':row['revision']}


@app.get('/api/statements/{sid}/export')
def statement_export(sid:int,fmt:str='docx',user=Depends(active)):
    data=statement_get(sid,user)
    if fmt not in {'docx','xlsx'}: issue(400,'Неизвестный формат')
    return Response(build_docx(data) if fmt=='docx' else build_xlsx(data),media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document' if fmt=='docx' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      headers={'Content-Disposition':document_names.disposition(document_names.metadata(data,fmt)[0]),'Cache-Control':'private, no-store'})


if __name__=='__main__':
    import uvicorn
    uvicorn.run('app:app',host='0.0.0.0',port=int(os.getenv('PORT','8000')),workers=1)

@app.post('/api/report/send/{fmt}')
async def send_report(fmt:str, request:Request,user=Depends(active)):
    require(user,'manager')
    if fmt not in {'pdf','xlsx','docx'}: issue(404,'Неизвестный формат')
    if not user['started']: issue(400,'Сначала отправь боту команду /start, чтобы он мог присылать файлы')
    if not BOT_TOKEN: issue(503,'Бот ещё не настроен')
    b=await request.json()
    summary = b.get('loader_summary') is True
    section=b.get('stats_section')
    person_id=b.get('person_id')
    transport=b.get('transport','all') if summary or section is not None or person_id is not None else 'all'
    if transport not in ('all','wagon','truck'): issue(400,'Некорректный транспорт')
    if summary and (fmt != 'docx' or b.get('pending') or b.get('statement_id')):
        issue(400,'Сводная ведомость доступна только в Word за выбранный период')
    if summary and (not b.get('start') or not b.get('end')):
        issue(400,'Выбери начало и конец периода')
    if person_id is not None:
        if type(person_id) is not int or person_id<0 or fmt!='docx' or summary or section is not None or b.get('pending') or b.get('statement_id'):
            issue(400,'Некорректный персональный отчёт')
        if not b.get('start') or not b.get('end'): issue(400,'Выбери начало и конец периода')
        ledger=loader_ledger(person_id,b['start'],b['end'],transport,user)
        contents=build_person_docx(ledger,b['start'],b['end'],transport)
        filename=f"Грузчик_{person_id}_{b['start']}_{b['end']}_{transport}.docx"
        caption=f"{ledger['person']['name']} · {b['start']} — {b['end']}"
    elif section is not None:
        if section not in STAT_TITLES or fmt!='docx' or summary or b.get('pending') or b.get('statement_id'):
            issue(400,'Некорректный раздел статистики')
        if not b.get('start') or not b.get('end'): issue(400,'Выбери начало и конец периода')
        stats=manager_stats(b['start'],b['end'],transport,user)
        contents=build_stats_docx(stats,section,transport)
        transport_name={'all':'Весь транспорт','wagon':'Вагоны','truck':'Машины'}[transport]
        filename=f"{STAT_TITLES[section]}_{stats['start']}_{stats['end']}_{transport}.docx"
        caption=f"{STAT_TITLES[section]} · {stats['start']} — {stats['end']}"
        if transport!='all': caption += ' · ' + transport_name
    else:
        data=statement_pending(user=user) if b.get('pending') is True else (statement_get(int(b['statement_id']),user) if b.get('statement_id') else report_data(b.get('start') or today(),b.get('end') or today()))
        contents=build_loader_docx(data, now(), transport) if summary else (build_pdf(data) if fmt=='pdf' else (build_docx(data) if fmt=='docx' else build_xlsx(data)))
        filename,caption=document_names.metadata(data,fmt,summary)
    try:
        async with httpx.AsyncClient(timeout=35) as client:
            res=await client.post(f'https://api.telegram.org/bot{BOT_TOKEN}/sendDocument',
                                  data={'chat_id':str(user['tg_id']),
                                        'caption':caption},
                                  files={'document':(filename,contents,
                                      'application/pdf' if fmt=='pdf' else ('application/vnd.openxmlformats-officedocument.wordprocessingml.document' if fmt=='docx' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))})
            res.raise_for_status()
            if not res.json().get('ok'): issue(502,'Telegram не принял файл')
    except HTTPException: raise
    except Exception:
        issue(502,'Не удалось отправить файл. Проверь, что бот не заблокирован и команда /start уже отправлена')
    return {'ok':True}


@app.get('/api/admin/trash')
def list_trash(user=Depends(active)):
    require(user,'admin')
    with db() as c:
        return rows(c,'SELECT id,kind,entity_id,label,created_at FROM trash WHERE restored_at IS NULL ORDER BY id DESC')

@app.post('/api/admin/trash/{tid}/restore')
def restore_trash(tid:int,user=Depends(active)):
    require(user,'admin')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        item=one(c,'SELECT * FROM trash WHERE id=?',(tid,))
        if not item:issue(404,'Запись корзины не найдена')
        if item['restored_at']:return {'ok':True}
        try:count=trash.restore(c,item)
        except ValueError as exc:issue(409,str(exc))
        c.execute('UPDATE trash SET restored_at=? WHERE id=?',(now(),tid))
        audit(c,user,'trash_restored',item['kind'],item['entity_id'],None,{'trash_id':tid,'loads':count})
    return {'ok':True}

@app.get('/api/admin/backups/status')
def backup_status(user=Depends(active)):
    require(user,'admin')
    service=getattr(app.state,'backup_service',None)
    return service.status() if service else {'unavailable':True}

@app.post('/api/admin/backups/send')
async def send_backup(user=Depends(active)):
    require(user,'admin')
    service=getattr(app.state,'backup_service',None)
    if not service:issue(503,'Проверь настройки резервирования и перезапусти приложение')
    if service.lock.locked():issue(409,'Копия уже создаётся или отправляется. Подожди завершения.')
    try:await service.manual()
    except Exception:issue(502,'Не удалось отправить копию. Проверь состояние резервирования.')
    return {'ok':True}

@app.get('/api/admin/backup')
def backup_database(user=Depends(active)):
    require(user,'admin')
    with db() as source:
        target = sqlite3.connect(':memory:')
        try:
            source.backup(target)
            content=target.serialize()
        finally:
            target.close()
    return Response(content,media_type='application/octet-stream',headers={
        'Content-Disposition':document_names.disposition(document_names.backup_filename(today())),
        'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'
    })


@app.post('/api/admin/statements/{sid}/cancel')
def cancel_statement(sid:int,user=Depends(active)):
    require(user,'admin')
    with db() as c:
        row=one(c,'SELECT * FROM statements WHERE id=?',(sid,))
        if not row: issue(404,'Ведомость не найдена')
        if row['cancelled']: return {'ok':True}
        backup_dir=DB_PATH.parent/'statement_backups';backup_dir.mkdir(parents=True,exist_ok=True)
        backup_path=backup_dir/f'before_statement_{sid}_{time.time_ns()}.sqlite3'
        with sqlite3.connect(backup_path) as backup:c.backup(backup)
        c.execute('BEGIN IMMEDIATE')
        row=one(c,'SELECT * FROM statements WHERE id=?',(sid,))
        if row['cancelled']:return {'ok':True}
        contractor.reserve(c,row)
        c.execute('INSERT OR IGNORE INTO statement_revisions VALUES(?,?,?,?,?)',(sid,row['revision'],row['snapshot'],now(),user['tg_id']))
        c.execute('DELETE FROM statement_lines WHERE statement_id=?',(sid,))
        c.execute('DELETE FROM contractor_lines WHERE statement_id=?',(sid,))
        c.execute('UPDATE statements SET cancelled=1 WHERE id=?',(sid,))
        audit(c,user,'statement_cancelled','statement',sid,json.loads(row['snapshot']),{'cancelled':True})
    return {'ok':True}


@app.post('/api/admin/reset')
async def reset_data(request:Request,user=Depends(active)):
    require(user,'admin');b=await request.json()
    if b.get('confirmation')!='УДАЛИТЬ': issue(400,'Введи УДАЛИТЬ для подтверждения')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        for table in ['contractor_lines','contractor_payouts','statement_reservations','statement_revisions','load_names','buyers','buyer_blocked','trash','notice_keys','notifications','load_requests','statement_lines','statements','payouts','load_crew','daily_crews','loads','loaders','audit']:
            c.execute('DELETE FROM '+table)
        if b.get('catalogs') is True:
            c.execute('DELETE FROM contractor_rates');c.execute('DELETE FROM tariffs');c.execute('DELETE FROM products')
        audit(c,user,'test_data_reset','system',0,None,{'catalogs':b.get('catalogs') is True})
    return {'ok':True}


@app.patch('/api/admin/products/{pid}')
async def admin_product(pid:int,request:Request,user=Depends(active)):
    require(user,'admin');b=await request.json()
    with db() as c:
        old=one(c,'SELECT * FROM products WHERE id=?',(pid,))
        if not old: issue(404,'Продукция не найдена')
        name=str(b.get('name',old['name'])).strip()[:120]
        if not name: issue(400,'Укажи название')
        if one(c,'SELECT id FROM products WHERE name=? AND id!=?',(name,pid)): issue(409,'Такое название уже есть')
        c.execute('UPDATE products SET name=?,active=? WHERE id=?',(name,int(bool(b.get('active',old['active']))),pid))
        audit(c,user,'product_updated','product',pid,old,b)
    return {'ok':True}


@app.delete('/api/admin/products/{pid}')
def delete_product(pid:int,user=Depends(active)):
    require(user,'admin')
    with db() as c:
        old=one(c,'SELECT * FROM products WHERE id=?',(pid,))
        if not old: issue(404,'Продукция не найдена')
        with trash.deletion(c,'product',pid,old['name'],now(),catalog_only=True):
            c.execute('UPDATE products SET active=0,deleted=1 WHERE id=?',(pid,))
            audit(c,user,'product_deleted','product',pid,old,{'history_preserved':True})
    return {'ok':True}


@app.delete('/api/admin/loaders/{lid}')
def delete_loader(lid:int,user=Depends(active)):
    require(user,'admin')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        old=one(c,'SELECT * FROM loaders WHERE id=?',(lid,))
        if not old: issue(404,'Грузчик не найден')
        with trash.deletion(c,'loader',lid,old['name'],now(),catalog_only=True):
            c.execute('UPDATE loaders SET active=0,deleted=1 WHERE id=?',(lid,))
            audit(c,user,'loader_deleted','loader',lid,old,{'history_preserved':True})
    return {'ok':True}


@app.get('/api/settlement-overview')
def settlement_overview(user=Depends(active)):
    require(user,'manager')
    with db() as c:
        return {'pending':pending_statement(c,'0001-01-01','9999-12-31'),
          'unfinished':rows(c,"""SELECT l.id,l.reference,l.transport,l.vehicle_kind,l.load_date,l.status,
            COALESCE(l.product_name_snapshot,p.name) product_name FROM loads l JOIN products p ON p.id=l.product_id
            WHERE l.deleted=0 AND l.status!='loaded' AND l.load_date<=? ORDER BY l.load_date,l.id""",(today(),))}


@app.get('/api/loader-ledger/{lid}')
def loader_ledger(lid:int,start:str,end:str,transport:str='all',user=Depends(active)):
    require(user,'manager')
    start=check_date(start);end=check_date(end)
    if start>end:issue(400,'Проверь даты периода')
    if transport not in ('all','wagon','truck'):issue(400,'Некорректный транспорт')
    with db() as c:
        if lid==contractor.PERSON_ID:
            items=contractor.entries(c,start,end) if transport!='truck' else []
            for x in items:
                x.update(id=x['load_id'],balance_cents=x['earned_cents']-x['paid_cents'],crew_count=1,crew_member=1,total_cents=x['earned_cents'])
                x['statements']=rows(c,'SELECT statement_id,amount_cents FROM contractor_lines WHERE load_id=? ORDER BY statement_id',(x['load_id'],))
            return {'person':{'id':lid,'name':contractor.NAME,'is_contractor':True},'items':items,
                    'earned_cents':sum(x['earned_cents'] for x in items),'paid_cents':sum(x['paid_cents'] for x in items),
                    'balance_cents':sum(x['balance_cents'] for x in items)}
        person=one(c,'SELECT id,name FROM loaders WHERE id=?',(lid,))
        if not person:issue(404,'Грузчик не найден')
        items=rows(c,"""SELECT l.*,l.id load_id,COALESCE(l.product_name_snapshot,pr.name) product_name,
          COALESCE(n.name,x.name) loader_name,
          CASE WHEN l.deleted=0 AND l.status='loaded' THEN COALESCE(p.amount_cents,0) ELSE 0 END earned_cents,
          COALESCE((SELECT SUM(amount_cents) FROM statement_lines WHERE load_id=l.id AND loader_id=?),0) paid_cents,
          (SELECT COUNT(*) FROM load_crew WHERE load_id=l.id) crew_count,
          EXISTS(SELECT 1 FROM load_crew WHERE load_id=l.id AND loader_id=x.id) crew_member
          FROM loads l JOIN products pr ON pr.id=l.product_id JOIN loaders x ON x.id=?
          LEFT JOIN payouts p ON p.load_id=l.id AND p.loader_id=x.id
          LEFT JOIN load_names n ON n.load_id=l.id AND n.loader_id=x.id
          WHERE l.load_date BETWEEN ? AND ? AND (?='all' OR l.transport=?)
          AND (p.loader_id IS NOT NULL OR EXISTS(SELECT 1 FROM statement_lines WHERE load_id=l.id AND loader_id=x.id))
          ORDER BY l.load_date DESC,l.id DESC""",(lid,lid,start,end,transport,transport))
        for x in items:
            x['balance_cents']=x['earned_cents']-x['paid_cents']
            x['statements']=rows(c,'SELECT statement_id,amount_cents FROM statement_lines WHERE load_id=? AND loader_id=? ORDER BY statement_id',(x['id'],lid))
        return {'person':person,'items':items,'earned_cents':sum(x['earned_cents'] for x in items),
          'paid_cents':sum(x['paid_cents'] for x in items),'balance_cents':sum(x['balance_cents'] for x in items)}


@app.get('/api/load-trace/{load_id}')
def load_trace(load_id:int,user=Depends(active)):
    require(user,'manager')
    with db() as c:
        obj=one(c,"""SELECT l.*,COALESCE(l.product_name_snapshot,p.name) product_name FROM loads l
          JOIN products p ON p.id=l.product_id WHERE l.id=?""",(load_id,))
        if not obj:issue(404,'Погрузка не найдена')
        if not obj['deleted']:obj=load_detail(c,load_id)
        else:obj['contractor']=one(c,'SELECT * FROM contractor_payouts WHERE load_id=?',(load_id,))
        events=rows(c,"""SELECT a.*,u.name actor_name FROM audit a LEFT JOIN users u ON u.tg_id=a.actor
          WHERE a.entity='load' AND a.entity_id=? ORDER BY a.id""",(load_id,))
        for e in events:
            e['before']=json.loads(e.pop('before_json') or '{}')
            e['after']=json.loads(e.pop('after_json') or '{}')
        documents=[]
        for r in rows(c,'SELECT id,created_at,cancelled,snapshot FROM statements ORDER BY id'):
            data=json.loads(r.pop('snapshot'))
            lines=[x for x in data['details'] if x['load_id']==load_id]
            if lines:documents.append({**r,'amount_cents':sum(x['amount_cents'] for x in lines)})
        return {'load':obj,'events':events,'statements':documents}
