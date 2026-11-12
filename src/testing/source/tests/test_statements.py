"""Settlement ledger: boundary rates, idempotency, corrections, snapshots and access."""
import json
import sqlite3
import io
import zipfile
from test_app import a, headers, TestClient


def test_statement_lifecycle(tmp_path, monkeypatch):
    monkeypatch.setattr(a,'DB_PATH',tmp_path/'ledger.db')
    with TestClient(a.app) as cl:
        adm=headers(111,'Админ'); lev=headers(444,'Лев'); other=headers(333,'Олеся')
        for hdr,uid,role in [(adm,111,'admin'),(lev,444,'manager'),(other,333,'storekeeper')]:
            cl.get('/api/me',headers=hdr)
            if uid!=111:
                with a.db() as c:c.execute("UPDATE users SET state='active',role=? WHERE tg_id=?",(role,uid))
        pid=cl.get('/api/bootstrap',headers=adm).json()['products'][0]['id']
        lid=cl.post('/api/loaders',headers=lev,json={'name':'Иван'}).json()['id']
        lid2=cl.post('/api/loaders',headers=lev,json={'name':'Пётр'}).json()['id']
        assert cl.put('/api/tariffs',headers=lev,json={'transport':'truck','product_id':pid,'rate':'100','rate_over20':'150'}).status_code==200
        def truck(weight):
            r=cl.post('/api/loads',headers=other,json={'buyer':'Тестовый покупатель','reference':'TEST-123','transport':'truck','product_id':pid,'tonnes':weight,'load_date':'2026-11-02','crew':[lid]})
            assert r.status_code==200,r.text
            pk=r.json()['id']
            assert cl.post(f'/api/loads/{pk}/status',headers=other,json={'status':'loaded'}).status_code==200
            return pk
        def pending():return cl.get('/api/statements/pending',headers=lev).json()
        def submit(d):return cl.post('/api/statements',headers=lev,json={'token':d['token']})
        x=truck('20');y=truck('20.001')
        assert cl.get(f'/api/loads/{x}',headers=adm).json()['rate_snapshot']=='100'
        assert cl.get(f'/api/loads/{y}',headers=adm).json()['rate_snapshot']=='150'
        old=pending();z=truck('1')
        assert submit(old).status_code==409
        # Sending a draft includes all unpaid dates and never submits the ledger.
        sent=[]
        class TelegramClient:
            def __init__(self,**kwargs):pass
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def post(self,url,**kwargs):
                sent.append(kwargs)
                class Result:
                    def raise_for_status(self):pass
                    def json(self):return {'ok':True}
                return Result()
        monkeypatch.setattr(a.httpx,'AsyncClient',TelegramClient)
        with a.db() as c:c.execute('UPDATE users SET started=1 WHERE tg_id=444')
        before=pending()
        r=cl.post('/api/report/send/docx',headers=lev,json={'pending':True})
        assert r.status_code==200,r.text
        assert sent[-1]['data']['chat_id']=='444'
        assert sent[-1]['files']['document'][0]=='Наряд_к_сдаче_02.11.2026.docx'
        assert sent[-1]['data']['caption']=='Наряд на сдельную оплату · к сдаче\nПериод: 02.11.2026'
        with zipfile.ZipFile(io.BytesIO(sent[-1]['files']['document'][1])) as doc:
            assert 'Иван' in doc.read('word/document.xml').decode()
        assert pending()==before
        assert cl.get('/api/statements',headers=lev).json()==[]
        assert cl.post('/api/report/send/docx',headers=other,json={'pending':True}).status_code==403
        d=pending();r=submit(d);assert r.status_code==200,r.text
        sid=r.json()['id'];snap=cl.get(f'/api/statements/{sid}',headers=lev).json()
        assert pending()['details']==[]
        assert submit(d).json()['id']==sid
        assert len(cl.get('/api/statements',headers=lev).json())==1
        late=truck('2');d=pending()
        assert [i['load_id'] for i in d['details']]==[late]
        assert submit(d).status_code==200
        assert cl.get('/api/report?start=2026-11-02&end=2026-11-02',headers=lev).json()['stats']['loads']==4
        # An already paid load edited by admin creates only the delta.
        assert cl.patch(f'/api/loads/{late}',headers=adm,json={'tonnes':'3'}).status_code==200
        d=pending();assert d['stats']['total_cents']==10000
        assert submit(d).status_code==200
        # Reassignment creates reversal for old person, accrual for new person (net zero).
        assert cl.put(f'/api/loads/{late}/crew',headers=adm,json={'crew':[lid2]}).status_code==200
        d=pending();assert len(d['details'])==2 and d['stats']['total_cents']==0
        assert submit(d).status_code==200
        assert cl.delete(f'/api/loads/{late}',headers=adm).status_code==200
        d=pending();assert d['stats']['total_cents']==-30000
        assert submit(d).status_code==200
        assert pending()['details']==[]
        assert cl.get(f'/api/statements/{sid}',headers=lev).json()==snap
        excel=cl.get(f'/api/statements/{sid}/export?fmt=xlsx',headers=lev)
        assert excel.status_code==200
        with zipfile.ZipFile(io.BytesIO(excel.content)) as zf:
            assert 'Расчёт к сдаче' in zf.read('xl/workbook.xml').decode()
        assert cl.get('/api/statements/pending/export',headers=lev).status_code==200
        for url in ['/api/statements','/api/statements/pending',f'/api/statements/{sid}',f'/api/statements/{sid}/export']:
            assert cl.get(url,headers=other).status_code==403
        assert cl.post('/api/statements',headers=other,json={'token':d['token']}).status_code==403
        # Reopen and close same load: same sums are a new ledger revision, not an old retry.
        cl.post(f'/api/loads/{x}/status',headers=adm,json={'status':'progress'})
        assert submit(pending()).status_code==200
        cl.post(f'/api/loads/{x}/status',headers=adm,json={'status':'loaded'})
        assert submit(pending()).status_code==200
        assert pending()['details']==[]


def test_legacy_tariff_migration(tmp_path,monkeypatch):
    path=tmp_path/'old.db';monkeypatch.setattr(a,'DB_PATH',path)
    with sqlite3.connect(path) as c:
        c.execute('CREATE TABLE tariffs(transport TEXT,product_id INTEGER,rate TEXT,updated_at TEXT,updated_by INTEGER,PRIMARY KEY(transport,product_id))')
        c.execute("INSERT INTO tariffs VALUES('truck',1,'123','2026-11-01',111)")
    a.init_db();a.init_db()
    with a.db() as c:
        row=a.one(c,'SELECT * FROM tariffs')
        assert row['rate']=='123' and row['rate_over20']=='123'
