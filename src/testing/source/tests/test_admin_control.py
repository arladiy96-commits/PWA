from test_app import a,headers,TestClient


def test_admin_corrections_cancel_delete_and_reset(tmp_path,monkeypatch):
    monkeypatch.setattr(a,'DB_PATH',tmp_path/'admin.db')
    with TestClient(a.app) as cl:
        adm=headers(111,'Админ');lev=headers(444,'Лев')
        for h in [adm,lev]:cl.get('/api/me',headers=h)
        with a.db() as c:c.execute("UPDATE users SET role='manager',state='active' WHERE tg_id=444")
        def req(method,url,body=None,h=adm):
            r=cl.request(method,url,headers=h,json=body)
            assert r.status_code==200,r.text
            return r.json()
        pid=req('GET','/api/products')[0]['id']
        ids=[req('POST','/api/loaders',{'name':n})['id'] for n in ['Иван','Пётр']]
        req('PUT','/api/tariffs',{'transport':'truck','product_id':pid,'rate':'100','rate_over20':'200'})
        load=req('POST','/api/loads',{'buyer':'Тестовый покупатель','reference':'TEST-123','transport':'truck','product_id':pid,'tonnes':'10','load_date':'2026-11-03','crew':ids})['id']
        req('POST',f'/api/loads/{load}/status',{'status':'loaded'})
        def pending():return req('GET','/api/statements/pending')
        first=pending();sid=req('POST','/api/statements',{'token':first['token']})['id']
        req('PATCH',f'/api/loads/{load}',{'tonnes':'21'})
        assert pending()['stats']['total_cents']==320000
        correction=req('POST','/api/statements',{'token':pending()['token']})['id']
        assert not pending()['details']
        assert cl.post(f'/api/admin/statements/{sid}/cancel',headers=lev).status_code==403
        req('POST',f'/api/admin/statements/{sid}/cancel')
        assert pending()['stats']['total_cents']==0
        draft=req('GET',f'/api/admin/statements/{sid}/revision')
        assert draft['stats']['total_cents']==100000
        req('POST',f'/api/admin/statements/{sid}/cancel')
        assert req('GET',f'/api/admin/statements/{sid}/revision')['token']==draft['token']
        assert cl.post('/api/statements',headers=adm,json={'token':first['token']}).status_code==409
        assert cl.post(f'/api/admin/statements/{correction}/cancel',headers=adm).status_code==409
        req('POST',f'/api/admin/statements/{sid}/resubmit',{'token':draft['token']})
        req('POST',f'/api/admin/statements/{correction}/cancel')
        assert req('GET',f'/api/admin/statements/{correction}/revision')['stats']['total_cents']==320000
        # Removing all assigned people reopens a completed load atomically.
        req('PATCH',f'/api/loads/{load}',{'crew':[]})
        assert not pending()['details']
        assert req('GET',f'/api/loads/{load}')['status']=='planned'
        req('PATCH',f'/api/loads/{load}',{'crew':ids})
        req('POST',f'/api/loads/{load}/status',{'status':'loaded'})
        req('DELETE',f'/api/admin/loaders/{ids[0]}')
        draft=req('GET',f'/api/admin/statements/{correction}/revision')
        assert {x['loader_id'] for x in draft['by_loader']}==set(ids)
        assert draft['stats']['total_cents']==320000
        assert len(req('GET','/api/loaders'))==1
        paid=req('POST',f'/api/admin/statements/{correction}/resubmit',{'token':draft['token']})['id']
        req('DELETE',f'/api/admin/loaders/{ids[1]}')
        assert pending()['stats']['total_cents']==0
        req('POST',f'/api/admin/statements/{paid}/cancel')
        assert req('GET',f'/api/loads/{load}')['status']=='loaded'
        assert req('GET',f'/api/admin/statements/{paid}/revision')['stats']['total_cents']==320000
        stats=req('GET','/api/manager-stats?start=2026-11-03&end=2026-11-03')
        assert stats['totals']['tonnes']=='21' and stats['totals']['amount_cents']==420000
        req('DELETE',f'/api/admin/products/{pid}')
        assert len(req('GET','/api/loads?start=2026-11-03&end=2026-11-03'))==1
        assert cl.post('/api/admin/reset',headers=lev,json={'confirmation':'УДАЛИТЬ'}).status_code==403
        assert cl.post('/api/admin/reset',headers=adm,json={'confirmation':'нет'}).status_code==400
        req('POST','/api/admin/reset',{'confirmation':'УДАЛИТЬ','catalogs':True})
        assert len(req('GET','/api/users'))==2
        assert not req('GET','/api/products')
        a.init_db()
        assert not req('GET','/api/products')
        assert not req('GET','/api/statements')
        assert not pending()['details']
        assert not req('GET','/api/loaders')
        assert req('GET','/api/audit')[0]['action']=='test_data_reset'
