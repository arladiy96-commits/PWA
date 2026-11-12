"""Transactional deletion snapshots, scoped to affected records and relations."""
import json
from contextlib import contextmanager

TABLES = ('products','loaders','loads','tariffs','load_crew','payouts','daily_crews')

def init(c):
    c.execute('CREATE TABLE IF NOT EXISTS trash (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, entity_id INTEGER NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL, restored_at TEXT)')

def snapshot(c,scope):
    result={}
    for table,(column,ids) in scope.items():
        result[table]=[dict(r) for r in c.execute('SELECT * FROM '+table+' WHERE '+column+' IN ('+','.join('?' for _ in ids)+') ORDER BY '+column,ids)] if ids else []
        result[table].sort(key=lambda x:json.dumps(x,sort_keys=True))
    return result

@contextmanager
def deletion(c,kind,entity_id,label,stamp,catalog_only=False):
    c.execute('BEGIN IMMEDIATE') if not c.in_transaction else None
    if kind=='load':ids=[entity_id]
    elif kind=='product':ids=[r[0] for r in c.execute('SELECT id FROM loads WHERE product_id=? AND deleted=0',(entity_id,))]
    else:ids=[r[0] for r in c.execute('SELECT load_id FROM load_crew WHERE loader_id=?',(entity_id,))]
    scope={'loads':('id',ids),'load_crew':('load_id',ids),'payouts':('load_id',ids)}
    if kind=='product':scope.update(products=('id',[entity_id]),tariffs=('product_id',[entity_id]))
    if kind=='loader':
        days=[r[0] for r in c.execute('SELECT load_date,crew_json FROM daily_crews') if entity_id in json.loads(r[1])]
        scope.update(loaders=('id',[entity_id]),daily_crews=('load_date',days))
    if catalog_only:
        scope={"products" if kind=="product" else "loaders":("id",[entity_id])}
    before=snapshot(c,scope)
    yield
    after=snapshot(c,scope)
    if before!=after:
        c.execute('INSERT INTO trash(kind,entity_id,label,created_at,payload) VALUES(?,?,?,?,?)',(kind,entity_id,label,stamp,json.dumps({'scope':scope,'before':before,'after':after},ensure_ascii=False)))

def restore(c,item):
    data=json.loads(item['payload']);scope=data['scope'];before=data['before'];after=data['after']
    if snapshot(c,scope)!=after:
        raise ValueError('Связанные записи изменились после удаления. Сначала восстанови более поздние удаления или проверь изменения в истории.')
    # A deleted dependency must not be silently resurrected by restoring its load.
    active_ids={x['id'] for x in before.get('loads',[]) if not x['deleted']}
    for row in before.get('loads',[]):
        if row['deleted']:continue
        p=c.execute('SELECT deleted FROM products WHERE id=?',(row['product_id'],)).fetchone()
        if (not p or p[0]) and not any(x['id']==row['product_id'] and not x['deleted'] for x in before.get('products',[])):
            raise ValueError('Сначала восстанови продукцию этой погрузки.')
    for row in before.get('load_crew',[]):
        if row['load_id'] not in active_ids:continue
        p=c.execute('SELECT deleted FROM loaders WHERE id=?',(row['loader_id'],)).fetchone()
        if (not p or p[0]) and not any(x['id']==row['loader_id'] and not x['deleted'] for x in before.get('loaders',[])):
            raise ValueError('Сначала восстанови грузчиков этой бригады.')
    # Restore only changed tables; original identities and saved rates are retained.
    for table in TABLES:
        if table not in scope or before[table]==after[table]:continue
        column,ids=scope[table]
        if table in ('products','loaders','loads'):
            for row in before[table]:
                keys=[k for k in row if k!='id']
                c.execute('UPDATE '+table+' SET '+','.join(k+'=?' for k in keys)+' WHERE id=?', [row[k] for k in keys]+[row['id']])
        else:
            c.execute('DELETE FROM '+table+' WHERE '+column+' IN ('+','.join('?' for _ in ids)+')',ids)
            for row in before[table]:
                c.execute('INSERT INTO '+table+' ('+','.join(row)+') VALUES ('+','.join('?' for _ in row)+')',list(row.values()))
    return len(before.get('loads',[]))
