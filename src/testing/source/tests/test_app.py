"""Integration tests with signed Telegram WebApp initData, no Telegram network."""
import hashlib
import hmac
import os
import sys
import tempfile
import time
import json
from pathlib import Path
from urllib.parse import urlencode

os.environ['BOT_TOKEN']='123456:TEST-BOT-TOKEN'
os.environ['ADMIN_TG_ID']='111'
os.environ['PUBLIC_URL']=''
os.environ['DB_PATH']=str(Path(tempfile.mkdtemp())/'db.sqlite3')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import app as a


def headers(uid, first):
    pairs={'user':json.dumps({'id':uid,'first_name':first},ensure_ascii=False,separators=(',',':')),
           'auth_date':str(int(time.time())),'query_id':'test'}
    val='\n'.join(f'{k}={v}' for k,v in sorted(pairs.items()))
    key=hmac.new(b'WebAppData',a.BOT_TOKEN.encode(),hashlib.sha256).digest()
    pairs['hash']=hmac.new(key,val.encode(),hashlib.sha256).hexdigest()
    return {'X-Telegram-Init-Data':urlencode(pairs)}


def test_complete_system():
    with TestClient(a.app) as cl:
        admin=headers(111,'Администратор');maxim=headers(222,'Максим');olesya=headers(333,'Олеся');lev=headers(444,'Лев')
        assert cl.get('/healthz').status_code==200
        assert cl.get('/api/me',headers=admin).json()['user']['role']=='admin'
        assert cl.get('/api/me',headers=maxim).json()['user']['role']=='pending'
        assert cl.get('/api/loads',headers=maxim).status_code==403
        for hdr, uid,role in [(maxim,222,'wagon'),(olesya,333,'storekeeper'),(lev,444,'manager')]:
            cl.get('/api/me',headers=hdr)
            r=cl.post(f'/api/users/{uid}/access',headers=admin,json={'role':role,'state':'active'})
            assert r.status_code==200,r.text
        product=cl.get('/api/bootstrap',headers=lev).json()['products'][0]
        pid=product['id']
        rate=cl.put('/api/tariffs',headers=lev,json={'product_id':pid,'transport':'wagon','rate':'123.45'})
        assert rate.status_code==200,rate.text
        # Can create loaders but cannot grant permission.
        lid1=cl.post('/api/loaders',headers=lev,json={'name':'Иванов'}).json()['id']
        lid2=cl.post('/api/loaders',headers=lev,json={'name':'Петров'}).json()['id']
        assert cl.post('/api/users/222/access',headers=lev,json={'role':'manager','state':'active'}).status_code==403
        body={'buyer':'Тестовый покупатель','transport':'wagon','reference':'52594066','product_id':pid,'tonnes':'68.6','load_date':'2026-11-02'}
        created=cl.post('/api/loads',headers=maxim,json=body)
        assert created.status_code==200,created.text
        pk=created.json()['id']
        assert cl.post(f'/api/loads/{pk}/status',headers=maxim,json={'status':'loaded'}).status_code==403
        assert cl.put(f'/api/loads/{pk}/crew',headers=maxim,json={'crew':[lid1,lid2]}).status_code==403
        assert cl.put(f'/api/loads/{pk}/crew',headers=olesya,json={'crew':[lid1,lid2]}).status_code==200
        # A truck and its crew are saved atomically, without a second request.
        truck={'transport':'truck','reference':'KZ 317 AAN','product_id':pid,
               'tonnes':'25','load_date':'2026-11-02','buyer':'ТОО Ромашка','crew':[lid1]}
        truck_created=cl.post('/api/loads',headers=olesya,json=truck)
        assert truck_created.status_code==200,truck_created.text
        truck_id=truck_created.json()['id']
        assert cl.get(f'/api/loads/{truck_id}',headers=olesya).json()['crew']==[lid1]
        edit_truck=cl.patch(f'/api/loads/{truck_id}',headers=olesya,json={'crew':[lid1,lid2],'buyer':'ТОО Василёк'})
        assert edit_truck.status_code==200,edit_truck.text
        truck_data=cl.get(f'/api/loads/{truck_id}',headers=olesya).json()
        assert truck_data['crew']==[lid1,lid2]
        assert truck_data['buyer']=='ТОО Василёк'
        completed=cl.post(f'/api/loads/{pk}/status',headers=olesya,json={'status':'loaded'})
        assert completed.status_code==200,completed.text
        assert cl.get('/api/wagon-journal?month=2026-11',headers=maxim).json()['tonnes_loaded']=='68.600'
        x=cl.get(f'/api/loads/{pk}',headers=lev).json()
        assert x['rate_snapshot']=='123.45'
        assert x['total_cents']==12345
        assert cl.patch(f'/api/loads/{pk}',headers=maxim,json={'tonnes':'60'}).status_code==409
        # Changing today's tariff cannot change already loaded wagon payroll.
        cl.put('/api/tariffs',headers=lev,json={'product_id':pid,'transport':'wagon','rate':'200'})
        assert cl.get(f'/api/loads/{pk}',headers=admin).json()['total_cents']==12345
        # Admin corrects weight; fixed wagon payment remains unchanged.
        correction=cl.patch(f'/api/loads/{pk}',headers=admin,json={'tonnes':'60'})
        assert correction.status_code==200,correction.text
        x=cl.get(f'/api/loads/{pk}',headers=admin).json()
        assert x['total_cents']==12345 and x['rate_snapshot']=='123.45'
        assert cl.get('/api/wagon-journal?month=2026-11',headers=maxim).json()['tonnes_loaded']=='60.000'
        report=cl.get('/api/report?start=2026-11-01&end=2026-11-30',headers=lev)
        assert report.status_code==200,report.text
        info=report.json()
        assert info['stats']['total_cents']==12345
        assert len(info['by_loader'])==2
        assert sum(i['amount_cents'] for i in info['by_loader'])==12345
        pdf=cl.get('/api/report/export/pdf?start=2026-11-01&end=2026-11-30',headers=lev)
        assert pdf.status_code==200 and pdf.content[:4]==b'%PDF',pdf.text[:200] if pdf.status_code!=200 else ''
        xlsx=cl.get('/api/report/export/xlsx?start=2026-11-01&end=2026-11-30',headers=lev)
        assert xlsx.status_code==200 and xlsx.content[:2]==b'PK'
        assert cl.get('/api/audit',headers=admin).status_code==200
        assert cl.get('/api/audit',headers=lev).status_code==403
        assert cl.post(f'/api/loads/{pk}/status',headers=admin,json={'status':'planned'}).status_code==200
        reopened=cl.get('/api/report?start=2026-11-01&end=2026-11-30',headers=lev).json()
        assert reopened['stats']['total_cents']==0
        assert cl.get('/api/wagon-journal?month=2026-11',headers=maxim).json()['tonnes_loaded']=='0.000'
        assert cl.get('/api/loads',headers={}).status_code==401


def test_role_scripts_and_deny_access():
    """Separate UI modules are served and the admin can reject a pending application."""
    with TestClient(a.app) as cl:
        html=cl.get('/').text
        for role in ('maxim','olesya','lev','admin'):
            path=f'/static/roles/{role}.js'
            assert path in html
            response=cl.get(path)
            assert response.status_code==200
            assert f'window.WagonsRoles.{role}' in response.text
        src=cl.get('/static/app.js').text
        assert 'function createRole' in src
        assert 'async function renderUsers(' not in src
        assert 'function renderMaximLoads(' not in src
        pending=headers(9999,'Тест отказа')
        assert cl.get('/api/me',headers=pending).status_code==200
        rejected=cl.post('/api/users/9999/access',headers=headers(111,'Администратор'),
                         json={'role':'wagon','state':'denied'})
        assert rejected.status_code==200,rejected.text
        result=cl.get('/api/me',headers=pending).json()
        assert result['user']['state']=='denied'
        assert cl.get('/api/loads',headers=pending).status_code==403
        restored=cl.post('/api/users/9999/access',headers=headers(111,'Администратор'),
                         json={'role':'wagon','state':'active'})
        assert restored.status_code==200,restored.text
        assert cl.get('/api/loads',headers=pending).status_code==200


def test_wagon_journal_aggregate_without_pagination():
    """Only wagons, correct months/decimals/deleted rows, no 1000-row truncation."""
    with TestClient(a.app) as cl:
        admin=headers(111, 'Администратор')
        other=headers(80001,'Неодобренный')
        assert cl.get('/api/wagon-journal?month=2032-03',headers=other).status_code==403
        manager=headers(80002,'Менеджер')
        cl.get('/api/me',headers=manager)
        assert cl.post('/api/users/80002/access',headers=admin,json={'role':'manager','state':'active'}).status_code==200
        assert cl.get('/api/wagon-journal?month=2032-02',headers=manager).status_code==403
        assert cl.get('/api/wagon-journal?month=2032-00',headers=admin).status_code==400
        assert cl.get('/api/wagon-journal?month=2032-13',headers=admin).status_code==400
        assert cl.get('/api/wagon-journal?month=wrong',headers=admin).status_code==400
        before=cl.get('/api/wagon-journal?month=2032-02',headers=admin)
        assert before.status_code==200 and before.json()['total']==0
        stamp=a.now()
        with a.db() as c:
            product_id=c.execute('SELECT id FROM products LIMIT 1').fetchone()[0]
            data=[
                ('wagon','2032-02-04','loaded','68.611',0),
                ('wagon','2032-02-04','loaded','0.001',0),
                ('wagon','2032-02-05','planned','200',0),
                ('wagon','2032-02-05','progress','4',0),
                ('wagon','2032-02-06','loaded','999',1),  # soft-deleted
                ('truck','2032-02-06','loaded','200',0),  # must not mix
                ('wagon','2032-03-01','loaded','50',0),  # another month
            ]
            data.extend([('wagon','2032-02-08','planned','1',0)]*1001)
            c.executemany('''INSERT INTO loads(transport,reference,product_id,tonnes,load_date,
              status,created_by,created_at,updated_at,deleted)
              VALUES(?,'TEST',?,?,?,?,?,?,?,?)''',
              [(transport,product_id,tonnes,day,status,111,stamp,stamp,deleted)
               for transport,day,status,tonnes,deleted in data])
        r=cl.get('/api/wagon-journal?month=2032-02',headers=admin)
        assert r.status_code==200,r.text
        journal=r.json()
        assert journal['total']==1005
        assert journal['loaded']==2 and journal['remaining']==1003
        assert journal['progress']==1
        assert journal['tonnes_loaded']=='68.612'
        assert journal['days'][0]['date']=='2032-02-08' and journal['days'][0]['total']==1001
        assert journal['days'][1]['date']=='2032-02-05'
        assert journal['days'][2]['date']=='2032-02-04'
        assert journal['days'][2]['tonnes_loaded']=='68.612'
        assert cl.get('/api/wagon-journal?month=2032-03',headers=admin).json()['total']==1


def test_wagon_buyer_round_trip():
    with TestClient(a.app) as cl:
        admin=headers(111,'Администратор')
        cl.get('/api/me',headers=admin)
        pid=cl.get('/api/bootstrap',headers=admin).json()['products'][0]['id']
        body={'transport':'wagon','reference':'BUYER-TEST','product_id':pid,
              'tonnes':'50','load_date':'2026-11-02','buyer':'  ТОО Покупатель  '}
        result=cl.post('/api/loads',headers=admin,json=body)
        assert result.status_code==200,result.text
        pk=result.json()['id']
        url=f'/api/loads/{pk}'
        assert cl.get(url,headers=admin).json()['buyer']=='ТОО Покупатель'
        assert cl.patch(url,headers=admin,json={'buyer':'Другой покупатель'}).status_code==200
        assert cl.get(url,headers=admin).json()['buyer']=='Другой покупатель'
        assert cl.patch(url,headers=admin,json={'tonnes':'51'}).status_code==200
        assert cl.get(url,headers=admin).json()['buyer']=='Другой покупатель'
        listed=cl.get('/api/loads?start=2026-11-02&end=2026-11-02',headers=admin).json()
        assert next(x for x in listed if x['id']==pk)['buyer']=='Другой покупатель'
        assert cl.patch(url,headers=admin,json={'buyer':''}).status_code==400
        assert cl.get(url,headers=admin).json()['buyer']=='Другой покупатель'


def test_olesya_people_and_period_statistics():
    with TestClient(a.app) as cl:
        admin=headers(111,'Администратор'); keeper=headers(555,'Олеся'); wagon=headers(556,'Максим')
        cl.get('/api/me',headers=admin)
        for hdr,uid,role in [(keeper,555,'storekeeper'),(wagon,556,'wagon')]:
            cl.get('/api/me',headers=hdr)
            assert cl.post(f'/api/users/{uid}/access',headers=admin,json={'role':role,'state':'active'}).status_code==200
        created=cl.post('/api/loaders',headers=keeper,json={'name':'Новый грузчик Олеси'})
        assert created.status_code==200
        lid=created.json()['id']
        assert any(x['id']==lid for x in cl.get('/api/bootstrap',headers=keeper).json()['loaders'])
        assert cl.post('/api/loaders',headers=wagon,json={'name':'Запрещено'}).status_code==403
        assert cl.patch(f'/api/loaders/{lid}',headers=keeper,json={'active':False}).status_code==403
        assert cl.get('/api/warehouse-stats?start=2027-01-01&end=2027-01-02',headers=wagon).status_code==403
        pid=cl.get('/api/bootstrap',headers=admin).json()['products'][0]['id']
        with a.db() as c:
            for i in range(1002):
                c.execute("INSERT INTO loads(transport,reference,product_id,tonnes,load_date,buyer,status,created_by,created_at,updated_at) VALUES('wagon',?,?, '0.001','2027-01-01','','loaded',111,?,?)",(str(i),pid,a.now(),a.now()))
            for transport,status,deleted in [('truck','loaded',0),('truck','progress',0),('wagon','planned',0),('truck','loaded',1)]:
                c.execute("INSERT INTO loads(transport,reference,product_id,tonnes,load_date,buyer,status,deleted,created_by,created_at,updated_at) VALUES(?,'stats',?,'20.100','2027-01-02','',?,?,111,?,?)",(transport,pid,status,deleted,a.now(),a.now()))
        result=cl.get('/api/warehouse-stats?start=2027-01-01&end=2027-01-02',headers=keeper)
        assert result.status_code==200,result.text
        data=result.json();t=data['totals']
        assert t['total']==1005 and t['loaded']==1003
        assert t['tonnes_loaded']=='21.102'
        assert t['no_crew']==2 and t['planned']==1 and t['progress']==1
        assert t['wagons']==1002 and t['trucks']==1
        assert len(data['days'])==2
        truck=cl.get('/api/warehouse-stats?start=2027-01-01&end=2027-01-02&transport=truck',headers=keeper).json()['totals']
        assert truck['total']==2 and truck['tonnes_loaded']=='20.100'
        assert cl.get('/api/warehouse-stats?start=2027-01-02&end=2027-01-01',headers=keeper).status_code==400


def test_crew_starts_wagons_and_trucks():
    with TestClient(a.app) as cl:
        admin=headers(111,'Администратор')
        cl.get('/api/me',headers=admin)
        pid=cl.get('/api/bootstrap',headers=admin).json()['products'][0]['id']
        lid=cl.post('/api/loaders',headers=admin,json={'name':'Бригада статусы'}).json()['id']
        body={'buyer':'Тестовый покупатель','reference':'AUTO-STATUS','product_id':pid,'tonnes':'20','load_date':'2027-02-01'}
        for transport in ('wagon','truck'):
            pk=cl.post('/api/loads',headers=admin,json={**body,'transport':transport}).json()['id']
            url=f'/api/loads/{pk}'
            assert cl.get(url,headers=admin).json()['status']=='planned'
            assert cl.put(url+'/crew',headers=admin,json={'crew':[]}).status_code==200
            assert cl.get(url,headers=admin).json()['status']=='planned'
            assert cl.put(url+'/crew',headers=admin,json={'crew':[lid]}).status_code==200
            assert cl.get(url,headers=admin).json()['status']=='progress'
        pk=cl.post('/api/loads',headers=admin,json={**body,'transport':'truck','crew':[lid]}).json()['id']
        assert cl.get(f'/api/loads/{pk}',headers=admin).json()['status']=='progress'
        pk=cl.post('/api/loads',headers=admin,json={**body,'transport':'truck'}).json()['id']
        assert cl.patch(f'/api/loads/{pk}',headers=admin,json={'crew':[lid]}).status_code==200
        assert cl.get(f'/api/loads/{pk}',headers=admin).json()['status']=='progress'
        with a.db() as c:
            c.execute("UPDATE loads SET status='loaded',rate_snapshot='10' WHERE id=?",(pk,))
        assert cl.put(f'/api/loads/{pk}/crew',headers=admin,json={'crew':[lid]}).status_code==200
        assert cl.get(f'/api/loads/{pk}',headers=admin).json()['status']=='loaded'


def test_fixed_wagon_rates_by_product(tmp_path, monkeypatch):
    """Weight never multiplies wagon pay; product and crew still matter."""
    monkeypatch.setattr(a, 'DB_PATH', tmp_path / 'fixed-wagons.db')
    with TestClient(a.app) as cl:
        admin = headers(111, 'Админ')
        cl.get('/api/me', headers=admin)
        products = cl.get('/api/bootstrap', headers=admin).json()['products'][:2]
        assert len(products) == 2
        crew = [cl.post('/api/loaders', headers=admin, json={'name': name}).json()['id']
                for name in ['Иван', 'Пётр', 'Сергей']]
        for product, rate, expected in [(products[0], '30000.01', 3000001),
                                         (products[1], '22000', 2200000)]:
            r = cl.put('/api/tariffs', headers=admin, json={
                'transport': 'wagon', 'product_id': product['id'], 'rate': rate})
            assert r.status_code == 200, r.text
            for weight in ['60', '68.6']:
                r = cl.post('/api/loads', headers=admin, json={'buyer':'Тестовый покупатель',
                    'transport': 'wagon', 'product_id': product['id'], 'tonnes': weight,
                    'reference': f"W-{product['id']}-{weight}",
                    'load_date': '2026-11-03', 'crew': crew})
                assert r.status_code == 200, r.text
                pk = r.json()['id']
                r = cl.put(f'/api/loads/{pk}/crew', headers=admin, json={'crew': crew})
                assert r.status_code == 200, r.text
                r = cl.post(f'/api/loads/{pk}/status', headers=admin, json={'status': 'loaded'})
                assert r.status_code == 200, r.text
                load = cl.get(f'/api/loads/{pk}', headers=admin).json()
                assert load['total_cents'] == expected
                with a.db() as c:
                    payments = a.rows(c, 'SELECT amount_cents FROM payouts WHERE load_id=?', (pk,))
                shares = [p['amount_cents'] for p in payments]
                assert len(shares) == 3 and sum(shares) == expected
                assert max(shares) - min(shares) <= 1
        report = cl.get('/api/report?start=2026-11-03&end=2026-11-03', headers=admin).json()
        assert report['stats']['total_cents'] == 10400002
