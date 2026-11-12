"""Shared machine workflow: subtype persistence, rates, reports and migration."""
import io
import zipfile
from test_app import a, headers, TestClient


def test_machine_types(tmp_path, monkeypatch):
    monkeypatch.setattr(a, 'DB_PATH', tmp_path / 'machines.db')
    with TestClient(a.app) as cl:
        adm = headers(111, 'Админ'); os = headers(333, 'Олеся')
        for hdr in (adm, os): cl.get('/api/me', headers=hdr)
        cl.post('/api/users/333/access', headers=adm, json={'role':'storekeeper','state':'active'})
        pid = cl.get('/api/bootstrap', headers=adm).json()['products'][0]['id']
        lid = cl.post('/api/loaders', headers=adm, json={'name':'Грузчик'}).json()['id']
        cl.put('/api/tariffs', headers=adm, json={'product_id':pid,'transport':'truck','rate':'100','rate_over20':'150'})
        ids=[]
        for kind in ('fura', 'kamaz'):
            for weight, expected in [('20',200000),('21',315000)]:
                body={'buyer':'Тестовый покупатель','reference':'TEST-123','transport':'truck','product_id':pid,'tonnes':weight,'load_date':'2026-11-03','crew':[lid]}
                if kind=='kamaz': body['vehicle_kind']=kind
                r=cl.post('/api/loads',headers=os,json=body); assert r.status_code==200,r.text
                pk=r.json()['id'];ids.append(pk)
                assert cl.patch(f'/api/loads/{pk}',headers=os,json={'buyer':'Покупатель'}).status_code==200
                obj=cl.get(f'/api/loads/{pk}',headers=os).json()
                assert obj['vehicle_kind']==kind and obj['crew']==[lid]
                assert cl.post(f'/api/loads/{pk}/status',headers=os,json={'status':'loaded'}).status_code==200
                assert cl.get(f'/api/loads/{pk}',headers=os).json()['total_cents']==expected
        r=cl.patch(f'/api/loads/{ids[0]}',headers=adm,json={'vehicle_kind':'kamaz'})
        assert r.status_code==200,r.text
        assert cl.get(f'/api/loads/{ids[0]}',headers=adm).json()['vehicle_kind']=='kamaz'
        assert cl.patch(f'/api/loads/{ids[0]}',headers=adm,json={'vehicle_kind':'bus'}).status_code==400
        report=cl.get('/api/report?start=2026-11-03&end=2026-11-03',headers=adm).json()
        assert report['stats']['trucks']==4 and report['stats']['total_cents']==1030000
        assert {r['vehicle_kind'] for r in report['details']}=={'fura','kamaz'}
        pending=cl.get('/api/statements/pending',headers=adm).json()
        sid=cl.post('/api/statements',headers=adm,json={'token':pending['token']}).json()['id']
        saved=cl.get(f'/api/statements/{sid}',headers=adm).json()
        assert {r['vehicle_kind'] for r in saved['loads']}=={'fura','kamaz'}
        for fmt, entry in [('xlsx','xl/sharedStrings.xml'),('docx','word/document.xml')]:
            r=cl.get(f'/api/statements/{sid}/export?fmt={fmt}',headers=adm)
            assert r.status_code==200
            with zipfile.ZipFile(io.BytesIO(r.content)) as z:
                text=z.read(entry).decode()
                assert 'КамАЗ' in text and 'Фура' in text
        # Existing databases acquire the new field without changing old records.
        with a.db() as c:c.execute('ALTER TABLE loads DROP COLUMN vehicle_kind')
        a.init_db();a.init_db()
        with a.db() as c:
            assert all(r['vehicle_kind']=='fura' for r in a.rows(c,'SELECT vehicle_kind FROM loads'))
        assert a.transport_name({'transport':'truck'})=='Фура'
