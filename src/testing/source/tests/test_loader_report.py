from decimal import Decimal
from io import BytesIO
from docx import Document
from test_app import a, headers, TestClient
from loader_report import summary_rows, build_loader_docx


def test_participation_not_divided_and_names_not_merged():
    details=[]
    for uid in (1,2):
        for transport,product,weight in [('wagon','Отруби','68'),('wagon','Мука','68'),('truck','Отруби','24.001'),('truck','Мука','40')]:
            details.append(dict(loader_id=uid,loader_name='Иванов',transport=transport,product_name=product,tonnes=weight,amount_cents=101))
    data=dict(details=details,**{'from':'2026-11-01','to':'2026-11-30'})
    products,people=summary_rows(data)
    assert len(people)==2
    assert products==['Отруби','Мука']
    for p in people:
        assert p['amount_cents']==404
        assert p['volumes'][('wagon','Мука')]==1
        assert p['volumes'][('truck','Отруби')]==Decimal('24.001')
    doc=Document(BytesIO(build_loader_docx(data,'2026-11-05T15:00:00+05:00')))
    assert len(doc.tables[0].rows)==4
    assert doc.tables[0].rows[-1].cells[-1].text=='8,08'


def test_summary_send_includes_paid_and_preserves_ledger(tmp_path,monkeypatch):
    monkeypatch.setattr(a,'DB_PATH',tmp_path/'summary.db')
    with TestClient(a.app) as cl:
        adm=headers(111,'Админ');lev=headers(444,'Лев');other=headers(333,'Олеся')
        for hdr,uid,role in [(adm,111,'admin'),(lev,444,'manager'),(other,333,'storekeeper')]:
            cl.get('/api/me',headers=hdr)
            with a.db() as c:c.execute("UPDATE users SET state='active',role=?,started=1 WHERE tg_id=?",(role,uid))
        pid=cl.get('/api/bootstrap',headers=adm).json()['products'][0]['id']
        lid=cl.post('/api/loaders',headers=lev,json={'name':'Иванов'}).json()['id']
        cl.put('/api/tariffs',headers=lev,json={'transport':'truck','product_id':pid,'rate':'100','rate_over20':'100'})
        for day,complete in [('2026-11-01',True),('2026-11-30',True),('2026-12-01',True),('2026-11-15',False)]:
            r=cl.post('/api/loads',headers=other,json=dict(buyer='Покупатель',reference='TEST-123',transport='truck',product_id=pid,tonnes='24',load_date=day,crew=[lid]))
            assert r.status_code==200,r.text
            if complete: assert cl.post('/api/loads/'+str(r.json()['id'])+'/status',headers=other,json={'status':'loaded'}).status_code==200
        pending=cl.get('/api/statements/pending',headers=lev).json()
        assert cl.post('/api/statements',headers=lev,json={'token':pending['token']}).status_code==200
        before=cl.get('/api/statements',headers=lev).json()
        sent=[]
        class TelegramClient:
            def __init__(self,**kw):pass
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def post(self,url,**kw):
                sent.append(kw)
                class Result:
                    def raise_for_status(self):pass
                    def json(self):return {'ok':True}
                return Result()
        monkeypatch.setattr(a.httpx,'AsyncClient',TelegramClient)
        payload={'loader_summary':True,'start':'2026-11-01','end':'2026-11-30'}
        r=cl.post('/api/report/send/docx',headers=lev,json=payload)
        assert r.status_code==200,r.text
        assert sent[-1]['data']['chat_id']=='444'
        doc=Document(BytesIO(sent[-1]['files']['document'][1]))
        values=[c.text for c in doc.tables[0].rows[1].cells]
        assert '48' in values and values[-1]=='4 800,00'
        assert cl.get('/api/statements',headers=lev).json()==before
        assert cl.get('/api/statements/pending',headers=lev).json()['details']==[]
        assert cl.post('/api/report/send/docx',headers=other,json=payload).status_code==403
        assert cl.post('/api/report/send/docx',headers=lev,json={**payload,'end':'2026-10-01'}).status_code==400
        assert cl.post('/api/report/send/pdf',headers=lev,json=payload).status_code==400
        assert cl.post('/api/report/send/docx',headers=lev,json={**payload,'start':'2027-01-01','end':'2027-01-31'}).status_code==200
        empty=Document(BytesIO(sent[-1]['files']['document'][1]))
        assert empty.tables[0].rows[-1].cells[-1].text=='0,00'
