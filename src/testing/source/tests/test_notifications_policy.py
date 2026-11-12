import io,zipfile
from test_app import a,headers,TestClient


def test_role_policy_and_dates(tmp_path,monkeypatch):
    monkeypatch.setattr(a,'DB_PATH',tmp_path/'notices.db')
    with TestClient(a.app) as cl:
        hs={role:headers(uid,role) for uid,role in [(111,'admin'),(222,'wagon'),(333,'storekeeper'),(444,'manager')]}
        for role,h in hs.items():cl.get('/api/me',headers=h)
        with a.db() as c:
            for uid,role in [(111,'admin'),(222,'wagon'),(333,'storekeeper'),(444,'manager')]:c.execute("UPDATE users SET role=?,state='active',started=1 WHERE tg_id=?",(role,uid))
            c.execute('DELETE FROM notifications')
        def req(method,url,b=None,role='admin'):
            r=cl.request(method,url,json=b,headers=hs[role]);assert r.status_code==200,r.text
            return r.json()
        def notices(uid,kind=None):
            with a.db() as c:return a.rows(c,'SELECT * FROM notifications WHERE tg_id=?'+(' AND kind=?' if kind else ''),(uid,kind) if kind else (uid,))
        pid=req('GET','/api/products')[0]['id'];lid=req('POST','/api/loaders',{'name':'Иван'})['id']
        body={'buyer':'Тестовый покупатель','transport':'wagon','reference':'12345678','product_id':pid,'tonnes':'50','load_date':'2026-11-02'}
        wagon=req('POST','/api/loads',body,role='wagon')['id']
        assert len(notices(333,'new_wagon'))==1
        req('PUT',f'/api/loads/{wagon}/crew',{'crew':[lid]},role='storekeeper')
        assert not notices(222)
        for _ in range(2):assert cl.post(f'/api/loads/{wagon}/status',json={'status':'loaded'},headers=hs['storekeeper']).status_code==400
        assert len(notices(444,'missing_tariff'))==1
        req('PUT','/api/tariffs',{'transport':'wagon','product_id':pid,'rate':'1000'},role='manager')
        req('POST',f'/api/loads/{wagon}/status',{'status':'loaded'})
        assert len(notices(222,'wagon_completed'))==1
        assert not notices(444,'completed')
        d=req('GET','/api/statements/pending',role='manager');assert d['from']==d['to']=='2026-11-02'
        sid=req('POST','/api/statements',{'token':d['token']},role='manager')['id']
        for i in range(5):req('POST','/api/loads',{**body,'reference':str(20000000+i)},role='wagon')
        assert len(notices(444,'after_statement'))==1
        a.init_db()
        req('POST','/api/loads',{**body,'reference':'30000000'},role='wagon')
        assert len(notices(444,'after_statement'))==1
        req('PATCH',f'/api/loads/{wagon}',{'rate_snapshot':'1200'})
        assert notices(444,'money_change')
        req('POST',f'/api/admin/statements/{sid}/cancel')
        assert any('Отменена сдача' in x['text'] for x in notices(444,'money_change'))
        d=req('GET',f'/api/admin/statements/{sid}/revision');sid2=req('POST',f'/api/admin/statements/{sid}/resubmit',{'token':d['token']})['id']
        assert sid2==sid
        req('POST','/api/loads',{**body,'reference':'40000000'},role='wagon')
        assert len(notices(444,'after_statement'))==2
        data=req('GET',f'/api/statements/{sid2}');assert data['from']==data['to']=='2026-11-02'
        with zipfile.ZipFile(io.BytesIO(a.build_docx(data))) as z:
            xml=z.read('word/document.xml').decode();assert '02.11.2026' in xml and 'Сдана' not in xml
        # Maxim cannot complete; Olesya completes and Maxim is notified.
        x=req('POST','/api/loads',{**body,'reference':'50000000'})['id']
        req('PUT',f'/api/loads/{x}/crew',{'crew':[lid]})
        assert cl.post(f'/api/loads/{x}/status',json={'status':'loaded'},headers=hs['wagon']).status_code==403
        req('POST',f'/api/loads/{x}/status',{'status':'loaded'},role='storekeeper')
        assert len(notices(222,'wagon_completed'))==2
