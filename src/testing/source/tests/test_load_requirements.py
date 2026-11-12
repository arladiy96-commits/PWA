from test_app import a, headers, TestClient


def test_required_fields_weight_and_crew(tmp_path,monkeypatch):
    monkeypatch.setattr(a,'DB_PATH',tmp_path/'requirements.db')
    with TestClient(a.app) as cl:
        h=headers(111,'Админ');cl.get('/api/me',headers=h)
        pid=cl.get('/api/bootstrap',headers=h).json()['products'][0]['id']
        lid=cl.post('/api/loaders',headers=h,json={'name':'Иван'}).json()['id']
        for transport in ('wagon','truck'):
            body={'transport':transport,'reference':'123','buyer':'Покупатель','product_id':pid,'tonnes':'68,5'}
            for field in (('reference','buyer') if transport=='wagon' else ('buyer',)):
                for value in ('','   ',None):
                    assert cl.post('/api/loads',headers=h,json={**body,field:value}).status_code==400
            r=cl.post('/api/loads',headers=h,json=body);assert r.status_code==200,r.text
            url='/api/loads/'+str(r.json()['id'])
            assert cl.get(url,headers=h).json()['tonnes']=='68.5'
            assert cl.post(url+'/status',headers=h,json={'status':'progress'}).status_code==400
            cl.put(url+'/crew',headers=h,json={'crew':[lid]})
            assert cl.get(url,headers=h).json()['status']=='progress'
            cl.put(url+'/crew',headers=h,json={'crew':[]})
            assert cl.get(url,headers=h).json()['status']=='planned'
            cl.patch(url,headers=h,json={'tonnes':'68.5'})
            assert cl.get(url,headers=h).json()['tonnes']=='68.5'
            cl.put(url+'/crew',headers=h,json={'crew':[lid]})
        cl.delete('/api/admin/loaders/'+str(lid),headers=h)
        assert cl.get(url,headers=h).json()['status']=='progress'


def test_buyer_suggestions(tmp_path,monkeypatch):
    monkeypatch.setattr(a,'DB_PATH',tmp_path/'buyers.db')
    with TestClient(a.app) as cl:
        h=headers(111,'Админ');cl.get('/api/me',headers=h)
        pid=cl.get('/api/bootstrap',headers=h).json()['products'][0]['id']
        base={'reference':'NUMBER-NOT-A-BUYER','product_id':pid,'tonnes':'20'}
        for transport,buyer in [('wagon','ТОО Ромашка'),('truck','тоо   ромашка'),('truck','Другой покупатель')]:
            r=cl.post('/api/loads',headers=h,json={**base,'transport':transport,'buyer':buyer});assert r.status_code==200
        names=cl.get('/api/buyers',headers=h).json()
        assert names==['Другой покупатель','тоо ромашка']
        cl.delete('/api/loads/'+str(r.json()['id']),headers=h)
        assert cl.get('/api/buyers',headers=h).json()==names
        assert cl.get('/api/buyers').status_code in (401,403)
