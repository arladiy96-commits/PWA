from test_app import a, headers, TestClient


def test_daily_crew_first_save_and_dates(tmp_path, monkeypatch):
    monkeypatch.setattr(a,'DB_PATH',tmp_path/'daily.db')
    with TestClient(a.app) as cl:
        admin=headers(111,'Админ'); os=headers(333,'Олеся')
        for h in (admin,os):cl.get('/api/me',headers=h)
        cl.post('/api/users/333/access',headers=admin,json={'role':'storekeeper','state':'active'})
        pid=cl.get('/api/bootstrap',headers=os).json()['products'][0]['id']
        ids=[cl.post('/api/loaders',headers=os,json={'name':str(i)}).json()['id'] for i in range(3)]
        def day(d):return cl.get('/api/day-crew',params={'date':d},headers=os).json()
        def create(d,t='truck',crew=None):
            r=cl.post('/api/loads',headers=admin,json={'buyer':'Тестовый покупатель','transport':t,'reference':d+t,'tonnes':'20','product_id':pid,'load_date':d,'crew':crew or []})
            assert r.status_code==200,r.text
            return r.json()['id']
        def assign(pk,crew):
            r=cl.put(f'/api/loads/{pk}/crew',headers=os,json={'crew':crew});assert r.status_code==200,r.text
        d='2026-11-03';tom='2026-11-04'
        w=create(d,'wagon');assert day(d)['crew']==[]
        tr=create(d,crew=[ids[1],ids[2]])
        assign(w,[ids[0]]) # Older vehicle, later crew: must not replace the first saved crew.
        assert day(d)['crew']==ids[1:]
        assign(tr,[ids[0]]);assert day(d)['crew']==ids[1:]
        assert day(tom)['crew']==[]
        w2=create(tom,'wagon');assign(w2,[ids[0]])
        create(tom,crew=ids[1:]);assert day(tom)['crew']==[ids[0]]
        assert day(d)['crew']==ids[1:]
        a.init_db();assert day(d)['crew']==ids[1:]
        # Migration reconstructs original crew, despite subsequent reassignment.
        with a.db() as c:c.execute('DROP TABLE daily_crews')
        a.init_db();assert day(d)['crew']==ids[1:] and day(tom)['crew']==[ids[0]]
        with a.db() as c:c.execute('UPDATE loaders SET active=0 WHERE id=?',(ids[1],))
        assert day(d)['crew']==[ids[2]]
        assert cl.get('/api/day-crew?date=bad',headers=os).status_code==400
        assert cl.get('/api/day-crew?date='+d).status_code==401
