"""Trace views must reconcile with the existing settlement ledger, including reversals."""
from test_app import a, headers, TestClient


def test_financial_trace(tmp_path, monkeypatch):
    monkeypatch.setattr(a,'DB_PATH',tmp_path/'trace.db')
    with TestClient(a.app) as cl:
        adm=headers(111,'Админ');lev=headers(444,'Лев');os=headers(333,'Олеся')
        for hdr,uid,role in [(adm,111,'admin'),(lev,444,'manager'),(os,333,'storekeeper')]:
            cl.get('/api/me',headers=hdr)
            with a.db() as c:c.execute("UPDATE users SET role=?,state='active' WHERE tg_id=?",(role,uid))
        pid=cl.get('/api/bootstrap',headers=adm).json()['products'][0]['id']
        people=[cl.post('/api/loaders',headers=lev,json={'name':n}).json()['id'] for n in ['Иванов','Петров','Сидоров']]
        cl.put('/api/tariffs',headers=lev,json={'product_id':pid,'transport':'truck','rate':'100','rate_over20':'100'})
        def create(date,ref):
            r=cl.post('/api/loads',headers=os,json={'transport':'truck','buyer':'Покупатель','reference':ref,'product_id':pid,'tonnes':'10','load_date':date,'crew':people})
            assert r.status_code==200,r.text
            return r.json()['id']
        lid=create('2026-10-01','A');unfinished=create('2026-10-02','B');future=create('2099-01-01','C')
        cl.post(f'/api/loads/{lid}/status',headers=os,json={'status':'loaded'})
        def overview():return cl.get('/api/settlement-overview',headers=lev).json()
        def card(person):return cl.get(f'/api/loader-ledger/{person}?start=2026-10-01&end=2026-10-31',headers=lev).json()
        def submit():
            d=overview()['pending']
            r=cl.post('/api/statements',headers=lev,json={'token':d['token']});assert r.status_code==200,r.text
            return r.json()['id']
        assert [x['id'] for x in overview()['unfinished']]==[unfinished]
        assert overview()['pending']['stats']['total_cents']==100000
        assert sum(card(p)['earned_cents'] for p in people)==100000
        sid=submit();snapshot=cl.get(f'/api/statements/{sid}',headers=lev).json()
        assert all(card(p)['balance_cents']==0 for p in people)
        assert card(people[0])['items'][0]['statements'][0]['statement_id']==sid
        r=cl.patch(f'/api/loads/{lid}',headers=adm,json={'rate_snapshot':'110','reason':'Уточнили тариф'})
        assert r.status_code==200,r.text
        assert overview()['pending']['stats']['total_cents']==10000
        assert sum(card(p)['balance_cents'] for p in people)==10000
        trace=cl.get(f'/api/load-trace/{lid}',headers=lev).json()
        e=trace['events'][-1]
        assert e['actor_name']=='Админ' and e['after']['reason']=='Уточнили тариф'
        assert e['before']['total_cents']==100000 and e['after']['total_cents']==110000
        assert sum(p['amount_cents'] for p in e['after']['payouts'])==110000
        assert cl.get(f'/api/statements/{sid}',headers=lev).json()==snapshot
        # Removed person still has a reversal and a link to their original document.
        cl.put(f'/api/loads/{lid}/crew',headers=adm,json={'crew':people[1:]})
        assert card(people[0])['earned_cents']==0
        assert card(people[0])['balance_cents']==-33334
        stats=cl.get('/api/manager-stats?start=2026-10-01&end=2026-10-31',headers=lev).json()
        assert people[0] in [p['loader_id'] for p in stats['people']]
        assert sum(card(p)['balance_cents'] for p in people)==overview()['pending']['stats']['total_cents']
        # Renaming the catalog cannot change saved line labels.
        cl.patch(f'/api/loaders/{people[0]}',headers=lev,json={'name':'Новое имя'})
        assert card(people[0])['items'][0]['loader_name']=='Иванов'
        cl.delete(f'/api/loads/{lid}',headers=adm)
        assert cl.get(f'/api/load-trace/{lid}',headers=lev).json()['load']['deleted']==1
        assert sum(card(p)['balance_cents'] for p in people)==-100000
        assert cl.post(f'/api/admin/statements/{sid}/cancel',headers=adm,json={}).status_code==200
        assert overview()['pending']['stats']['total_cents']==0
        assert all(card(p)['balance_cents']==0 for p in people)
        assert cl.get(f'/api/load-trace/{lid}',headers=lev).json()['statements'][0]['cancelled']==1
        for url in ['/api/settlement-overview',f'/api/load-trace/{lid}',f'/api/loader-ledger/{people[0]}?start=2026-10-01&end=2026-10-31']:
            assert cl.get(url,headers=os).status_code==403
        assert cl.get(f'/api/loader-ledger/{people[0]}?start=2026-10-31&end=2026-10-01',headers=lev).status_code==400
