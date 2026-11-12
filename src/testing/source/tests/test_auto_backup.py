import asyncio
import sqlite3
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
import httpx
import pytest
import auto_backup as b


def test_source_filter_and_secret_guard(tmp_path,monkeypatch):
    for name in ('app.py','requirements.txt','word_report.py'):(tmp_path/name).write_text('safe')
    (tmp_path/'static').mkdir();(tmp_path/'static'/'icon.webp').write_bytes(b'abc')
    (tmp_path/'.env').write_text('secret');(tmp_path/'db.sqlite3').write_bytes(b'secret')
    (tmp_path/'data').mkdir();(tmp_path/'data'/'hidden.py').write_text('secret')
    (tmp_path/'link.py').symlink_to(tmp_path/'app.py')
    files=b.source_files(tmp_path)
    assert set(files)=={'app.py','word_report.py','requirements.txt','static/icon.webp'}
    first=b.fingerprint(files);(tmp_path/'app.py').write_text('changed')
    assert b.fingerprint(b.source_files(tmp_path))!=first
    monkeypatch.setenv('GITHUB_BACKUP_TOKEN','a-unique-test-secret-value')
    (tmp_path/'app.py').write_text('a-unique-test-secret-value')
    with pytest.raises(ValueError,match='Secret detected'):b.source_files(tmp_path)


def test_due_day_and_snapshot(tmp_path):
    tz=ZoneInfo('Asia/Almaty')
    assert b.due_day(datetime(2026,11,4,23,29,tzinfo=tz),'23:30')=='2026-11-03'
    assert b.due_day(datetime(2026,11,4,23,30,tzinfo=tz),'23:30')=='2026-11-04'
    db=tmp_path/'live.sqlite3';out=tmp_path/'copy.sqlite3'
    with sqlite3.connect(db) as c:c.execute('CREATE TABLE example(value)');c.execute('INSERT INTO example VALUES(42)')
    b.snapshot_database(db,out)
    with sqlite3.connect(out) as c:assert c.execute('SELECT value FROM example').fetchone()[0]==42


def test_daily_retry_and_restart(tmp_path,monkeypatch):
    monkeypatch.setenv('DB_BACKUP_ENABLED','1')
    db=tmp_path/'live.sqlite3'
    with sqlite3.connect(db) as c:c.execute('CREATE TABLE example(value)')
    service=b.BackupService(tmp_path,db,'fake',111)
    service.directory.mkdir();service.state={'installed_day':'2020-01-01'}
    calls=[];fail=[True];real=httpx.AsyncClient
    def handler(request):
        calls.append(request)
        return httpx.Response(500 if fail[0] else 200,json={'ok':not fail[0]})
    monkeypatch.setattr(b.httpx,'AsyncClient',lambda **kw:real(transport=httpx.MockTransport(handler),**kw))
    with pytest.raises(ValueError):asyncio.run(service.daily())
    assert 'sent_day' not in service.state
    file=next(service.directory.glob('*.sqlite3'));saved=file.read_bytes()
    fail[0]=False;asyncio.run(service.daily())
    assert file.read_bytes()==saved and 'sent_day' in service.state
    restored=b.BackupService(tmp_path,db,'fake',111)
    restored.state=b.json.loads(restored.state_path.read_text())
    asyncio.run(restored.daily());assert len(calls)==2


def test_github_snapshot_no_force_preserves_root(tmp_path,monkeypatch):
    monkeypatch.setenv('GITHUB_BACKUP_TOKEN','fake')
    service=b.BackupService(tmp_path,tmp_path/'db.sqlite3','fake',111)
    calls=[];real=httpx.AsyncClient
    def handler(request):
        body=b.json.loads(request.content) if request.content else None
        calls.append((request.method,request.url.path,body))
        path=request.url.path
        if path.endswith('/Baza-Vagon'):return httpx.Response(200,json={'private':True})
        if '/git/ref/' in path:return httpx.Response(200,json={'object':{'sha':'parent'}})
        if path.endswith('/git/commits/parent'):return httpx.Response(200,json={'tree':{'sha':'root'}})
        if request.method=='GET' and path.endswith('/git/trees/root'):return httpx.Response(200,json={'tree':[]})
        return httpx.Response(201,json={'sha':'new'})
    monkeypatch.setattr(b.httpx,'AsyncClient',lambda **kw:real(transport=httpx.MockTransport(handler),**kw))
    asyncio.run(service.sync_project({'app.py':b'print(1)'}))
    assert calls[-1][0]=='PATCH' and calls[-1][2]=={'sha':'new','force':False}
    trees=[c[2] for c in calls if c[0]=='POST' and c[1].endswith('/git/trees')]
    assert trees[-1]['base_tree']=='root' and trees[-1]['tree'][0]['path']=='project'
