"""Dispatch existing endpoints against a device-local SQLite database."""
import base64, inspect, json, re, sqlite3
from urllib.parse import urlsplit, parse_qsl
import domain as d

IDENTITIES={'admin':(111,'Администратор'),'manager':(444,'Лев'),'wagon':(222,'Максим'),'storekeeper':(333,'Заведующий складом'),'pending':(555,'Тестовый сотрудник')}

def initialize():
    d.init_db()
    with d.db() as c:
        for role,(uid,name) in IDENTITIES.items():
            c.execute('INSERT OR IGNORE INTO users(tg_id,name,username,role,state,started,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)',
                      (uid,name,'',role,'pending' if role=='pending' else 'active',d.now(),d.now()))
    # No seeded operational entries: all weights, rates and crews are user-created.

def response(result):
    if isinstance(result,d.Response):
        return {'status':result.status_code,'headers':{**result.headers,'Content-Type':result.media_type},'binary':base64.b64encode(result.content).decode()}
    return {'status':200,'body':result}

async def dispatch(payload):
    try:
        p=json.loads(payload);url=urlsplit(p['path']);method=p.get('method','GET').upper()
        if p.get('role') not in IDENTITIES: raise d.HTTPException(401,'Выбери тестовый кабинет')
        with d.db() as c: user=d.one(c,'SELECT * FROM users WHERE tg_id=?',(IDENTITIES[p['role']][0],))
        if url.path!='/api/me' and (user['state']!='active' or user['role'] not in d.ROLES): raise d.HTTPException(403,'Доступ не одобрен или заблокирован')
        if url.path in ('/api/admin/backups/status','/api/admin/backups/send'):
            d.require(user,'admin')
            if method=='POST': raise d.HTTPException(409,'В тестовой версии Telegram не подключён. Скачай локальную копию кнопкой «Скачать базу».')
            return json.dumps({'status':200,'body':{'unavailable':True}})
        if url.path=='/api/test/version':
            with d.db() as c: version=d.one(c,'SELECT COALESCE(MAX(id),0) version FROM audit')['version']
            return json.dumps({'status':200,'body':{'version':version,'role':user['role'],'state':user['state']}})
        for verb,route,fn in d.app.routes:
            if verb!=method: continue
            pattern=re.sub(r'\{(\w+)\}',r'(?P<\1>[^/]+)',route)
            match=re.fullmatch(pattern,url.path)
            if not match: continue
            values={**dict(parse_qsl(url.query)),**match.groupdict()};args={}
            for name,param in inspect.signature(fn).parameters.items():
                if name=='user': args[name]=user
                elif name=='request': args[name]=d.Request(p.get('body') or {})
                elif name in values:
                    annotation=str(param.annotation);value=values[name]
                    if annotation=='int': value=int(value)
                    elif annotation=='bool':
                        if value.lower() not in ('true','false','1','0'): raise ValueError('bool')
                        value=value.lower() in ('true','1')
                    args[name]=value
                elif param.default is inspect.Parameter.empty: raise d.HTTPException(422,'Отсутствует параметр '+name)
            result=fn(**args)
            if inspect.isawaitable(result): result=await result
            return json.dumps(response(result),ensure_ascii=False)
        raise d.HTTPException(404,'Операция не найдена: '+url.path)
    except d.HTTPException as e: return json.dumps({'status':e.status_code,'body':{'detail':e.detail}},ensure_ascii=False)
    except (ValueError,TypeError) as e: return json.dumps({'status':422,'body':{'detail':'Некорректные параметры запроса: '+str(e)}},ensure_ascii=False)

def export_database():
    with d.db() as c:
        target=sqlite3.connect(':memory:');c.backup(target)
        try:return base64.b64encode(target.serialize()).decode()
        finally:target.close()

def restore_database(encoded):
    # Used exclusively for our persisted local snapshot, never uploaded to a server.
    raw=base64.b64decode(encoded)
    if raw[:16]!=b'SQLite format 3\0': raise ValueError('Некорректная локальная база')
    d.DB_PATH.parent.mkdir(parents=True,exist_ok=True)
    for suffix in ('','-wal','-shm'):
        p=__import__('pathlib').Path(str(d.DB_PATH)+suffix)
        if p.exists():p.unlink()
    d.DB_PATH.write_bytes(raw)
