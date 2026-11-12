"""Persistent daily SQLite backups and debounced GitHub source snapshots."""
import document_names
import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import sqlite3
import time
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

LOG = logging.getLogger('vagony.backup')
TZ = ZoneInfo('Asia/Almaty')
EXCLUDED = {'data','backups','.git','.venv','venv','node_modules','__pycache__','.pytest_cache','upload'}
EXTENSIONS = {'.py','.js','.cjs','.css','.html','.md','.txt','.json','.svg','.webp','.png','.jpg','.jpeg','.ico','.toml','.yaml','.yml'}
SPECIAL = {'Dockerfile','Procfile','.gitignore','.dockerignore','.env.example'}


def source_files(root):
    files = {}
    secrets = [v for k,v in os.environ.items() if any(x in k.upper() for x in ('TOKEN','SECRET','PASSWORD','PRIVATE_KEY')) and len(v)>10]
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root)
        if any(part in EXCLUDED or (part.startswith('.') and part not in SPECIAL) for part in rel.parts):
            continue
        if path.is_symlink() or not path.is_file() or any(p.is_symlink() for p in path.parents if p!=root.parent):
            continue
        if path.name not in SPECIAL and path.suffix.lower() not in EXTENSIONS:
            continue
        if any(x in path.name.lower() for x in ('credential','secret','token','backup_state')):
            continue
        content = path.read_bytes()
        if len(content)>20*1024*1024:
            raise ValueError('Source file exceeds backup limit: '+str(rel))
        if path.suffix.lower() not in {'.webp','.png','.jpg','.jpeg','.ico'}:
            text = content.decode('utf-8')
            if any(secret in text for secret in secrets) or re.search(r'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|\d{8,12}:[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)',text):
                raise ValueError('Secret detected; source backup blocked: '+str(rel))
        files[rel.as_posix()] = content
    if not {'app.py','requirements.txt','word_report.py'} <= files.keys():
        raise ValueError('Incomplete project; backup postponed')
    return files


def fingerprint(files):
    h=hashlib.sha256()
    for name,body in sorted(files.items()):
        h.update(name.encode());h.update(b'\0');h.update(hashlib.sha256(body).digest())
    return h.hexdigest()


def due_day(current,clock):
    hour,minute=map(int,clock.split(':'))
    scheduled=current.replace(hour=hour,minute=minute,second=0,microsecond=0)
    return (current.date() if current>=scheduled else current.date()-timedelta(days=1)).isoformat()


def snapshot_database(db_path,destination):
    temp=destination.with_suffix('.tmp')
    try:
        with sqlite3.connect('file:'+str(db_path.resolve())+'?mode=ro',uri=True) as src:
            with sqlite3.connect(temp) as dst:
                src.backup(dst)
                if dst.execute('PRAGMA quick_check').fetchone()[0]!='ok':
                    raise ValueError('SQLite backup integrity check failed')
        temp.replace(destination)
    finally:
        temp.unlink(missing_ok=True)


class BackupService:
    def __init__(self,root,db_path,bot_token,admin_id):
        self.root=Path(root);self.db=Path(db_path);self.bot_token=bot_token;self.admin_id=admin_id
        self.directory=self.db.parent/'backups'
        self.state_path=self.directory/'backup_state.json'
        self.lock=asyncio.Lock()
        try:self.state=json.loads(self.state_path.read_text())
        except (OSError,ValueError):self.state={}
        self.state.setdefault('installed_day',datetime.now(TZ).date().isoformat())
        self.candidate=None;self.changed_at=0
        self.clock=os.getenv('BACKUP_TIME','23:30')
        due_day(datetime.now(TZ),self.clock)  # Validate before starting the task.
        self.repo=os.getenv('GITHUB_BACKUP_REPO','arladiy96-commits/Baza-Vagon').strip()
        self.token=os.getenv('GITHUB_BACKUP_TOKEN','').strip()
        self.branch=os.getenv('GITHUB_BACKUP_BRANCH','main').strip()
        self.db_enabled=os.getenv('DB_BACKUP_ENABLED','0')=='1'
        if self.token and not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',self.repo):
            raise ValueError('Invalid GITHUB_BACKUP_REPO')

    def save_state(self):
        self.directory.mkdir(parents=True,exist_ok=True)
        temp=self.state_path.with_suffix('.tmp')
        temp.write_text(json.dumps(self.state,ensure_ascii=False),encoding='utf-8')
        temp.replace(self.state_path)

    def status(self):
        return {'db_enabled':self.db_enabled,'clock':self.clock,'telegram_ready':bool(self.bot_token and self.admin_id),
                'github_enabled':bool(self.token),'busy':self.lock.locked(),
                **{k:self.state.get(k) for k in ('db_sent_at','db_error','db_error_at','source_saved_at','source_error','source_error_at')}}

    def record_error(self,prefix,exc):
        # Never expose exception URLs, response bodies or credentials.
        self.state[prefix+'_error']='Ошибка '+type(exc).__name__+'. Проверь настройки и соединение.'
        self.state[prefix+'_error_at']=datetime.now(TZ).isoformat();self.save_state()

    async def send_file(self,file,caption):
        if not self.bot_token or not self.admin_id:
            raise ValueError('Telegram not configured')
        async with httpx.AsyncClient(timeout=120) as client:
            with file.open('rb') as stream:
                response=await client.post(f'https://api.telegram.org/bot{self.bot_token}/sendDocument',
                    data={'chat_id':str(self.admin_id),'caption':caption},
                    files={'document':(document_names.backup_filename(datetime.fromtimestamp(file.stat().st_mtime,TZ).strftime('%Y-%m-%d'),datetime.fromtimestamp(file.stat().st_mtime,TZ).strftime('%H-%M-%S')),stream,'application/octet-stream')})
            if response.status_code!=200 or not response.json().get('ok'):
                raise ValueError('Telegram backup rejected')
        self.state['db_sent_at']=datetime.now(TZ).isoformat()
        self.state['db_error']=None;self.state['db_error_at']=None;self.save_state()

    async def manual(self):
        async with self.lock:
            self.directory.mkdir(parents=True,exist_ok=True)
            try:
                with tempfile.TemporaryDirectory(prefix='manual-',dir=self.directory) as folder:
                    file=Path(folder)/('vagony_manual_'+datetime.now(TZ).strftime('%Y-%m-%d_%H-%M-%S')+'.sqlite3')
                    await asyncio.to_thread(snapshot_database,self.db,file)
                    await self.send_file(file,'Резервная копия «ГрузКонтроль» по запросу администратора')
            except Exception as exc:
                self.record_error('db',exc);raise

    async def daily(self):
        async with self.lock:
            await self._daily()

    async def _daily(self):
        if not self.db_enabled:return
        if not self.bot_token or not self.admin_id:
            raise ValueError('Daily backup requires BOT_TOKEN and ADMIN_TG_ID')
        current=datetime.now(TZ);day=due_day(current,self.clock)
        if self.state.get('sent_day','')>=day:return
        # On first installation wait for the first scheduled time, not yesterday.
        if day<self.state['installed_day']:return
        pending=sorted(p.stem.removeprefix('vagony_') for p in self.directory.glob('vagony_*.sqlite3')
                       if self.state.get('sent_day','')<p.stem.removeprefix('vagony_')<=day)
        if pending:day=pending[0]
        file=self.directory/('vagony_'+day+'.sqlite3')
        if not file.exists():
            await asyncio.to_thread(snapshot_database,self.db,file)
        await self.send_file(file,'Резервная копия «ГрузКонтроль» за '+datetime.strptime(day,'%Y-%m-%d').strftime('%d.%m.%Y')+'\nСоздана: '+datetime.fromtimestamp(file.stat().st_mtime,TZ).strftime('%d.%m.%Y %H:%M'))
        self.state['sent_day']=day;self.save_state()
        # Keep the latest 30 successful daily snapshots locally.
        for old in sorted(self.directory.glob('vagony_*.sqlite3'))[:-30]:old.unlink()
        LOG.info('Daily database backup delivered: %s',day)

    async def sync_project(self,files):
        headers={'Authorization':'Bearer '+self.token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
        async with httpx.AsyncClient(base_url='https://api.github.com',headers=headers,timeout=60) as client:
            async def call(method,path,body=None):
                r=await client.request(method,'/repos/'+self.repo+path,json=body)
                if r.status_code>=300:
                    raise ValueError('GitHub backup failed: HTTP '+str(r.status_code))
                return r.json()
            info=await call('GET','')
            if not info.get('private'):raise ValueError('GitHub backup requires a private repository')
            head=await call('GET','/git/ref/heads/'+self.branch)
            parent=head['object']['sha'];commit=await call('GET','/git/commits/'+parent)
            entries=[]
            # Git blob SHA lets unchanged objects be reused without uploading bytes.
            tree=await call('GET','/git/trees/'+commit['tree']['sha'])
            project=next((x for x in tree['tree'] if x['path']=='project' and x['type']=='tree'),None)
            existing=set()
            if project:
                old=await call('GET','/git/trees/'+project['sha']+'?recursive=1')
                if old.get('truncated'):raise ValueError('Project tree is too large')
                existing={x['sha'] for x in old['tree'] if x['type']=='blob'}
            for name,content in files.items():
                sha=hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()
                if sha not in existing:
                    blob=await call('POST','/git/blobs',{'content':base64.b64encode(content).decode(),'encoding':'base64'})
                    sha=blob['sha']
                entries.append({'path':name,'mode':'100644','type':'blob','sha':sha})
            subtree=await call('POST','/git/trees',{'tree':entries})
            if project and project['sha']==subtree['sha']:return
            result=await call('POST','/git/trees',{'base_tree':commit['tree']['sha'],'tree':[{'path':'project','mode':'040000','type':'tree','sha':subtree['sha']}]})
            new=await call('POST','/git/commits',{'message':'Автокопия JustRun '+datetime.now(TZ).isoformat(timespec='seconds'),'tree':result['sha'],'parents':[parent]})
            await call('PATCH','/git/refs/heads/'+self.branch,{'sha':new['sha'],'force':False})

    async def run(self):
        self.directory.mkdir(parents=True,exist_ok=True)
        self.save_state()
        next_daily=next_project=0
        while True:
            await asyncio.sleep(15)
            if time.monotonic()>=next_daily:
                try:await self.daily()
                except Exception as exc:
                    self.record_error('db',exc)
                    LOG.warning('Database backup pending (%s); retry in 15 minutes',type(exc).__name__)
                    next_daily=time.monotonic()+900
            if not self.token or time.monotonic()<next_project:continue
            try:
                files=await asyncio.to_thread(source_files,self.root);digest=fingerprint(files)
                if digest!=self.candidate:
                    self.candidate=digest;self.changed_at=time.monotonic();continue
                if time.monotonic()-self.changed_at<300 or digest==self.state.get('source_hash'):continue
                await self.sync_project(files)
                self.state['source_hash']=digest;self.state['source_saved_at']=datetime.now(TZ).isoformat();self.state['source_error']=None;self.state['source_error_at']=None;self.save_state()
                LOG.info('Project backup saved to GitHub')
            except Exception as exc:
                self.record_error('source',exc)
                LOG.warning('Project backup pending (%s); retry in 5 minutes',type(exc).__name__)
                next_project=time.monotonic()+300
