from test_app import a, headers, TestClient


def test_overdue_visibility_and_completion(tmp_path,monkeypatch):
    monkeypatch.setattr(a,'DB_PATH',tmp_path/'overdue.db')
    monkeypatch.setattr(a,'today',lambda:'2026-11-04')
    with TestClient(a.app) as cl:
        h=headers(111,'Админ');w=headers(222,'Максим');o=headers(333,'Олеся')
        for hdr in (h,w,o):cl.get('/api/me',headers=hdr)
        for uid,role in [(222,'wagon'),(333,'storekeeper')]:
            cl.post(f'/api/users/{uid}/access',headers=h,json={'role':role,'state':'active'})
        assert cl.get('/api/overdue-loads',headers=h).json()==[]
        pid=cl.get('/api/bootstrap',headers=h).json()['products'][0]['id']
        lid=cl.post('/api/loaders',headers=h,json={'name':'Иван'}).json()['id']
        ids=[]
        for transport,day in [('wagon','2026-11-02'),('truck','2026-11-03'),('truck','2026-11-04'),('wagon','2026-11-05')]:
            r=cl.post('/api/loads',headers=h,json={'transport':transport,'reference':'123','buyer':'Покупатель','product_id':pid,'tonnes':'10','load_date':day,'crew':[lid]})
            assert r.status_code==200,r.text
            ids.append(r.json()['id'])
        assert [x['id'] for x in cl.get('/api/overdue-loads',headers=h).json()]==ids[:2]
        assert [x['id'] for x in cl.get('/api/overdue-loads',headers=w).json()]==ids[:1]
        for pk,t in zip(ids[:2],['wagon','truck']):
            cl.put('/api/tariffs',headers=h,json={'transport':t,'product_id':pid,'rate':'100','rate_over20':'200'})
            assert cl.post(f'/api/loads/{pk}/status',headers=o,json={'status':'loaded'}).status_code==200
        assert cl.get('/api/overdue-loads',headers=o).json()==[]
        assert cl.get(f'/api/loads/{ids[0]}',headers=h).json()['load_date']=='2026-11-02'
        cl.post(f'/api/loads/{ids[0]}/status',headers=h,json={'status':'progress'})
        assert len(cl.get('/api/overdue-loads',headers=o).json())==1
        cl.delete(f'/api/loads/{ids[0]}',headers=h)
        assert cl.get('/api/overdue-loads',headers=o).json()==[]
