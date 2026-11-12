"""Independent unloading ledger. Never participates in mill crew splits."""
import hashlib
import json
from decimal import Decimal, ROUND_HALF_UP
from fastapi import HTTPException

NAME = 'Наемник на тупике'
PERSON_ID = 0  # Report-only identity; never a row in loaders or load_crew.


def rows(c, sql, args=()):
    return [dict(r) for r in c.execute(sql, args)]


def one(c, sql, args=()):
    r = c.execute(sql, args).fetchone()
    return dict(r) if r else None


def fail(message):
    raise HTTPException(409, message)


def init(c):
    c.executescript('''
    CREATE TABLE IF NOT EXISTS contractor_rates (
      product_id INTEGER PRIMARY KEY REFERENCES products(id), rate TEXT NOT NULL,
      updated_at TEXT NOT NULL, updated_by INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS contractor_payouts (
      load_id INTEGER PRIMARY KEY REFERENCES loads(id), product_id INTEGER NOT NULL,
      rate_snapshot TEXT NOT NULL, amount_cents INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS contractor_lines (
      statement_id INTEGER NOT NULL REFERENCES statements(id), load_id INTEGER NOT NULL REFERENCES loads(id),
      amount_cents INTEGER NOT NULL, PRIMARY KEY(statement_id,load_id));
    CREATE TABLE IF NOT EXISTS statement_reservations (
      load_id INTEGER PRIMARY KEY REFERENCES loads(id), statement_id INTEGER NOT NULL REFERENCES statements(id));
    CREATE TABLE IF NOT EXISTS statement_revisions (
      statement_id INTEGER NOT NULL REFERENCES statements(id), revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL, changed_at TEXT NOT NULL, actor INTEGER NOT NULL,
      PRIMARY KEY(statement_id,revision));
    ''')
    if 'revision' not in {r[1] for r in c.execute('PRAGMA table_info(statements)')}:
        c.execute('ALTER TABLE statements ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')


def rate(c, product_id):
    r = one(c, 'SELECT rate FROM contractor_rates WHERE product_id=?', (product_id,))
    if not r:
        fail('Установи тариф «Наемник на тупике» для этой продукции в разделе «Тарифы»')
    return r['rate']


def amount(value):
    return int((Decimal(value)*100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def sync(c, obj):
    if obj['transport'] != 'wagon':
        return
    old = one(c, 'SELECT * FROM contractor_payouts WHERE load_id=?', (obj['id'],))
    # Old completed wagons are added only through an explicit statement revision.
    # Automatic accounting starts when the first unloading tariff is configured.
    if not old and (obj['status'] == 'loaded' or not one(c, 'SELECT 1 FROM contractor_rates LIMIT 1')):
        return
    use_rate = old['rate_snapshot'] if old and old['product_id'] == obj['product_id'] else rate(c, obj['product_id'])
    c.execute('INSERT OR REPLACE INTO contractor_payouts VALUES(?,?,?,?)',
              (obj['id'], obj['product_id'], use_rate, amount(use_rate)))


def entries(c, start, end, pending=False):
    result = rows(c, '''SELECT l.id load_id,l.load_date,l.transport,l.vehicle_kind,l.reference,l.buyer,l.tonnes,
      l.status,l.deleted,COALESCE(l.product_name_snapshot,p.name) product_name,
      cp.rate_snapshot,cp.amount_cents,
      COALESCE((SELECT SUM(amount_cents) FROM contractor_lines WHERE load_id=l.id),0) paid_cents
      FROM contractor_payouts cp JOIN loads l ON l.id=cp.load_id JOIN products p ON p.id=l.product_id
      WHERE l.load_date BETWEEN ? AND ? ORDER BY l.load_date,l.id''', (start,end))
    out=[]
    for x in result:
        earned=x['amount_cents'] if x['status']=='loaded' and not x['deleted'] else 0
        x.update(loader_id=PERSON_ID,loader_name=NAME,is_contractor=True,earned_cents=earned,
                 amount_cents=earned-x['paid_cents'] if pending else earned)
        if x['amount_cents'] or (not pending and earned==0 and x['paid_cents']):
            out.append(x)
    return out


def reserved(c):
    return {r['load_id'] for r in rows(c,'SELECT load_id FROM statement_reservations')}


def order(data):
    data['by_loader'].sort(key=lambda x: x['loader_id']==PERSON_ID)
    data['details'].sort(key=lambda x: x['loader_id']==PERSON_ID)
    return data


def work_rows(data):
    """Separate work rows for documents; physical load counts stay unique."""
    contractors={}
    for x in data['details']:
        if x.get('is_contractor'):
            contractors.setdefault(x['load_id'],[]).append(x)
    result=[]
    for x in data['loads']:
        extras=contractors.get(x['id'],[])
        own=x['total_cents']-sum(d['amount_cents'] for d in extras)
        if own or not extras:
            result.append({**x,'total_cents':own,'is_contractor':False})
        for d in extras:
            result.append({**x,**d,'id':x['id'],'total_cents':d['amount_cents'],'is_contractor':True})
    return result


def reserve(c, row):
    data=json.loads(row['snapshot'])
    for load_id in {x['load_id'] for x in data['details']}:
        other=one(c,'SELECT statement_id FROM statement_reservations WHERE load_id=?',(load_id,))
        if other and other['statement_id']!=row['id']:
            fail('Сначала повторно сдай ведомость № '+str(other['statement_id']))
        c.execute('INSERT OR IGNORE INTO statement_reservations VALUES(?,?)',(load_id,row['id']))


def preview(c, row, include, pending_fn, report_fn):
    if not row['cancelled']:
        fail('Сначала отмени сдачу этой ведомости')
    original=json.loads(row['snapshot'])
    ids={r['load_id'] for r in rows(c,'SELECT load_id FROM statement_reservations WHERE statement_id=?',(row['id'],))}
    if not ids:
        fail('У этой отменённой ведомости нет закреплённого состава. Открой актуальную сданную ведомость.')
    data=pending_fn(c,'0001-01-01','9999-12-31',include_reserved=True)
    details=[x for x in data['details'] if x['load_id'] in ids]
    additions=[]
    if include:
        for load_id in sorted(ids):
            x=one(c,'''SELECT l.*,COALESCE(l.product_name_snapshot,p.name) product_name FROM loads l
              JOIN products p ON p.id=l.product_id WHERE l.id=?''',(load_id,))
            if not x or x['transport']!='wagon' or x['deleted'] or x['status']!='loaded':
                continue
            if one(c,'SELECT 1 FROM contractor_payouts WHERE load_id=?',(load_id,)):
                continue
            r=rate(c,x['product_id'])
            d={**x,'load_id':load_id,'loader_id':PERSON_ID,'loader_name':NAME,'is_contractor':True,
               'rate_snapshot':r,'amount_cents':amount(r),'earned_cents':amount(r),'paid_cents':0}
            details.append(d);additions.append(d)
    result=report_fn(details,original['from'],original['to'])
    # Freeze the original document dates, independently of the time of resubmission.
    result.update(id=row['id'],from_original=original['from'],to_original=original['to'],
                  created_at=row['created_at'],cancelled=True,revision=row['revision'],
                  include_contractor=include,previous_total_cents=original['stats']['total_cents'])
    result['from']=original['from'];result['to']=original['to']
    result['token']=hashlib.sha256(json.dumps(result,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    return order(result),additions


def save_lines(c,sid,details):
    for x in details:
        if x.get('is_contractor'):
            c.execute('INSERT INTO contractor_lines VALUES(?,?,?)',(sid,x['load_id'],x['amount_cents']))
        else:
            c.execute('INSERT INTO statement_lines VALUES(?,?,?,?)',(sid,x['load_id'],x['loader_id'],x['amount_cents']))
