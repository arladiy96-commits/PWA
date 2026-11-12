"""Unloading ledger and isolated revisions on a disposable database."""
import io
import json
import zipfile
import sqlite3
import pytest
from test_app import a, headers, TestClient
from loader_report import summary_rows


@pytest.fixture
def env(tmp_path,monkeypatch):
    monkeypatch.setattr(a,'DB_PATH',tmp_path/'contractor.db')
    with TestClient(a.app) as cl:
        admin=headers(111,'Админ');lev=headers(444,'Лев');other=headers(333,'Олеся')
        for h in (admin,lev,other):cl.get('/api/me',headers=h)
        with a.db() as c:
            c.execute("UPDATE users SET state='active',role='manager' WHERE tg_id=444")
            c.execute("UPDATE users SET state='active',role='storekeeper' WHERE tg_id=333")
        def req(method,url,body=None,h=admin):
            r=cl.request(method,url,headers=h,json=body)
            assert r.status_code==200,r.text
            return r.json()
        products={p['name']:p['id'] for p in req('GET','/api/products')}
        crew=[req('POST','/api/loaders',{'name':n})['id'] for n in ('Яков','Андрей','Борис')]
        for pid in products.values():
            for t in ('wagon','truck'):req('PUT','/api/tariffs',{'product_id':pid,'transport':t,'rate':'1000','rate_over20':'1100'})
        def load(product='Мука',transport='wagon',day='2026-11-02'):
            r=req('POST','/api/loads',{'transport':transport,'reference':'12345678','buyer':'Покупатель','product_id':products[product],
                                    'tonnes':'50','load_date':day,'crew':crew})
            req('POST',f"/api/loads/{r['id']}/status",{'status':'loaded'})
            return r['id']
        def submit():
            d=req('GET','/api/statements/pending')
            return req('POST','/api/statements',{'token':d['token']},h=lev)['id']
        def rates():
            for name,r in [('Мука','600'),('Отруби','400')]:req('PUT','/api/contractor-rates',{'product_id':products[name],'rate':r},h=lev)
        yield cl,req,products,crew,load,submit,rates,admin,lev,other


def test_old_statement_revision_is_scoped_paid_and_identity_preserved(env):
    cl,req,products,crew,load,submit,rates,adm,lev,other=env
    x=load();y=load('Отруби');truck=load(transport='truck')
    sid=submit();old=req('GET',f'/api/statements/{sid}')
    z=load(day='2026-11-02');second=submit();second_before=req('GET',f'/api/statements/{second}')
    pending_load=load(day='2026-11-03')
    with a.db() as c:old_payouts=a.rows(c,'SELECT * FROM payouts ORDER BY load_id,loader_id')
    rates()
    # Configuring tariffs alone must not modify historical data or paid snapshots.
    assert req('GET',f'/api/statements/{sid}')==old
    req('POST',f'/api/admin/statements/{sid}/cancel')
    assert {x['load_id'] for x in req('GET','/api/statements/pending')['details']}=={pending_load}
    assert req('GET','/api/statements',h=adm)[-1]['cancelled']==1
    assert sid not in {x['id'] for x in req('GET','/api/statements',h=lev)}
    url=f'/api/admin/statements/{sid}/revision'
    draft=req('GET',url+'?include_contractor=true')
    extras=[x for x in draft['details'] if x.get('is_contractor')]
    assert {x['load_id'] for x in extras}=={x,y}
    assert sum(x['amount_cents'] for x in extras)==100000
    assert draft['by_loader'][-1]['name']=='Наемник на тупике'
    assert draft['stats']['loads']==3 and draft['stats']['wagons']==2
    assert draft['stats']['total_cents']==old['stats']['total_cents']+100000
    body={'token':draft['token'],'include_contractor':True}
    assert req('POST',f'/api/admin/statements/{sid}/resubmit',body)['id']==sid
    assert req('POST',f'/api/admin/statements/{sid}/resubmit',body)['id']==sid
    new=req('GET',f'/api/statements/{sid}')
    for key in ('id','created_at','from','to'):assert new[key]==old[key]
    assert new['by_loader'][:-1]==old['by_loader']
    assert req('GET',f'/api/statements/{second}')==second_before
    assert {x['load_id'] for x in req('GET','/api/statements/pending')['details']}=={pending_load}
    with a.db() as c:
        assert a.rows(c,'SELECT * FROM payouts ORDER BY load_id,loader_id')==old_payouts
        assert c.execute('SELECT COUNT(*) FROM statements').fetchone()[0]==2
        assert c.execute('SELECT COUNT(*) FROM contractor_lines').fetchone()[0]==2
        assert json.loads(c.execute('SELECT snapshot FROM statement_revisions WHERE statement_id=?',(sid,)).fetchone()[0])['by_loader']==old['by_loader']
    assert list(a.DB_PATH.parent.glob('statement_backups/*.sqlite3'))
    # Restart preserves both the frozen amounts and the revision identity.
    a.init_db();assert req('GET',f'/api/statements/{sid}')==new
    req('POST',f'/api/admin/statements/{sid}/cancel')
    draft=req('GET',url+'?include_contractor=true')
    assert draft['stats']['total_cents']==new['stats']['total_cents']
    req('POST',f'/api/admin/statements/{sid}/resubmit',{'token':draft['token'],'include_contractor':True})
    assert req('GET','/api/loader-ledger/0?start=2026-11-01&end=2026-11-30')['balance_cents']==0


def test_auto_rates_reports_and_paid_totals(env):
    cl,req,products,crew,load,submit,rates,adm,lev,other=env
    rates();x=load();y=load('Отруби');load(transport='truck')
    report=req('GET','/api/report?start=2026-11-01&end=2026-11-30')
    assert report['by_loader'][-1]['name']=='Наемник на тупике'
    assert report['by_loader'][-1]['amount_cents']==100000
    assert report['stats']['wagons']==2 and report['stats']['tonnes']=='150'
    assert report['stats']['total_cents']==5800000
    stats=req('GET','/api/manager-stats?start=2026-11-01&end=2026-11-30')
    assert stats['totals']['amount_cents']==report['stats']['total_cents']
    assert stats['people'][-1]['loader_id']==0
    assert stats['totals']['tonnes']=='150'
    assert summary_rows(report)[1][-1]['name']=='Наемник на тупике'
    assert cl.get('/api/contractor-rates',headers=other).status_code==403
    sid=submit();d=req('GET',f'/api/statements/{sid}')
    assert d['by_loader'][-1]['amount_cents']==100000
    assert not req('GET','/api/statements/pending')['details']
    assert req('GET','/api/manager-stats?start=2026-11-01&end=2026-11-30')['balance_cents']==0
    assert req('GET','/api/loader-ledger/0?start=2026-11-01&end=2026-11-30')['paid_cents']==100000
    req('PUT','/api/contractor-rates',{'product_id':products['Мука'],'rate':'900'},h=lev)
    assert req('GET',f'/api/statements/{sid}')==d
    assert req('GET','/api/report?start=2026-11-01&end=2026-11-30')['by_loader'][-1]['amount_cents']==100000
    new=load()
    assert req('GET','/api/statements/pending')['by_loader'][-1]['amount_cents']==90000
    for fmt in ('docx','xlsx'):
        r=cl.get(f'/api/statements/{sid}/export?fmt={fmt}',headers=adm);assert r.status_code==200,r.text
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            xml=''.join(z.read(n).decode() for n in z.namelist() if n.endswith('.xml'))
            assert 'Наемник на тупике' in xml
            assert '02.11.2026' in xml
    xml=zipfile.ZipFile(io.BytesIO(a.build_docx(d))).read('word/document.xml').decode()
    assert xml.rfind('Наемник на тупике')>xml.rfind('Яков')
    assert a.build_pdf(report).startswith(b'%PDF')
    assert req('GET','/api/manager-stats?start=2026-11-01&end=2026-11-30&transport=truck')['people'][-1]['loader_id']!=0


def test_preview_atomicity_access_and_tariff_race(env):
    cl,req,products,crew,load,submit,rates,adm,lev,other=env
    x=load();load('Отруби');sid=submit()
    req('POST',f'/api/admin/statements/{sid}/cancel')
    url=f'/api/admin/statements/{sid}/revision'
    assert cl.get(url+'?include_contractor=true',headers=adm).status_code==409
    with a.db() as c:assert c.execute('SELECT COUNT(*) FROM contractor_payouts').fetchone()[0]==0
    assert cl.get(url,headers=lev).status_code==403
    rates();d=req('GET',url+'?include_contractor=true')
    req('PUT','/api/contractor-rates',{'product_id':products['Мука'],'rate':'700'})
    body={'token':d['token'],'include_contractor':True}
    assert cl.post(f'/api/admin/statements/{sid}/resubmit',headers=lev,json=body).status_code==403
    assert cl.post(f'/api/admin/statements/{sid}/resubmit',headers=adm,json=body).status_code==409
    with a.db() as c:assert c.execute('SELECT COUNT(*) FROM contractor_payouts').fetchone()[0]==0
    d=req('GET',url+'?include_contractor=true')
    # Revert checkbox: no historical contractor entries are persisted by preview.
    d=req('GET',url)
    req('POST',f'/api/admin/statements/{sid}/resubmit',{'token':d['token']})
    with a.db() as c:assert c.execute('SELECT COUNT(*) FROM contractor_payouts').fetchone()[0]==0


def test_reopen_delete_restore_and_fixed_rate(env):
    cl,req,products,crew,load,submit,rates,adm,lev,other=env
    rates();x=load();sid=submit()
    req('PUT','/api/contractor-rates',{'product_id':products['Мука'],'rate':'900'})
    req('POST',f'/api/loads/{x}/status',{'status':'planned'})
    assert req('GET','/api/statements/pending')['by_loader'][-1]['amount_cents']==-60000
    req('POST',f'/api/loads/{x}/status',{'status':'loaded'})
    assert not req('GET','/api/statements/pending')['details']
    req('DELETE',f'/api/loads/{x}')
    assert req('GET','/api/statements/pending')['by_loader'][-1]['amount_cents']==-60000
    trash=req('GET','/api/admin/trash')[0]
    req('POST',f"/api/admin/trash/{trash['id']}/restore")
    assert not req('GET','/api/statements/pending')['details']
    # Failed missing unloading tariff must leave both ledgers and status unchanged.
    pid=req('POST','/api/products',{'name':'Другая продукция'})['id']
    req('PUT','/api/tariffs',{'product_id':pid,'transport':'wagon','rate':'1'})
    r=req('POST','/api/loads',{'transport':'wagon','reference':'789','buyer':'Покупатель','product_id':pid,'tonnes':'2','crew':crew})
    assert cl.post(f"/api/loads/{r['id']}/status",headers=adm,json={'status':'loaded'}).status_code==409
    assert req('GET',f"/api/loads/{r['id']}")['payouts']==[]
