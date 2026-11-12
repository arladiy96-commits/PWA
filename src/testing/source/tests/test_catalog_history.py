from test_app import a,headers,TestClient


def test_catalogs_are_separate_and_history_is_stable(tmp_path,monkeypatch):
    monkeypatch.setattr(a,'DB_PATH',tmp_path/'catalogs.db')
    with TestClient(a.app) as cl:
        adm=headers(111,'Админ');mx=headers(222,'Максим');os=headers(333,'Олеся')
        for h,uid,role in [(adm,111,'admin'),(mx,222,'wagon'),(os,333,'storekeeper')]:
            cl.get('/api/me',headers=h)
            with a.db() as c:c.execute("UPDATE users SET state='active',role=? WHERE tg_id=?",(role,uid))
        def req(method,url,data=None,h=adm):
            r=cl.request(method,url,headers=h,json=data);assert r.status_code==200,r.text;return r.json()
        prod=req('GET','/api/products')[0];pid=prod['id']
        lid=req('POST','/api/loaders',{'name':'Старое имя'})['id']
        for t in ('wagon','truck'):req('PUT','/api/tariffs',dict(transport=t,product_id=pid,rate='100',rate_over20='100'))
        def create(t,buyer):return req('POST','/api/loads',dict(transport=t,buyer=buyer,reference='123',product_id=pid,tonnes='24',load_date='2026-11-01',crew=[lid]))['id']
        wagon=create('wagon','Вагонный покупатель');truck=create('truck','Машинный покупатель')
        for pk in (wagon,truck):req('POST',f'/api/loads/{pk}/status',{'status':'loaded'})
        assert req('GET','/api/buyers',h=mx)==['Вагонный покупатель']
        assert req('GET','/api/buyers',h=os)==['Машинный покупатель']
        assert cl.get('/api/buyers?transport=truck',headers=mx).status_code==403
        assert cl.get('/api/admin/buyers?transport=truck',headers=os).status_code==403
        old_report=req('GET','/api/report?start=2026-11-01&end=2026-11-30')
        old_pending=req('GET','/api/statements/pending')
        buyer=req('GET','/api/admin/buyers?transport=wagon')[0]
        req('PATCH',f"/api/admin/buyers/{buyer['id']}",{'name':'Исправленный покупатель'})
        req('PATCH',f'/api/loaders/{lid}',{'name':'Новое имя'})
        req('PATCH',f'/api/admin/products/{pid}',{'name':'Новое название'})
        for t in ('wagon','truck'):req('PUT','/api/tariffs',dict(transport=t,product_id=pid,rate='999',rate_over20='999'))
        assert req('GET',f'/api/loads/{wagon}')['buyer']=='Вагонный покупатель'
        assert req('GET',f'/api/loads/{wagon}')['crew_names']==['Старое имя']
        assert req('GET','/api/report?start=2026-11-01&end=2026-11-30')==old_report
        assert req('GET','/api/statements/pending')==old_pending
        new_id=create('wagon','Вагонный покупатель')
        new_load=req('GET',f'/api/loads/{new_id}')
        assert new_load['product_name']=='Новое название'
        assert new_load['crew_names']==['Новое имя']
        assert req('GET','/api/buyers',h=mx)==['Исправленный покупатель']
        req('DELETE',f"/api/admin/buyers/{buyer['id']}")
        req('DELETE',f'/api/admin/loaders/{lid}')
        req('DELETE',f'/api/admin/products/{pid}')
        assert req('GET','/api/report?start=2026-11-01&end=2026-11-30')==old_report
        assert req('GET','/api/statements/pending')==old_pending
        a.init_db();a.init_db()
        assert req('GET','/api/buyers',h=mx)==[]
        assert req('GET','/api/buyers',h=os)==['Машинный покупатель']
        # Editing another field must retain deleted catalog identities and labels.
        req('PATCH',f'/api/loads/{wagon}',{'buyer':'Явная правка','crew':[lid]})
        assert req('GET',f'/api/loads/{wagon}')['crew_names']==['Старое имя']
        assert req('GET',f'/api/loads/{wagon}')['product_name']==prod['name']


def test_migration_and_tombstones(tmp_path,monkeypatch):
    monkeypatch.setattr(a,'DB_PATH',tmp_path/'migration.db')
    a.init_db()
    with a.db() as c:
        pid=c.execute('SELECT id FROM products LIMIT 1').fetchone()[0]
        c.execute("INSERT INTO loaders(name,created_at) VALUES('Имя','now')")
        lid=c.execute('SELECT id FROM loaders').fetchone()[0]
        for t in ('wagon','truck'):
            c.execute("INSERT INTO loads(transport,reference,product_id,tonnes,load_date,buyer,status,created_by,created_at,updated_at) VALUES(?, '1',?, '10','2026-11-01','  Общий   покупатель  ','planned',111,'now','now')",(t,pid))
        c.execute('INSERT INTO load_crew(load_id,loader_id) VALUES(1,?)',(lid,))
        # Simulate data that predates this migration.
        c.execute('DELETE FROM catalog_migrations');c.execute('DELETE FROM load_names')
        c.execute('UPDATE loads SET product_name_snapshot=NULL')
    a.init_db()
    with a.db() as c:
        assert c.execute('SELECT COUNT(*) FROM buyers').fetchone()[0]==2
        c.execute("UPDATE buyers SET deleted=1 WHERE transport='wagon'")
        c.execute("INSERT INTO buyer_blocked VALUES('wagon','общий покупатель')")
        a.catalog_history.remember_buyer(c,'wagon','ОБЩИЙ покупатель')
        assert c.execute("SELECT COUNT(*) FROM buyers WHERE transport='wagon' AND deleted=0").fetchone()[0]==0
        assert c.execute('SELECT name FROM load_names').fetchone()[0]=='Имя'
    a.init_db()
    with a.db() as c:
        assert c.execute('SELECT COUNT(*) FROM buyers').fetchone()[0]==2
        assert c.execute('SELECT COUNT(*) FROM loads WHERE product_name_snapshot IS NULL').fetchone()[0]==0
