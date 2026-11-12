from test_app import a,headers,TestClient
import asyncio
import sqlite3
import httpx
import auto_backup as b


def test_trash_restores_relations_money_and_protects_edits(tmp_path,monkeypatch):
    monkeypatch.setattr(a,'DB_PATH',tmp_path/'trash.db')
    with TestClient(a.app) as cl:
        adm=headers(111,'Админ');other=headers(444,'Лев')
        for h in (adm,other):cl.get('/api/me',headers=h)
        with a.db() as c:c.execute("UPDATE users SET role='manager',state='active' WHERE tg_id=444")
        def req(method,path,body=None):
            r=cl.request(method,path,headers=adm,json=body);assert r.status_code==200,r.text;return r.json()
        def trash():return req('GET','/api/admin/trash')
        def restore():return req('POST',f"/api/admin/trash/{trash()[0]['id']}/restore")
        def pending():return req('GET','/api/statements/pending')['stats']['total_cents']
        pid=req('GET','/api/products')[0]['id']
        people=[req('POST','/api/loaders',{'name':n})['id'] for n in ('Один','Два')]
        req('PUT','/api/tariffs',{'transport':'truck','product_id':pid,'rate':'100','rate_over20':'200'})
        lid=req('POST','/api/loads',{'transport':'truck','reference':'123','buyer':'Покупатель','tonnes':'10','load_date':a.today(),'product_id':pid,'crew':people})['id']
        path=f'/api/loads/{lid}'
        req('POST',path+'/status',{'status':'loaded'})
        due=req('GET','/api/statements/pending');req('POST','/api/statements',{'token':due['token']})
        req('DELETE',path);assert pending()==-100000
        tid=trash()[0]['id']
        assert cl.get('/api/admin/trash',headers=other).status_code==403
        assert cl.post(f'/api/admin/trash/{tid}/restore',headers=other).status_code==403
        restore();assert pending()==0 and not trash()
        req('POST',f'/api/admin/trash/{tid}/restore');assert pending()==0
        req('DELETE',f'/api/admin/loaders/{people[0]}')
        assert req('GET',path)['crew']==people
        restore();assert sorted(req('GET',path)['crew'])==people and pending()==0
        req('DELETE',f'/api/admin/products/{pid}')
        assert len(req('GET','/api/loads?start='+a.today()+'&end='+a.today()))==1
        restore();assert req('GET',path)['status']=='loaded' and pending()==0
        with a.db() as c:assert c.execute('SELECT rate FROM tariffs WHERE product_id=?',(pid,)).fetchone()[0]=='100'
        # Restoring a catalog entry leaves later work edits intact.
        req('DELETE',f'/api/admin/loaders/{people[0]}');tid=trash()[0]['id']
        req('PATCH',path,{'tonnes':'12'})
        assert cl.post(f'/api/admin/trash/{tid}/restore',headers=adm).status_code==200
        assert req('GET',path)['tonnes']=='12'
        assert len(trash())==0
        assert cl.get('/api/admin/backups/status',headers=other).status_code==403
        assert cl.post('/api/admin/backups/send',headers=other).status_code==403
        status=req('GET','/api/admin/backups/status')
        assert 'token' not in status and status['telegram_ready']
        req('POST','/api/admin/reset',{'confirmation':'УДАЛИТЬ'})
        assert not trash()


def test_manual_backup_repeat_does_not_skip_daily_and_has_safe_errors(tmp_path,monkeypatch):
    db=tmp_path/'test.sqlite3'
    with sqlite3.connect(db) as c:c.execute('CREATE TABLE demo (n)');c.execute('INSERT INTO demo VALUES(42)')
    service=b.BackupService(tmp_path,db,'fake-secret',111)
    calls=[];failed=[False];real=httpx.AsyncClient
    def handler(request):
        calls.append(request.content)
        return httpx.Response(500 if failed[0] else 200,json={'ok':not failed[0]})
    monkeypatch.setattr(b.httpx,'AsyncClient',lambda **kw:real(transport=httpx.MockTransport(handler),**kw))
    asyncio.run(service.manual());asyncio.run(service.manual())
    assert len(calls)==2 and b'SQLite format 3' in calls[0]
    assert service.state.get('sent_day') is None
    assert service.status()['db_sent_at'] and not service.status()['busy']
    failed[0]=True
    try:asyncio.run(service.manual())
    except ValueError:pass
    else:assert False
    assert service.status()['db_error'] and 'fake-secret' not in str(service.status())
    assert not list(service.directory.glob('manual-*'))
    failed[0]=False;asyncio.run(service.manual())
    assert service.status()['db_error'] is None
    restored=b.BackupService(tmp_path,db,'fake-secret',111)
    assert restored.status()['db_sent_at']==service.status()['db_sent_at']
