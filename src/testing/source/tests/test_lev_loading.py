from test_app import a, headers, TestClient


def test_lev_loading_preserves_closed_history(tmp_path, monkeypatch):
    monkeypatch.setattr(a, 'DB_PATH', tmp_path/'lev.db')
    with TestClient(a.app) as cl:
        adm, lev = headers(111,'Админ'), headers(444,'Лев')
        for h in (adm,lev): cl.get('/api/me',headers=h)
        with a.db() as c:
            c.execute("UPDATE users SET role='manager',state='active' WHERE tg_id=444")
        pid=cl.get('/api/bootstrap',headers=adm).json()['products'][0]['id']
        crew=[cl.post('/api/loaders',headers=lev,json={'name':n}).json()['id'] for n in ('Иван','Пётр')]
        for transport in ('wagon','truck'):
            assert cl.put('/api/tariffs',headers=lev,json={'transport':transport,'product_id':pid,'rate':'100','rate_over20':'150'}).status_code==200
        base={'buyer':'Покупатель','product_id':pid,'tonnes':'20','load_date':'2026-11-10','crew':crew}
        old=cl.post('/api/loads',headers=adm,json={**base,'transport':'truck','reference':'OLD-123'}).json()['id']
        assert cl.post(f'/api/loads/{old}/status',headers=adm,json={'status':'loaded'}).status_code==200
        pending=cl.get('/api/statements/pending',headers=lev).json()
        sid=cl.post('/api/statements',headers=lev,json={'token':pending['token']}).json()['id']
        snap=cl.get(f'/api/statements/{sid}',headers=lev).json()
        old_load=cl.get(f'/api/loads/{old}',headers=adm).json()
        for transport,kind,weight,total in [('wagon','fura','68,5',10000),('truck','fura','20',200000),('truck','kamaz','21',315000)]:
            body={**base,'transport':transport,'vehicle_kind':kind,'tonnes':weight,'_request_id':f'test-{transport}-{kind}-00000001'}
            if transport=='wagon':body['reference']='52594066'
            r=cl.post('/api/loads',headers=lev,json=body); assert r.status_code==200,r.text
            pk=r.json()['id'];url=f'/api/loads/{pk}'
            assert cl.post('/api/loads',headers=lev,json=body).json()['id']==pk
            assert cl.patch(url,headers=lev,json={'buyer':'Новый покупатель'}).status_code==200
            assert cl.put(url+'/crew',headers=lev,json={'crew':crew}).status_code==200
            assert cl.get('/api/day-crew?date=2026-11-10',headers=lev).json()['crew']==crew
            assert cl.post(url+'/status',headers=lev,json={'status':'loaded'}).status_code==200
            obj=cl.get(url,headers=lev).json()
            assert obj['total_cents']==total
            if transport=='truck': assert obj['reference']==''
            for method,path,data in [('patch',url,{'tonnes':'1'}),('put',url+'/crew',{'crew':[]}),('post',url+'/status',{'status':'planned'})]:
                assert getattr(cl,method)(path,headers=lev,json=data).status_code==409
        assert cl.get(f'/api/loads/{old}',headers=adm).json()==old_load
        assert cl.get(f'/api/statements/{sid}',headers=lev).json()==snap
        # Omitting the removed field on editing an old machine preserves its number.
        r=cl.post('/api/loads',headers=adm,json={**base,'transport':'truck','reference':'KEEP-123'})
        url='/api/loads/'+str(r.json()['id'])
        assert cl.patch(url,headers=lev,json={'buyer':'Другой'}).status_code==200
        assert cl.get(url,headers=lev).json()['reference']=='KEEP-123'
        assert cl.post('/api/loads',headers=lev,json={**base,'transport':'wagon'}).status_code==400
        assert cl.post('/api/users/111/access',headers=lev,json={'role':'manager','state':'active'}).status_code==403
