"""Build a static PWA; only testing builds contain the offline Python runtime."""
import ast, concurrent.futures, hashlib, json, os, re, shutil, subprocess, sys, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SRC, OUT, CACHE = ROOT/'src', ROOT/'dist', ROOT/'vendor-cache'
MODE = os.environ.get('PWA_MODE', 'test')
if MODE not in ('test', 'server'): raise SystemExit('PWA_MODE must be test or server')
BASE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/'
WHEELS = ['reportlab==4.4.10', 'xlsxwriter==3.2.9', 'charset-normalizer==3.4.4']

def download(name):
    path = CACHE/name
    if not path.exists():
        for attempt in range(3):
            try:
                with urllib.request.urlopen(BASE+name, timeout=90) as r: data = r.read()
                path.write_bytes(data); break
            except Exception:
                if attempt == 2: raise
    return path

def engine():
    original = SRC/'testing/source/app.py'
    tree = ast.parse(original.read_text())
    skip = {'auth_telegram','current_user','active','telegram','dispatch_notifications','configure_bot','lifespan','index','health','webhook','live_events','backup_status','send_backup'}
    nodes=[]; pdf_imports=[]
    for n in tree.body:
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            module = n.module if isinstance(n,ast.ImportFrom) else n.names[0].name
            if module.startswith('reportlab'): pdf_imports.append(n); continue
            if module in ('httpx','auto_backup') or module.startswith('fastapi'): continue
            nodes.append(n)
        elif isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)):
            if n.name in skip: continue
            if n.name=='build_pdf': n.body=pdf_imports+n.body
            if n.name=='send_report':
                # Keep original validation/data selection/document generation. Replace delivery only.
                n.body=[x for x in n.body if not (isinstance(x,ast.If) and ('user[\'started\']' in ast.unparse(x.test) or 'BOT_TOKEN' in ast.unparse(x.test)))]
                idx=next(i for i,x in enumerate(n.body) if isinstance(x,ast.Try))
                n.body=n.body[:idx]+ast.parse("return Response(contents, media_type={'pdf':'application/pdf','xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}[fmt],headers={'Content-Disposition':document_names.disposition(filename)})").body
            nodes.append(n)
        elif isinstance(n,ast.Assign):
            names=[t.id for t in n.targets if isinstance(t,ast.Name)]
            if names and names[0] in {'ROOT','TZ','LOGGER','ROLES','STATUS','TRANSPORT'}: nodes.append(n)
    prelude=(SRC/'testing/engine/prelude.py').read_text()
    code=ast.unparse(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])))
    # Future annotations must precede prelude.
    code=code.replace('from __future__ import annotations','')
    target=OUT/'testing'; target.mkdir()
    (target/'domain.py').write_text('from __future__ import annotations\n'+prelude+'\n'+code)
    for p in (SRC/'testing/source').glob('*.py'):
        if p.name not in ('app.py','auto_backup.py'): shutil.copy2(p,target/p.name)
    shutil.copy2(SRC/'testing/engine/bridge.py',target/'bridge.py')
    shutil.copy2(SRC/'testing/worker.js',target/'worker.js')
    # Runtime and wheels are self-hosted and precached, never CDN-loaded at runtime.
    CACHE.mkdir(exist_ok=True)
    lock=json.loads(download('pyodide-lock.json').read_text())
    packages=['sqlite3','tzdata','pillow']
    files=['pyodide.js','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json']
    files += [lock['packages'][k]['file_name'] for k in packages]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool: list(pool.map(download,files))
    if not all(list(CACHE.glob(x.split('==')[0].replace('-','_')+'-*.whl')) for x in WHEELS):
        subprocess.run([sys.executable,'-m','pip','download','--no-deps','--only-binary=:all:','--platform','any','--python-version','312','-d',str(CACHE),*WHEELS],check=True)
    runtime=target/'runtime';runtime.mkdir()
    (runtime/'package.json').write_text('{"type":"commonjs"}')
    for name in files:
        path=CACHE/name
        pkg=next((v for v in lock['packages'].values() if v['file_name']==name),None)
        if pkg and hashlib.sha256(path.read_bytes()).hexdigest()!=pkg['sha256']: raise RuntimeError('Invalid package hash: '+name)
        shutil.copy2(path,runtime/name)
    wheels=[]
    for requirement in WHEELS:
        wheel=next(CACHE.glob(requirement.split('==')[0].replace('-','_')+'-*.whl'))
        shutil.copy2(wheel,target/wheel.name);wheels.append(wheel.name)
    font=ROOT/'assets/DejaVuSans.ttf'
    shutil.copy2(font,target/font.name)
    (target/'runtime-files.json').write_text(json.dumps({'packages':packages,'wheels':wheels}))

if OUT.exists(): shutil.rmtree(OUT)
OUT.mkdir()
shutil.copytree(SRC/'static',OUT/'static')
shutil.copytree(SRC/'client',OUT/'client')
shutil.copytree(ROOT/'assets/icons',OUT/'icons')
# No host-root paths: works at /PWA/ on GitHub Pages and any future base path.
for p in (OUT/'static').rglob('*.css'):
    text=p.read_text(); text=text.replace("url('/static/assets/", "url('./assets/")
    p.write_text(text)
config={'mode':MODE,'apiBase':os.environ.get('PWA_API_BASE',''),'loginPath':'/api/auth/login','logoutPath':'/api/auth/logout'}
(OUT/'client/config.js').write_text('export default Object.freeze('+json.dumps(config)+');\n')
html=(SRC/'static/index.html').read_text()
html=re.sub(r'  <script.*?</script>\n','',html)
html=re.sub(r'(["\'])/static/',r'\1./static/',html)
html=html.replace('</head>','''  <link rel="manifest" href="./manifest.webmanifest">
  <link rel="apple-touch-icon" sizes="180x180" href="./icons/gruzcontrol-180.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <link rel="stylesheet" href="./client/pwa.css">
  <link rel="stylesheet" href="./client/launch.css">
  <link rel="preload" as="image" href="./icons/gruzcontrol-512.png">
  <script type="module" src="./client/launch.js"></script>
  <script type="module" src="./client/start.js"></script>
</head>''')
html=html.replace('ВА Г О Н Ы','ГрузКонтроль').replace('Подключаемся к серверу...','Открываем приложение…')
html=html.replace('<body>', '<body>\n'+(SRC/'client/launch.html').read_text())
html=html.replace('content="#081323"', 'content="#171c22"')
(OUT/'index.html').write_text(html)
(OUT/'manifest.webmanifest').write_text(json.dumps({'id':'./','name':'ГрузКонтроль'+(' · тест' if MODE=='test' else ''),'short_name':'ГрузКонтроль','lang':'ru','start_url':'./','scope':'./','display':'standalone','background_color':'#171c22','theme_color':'#171c22','icons':[{'src':f'./icons/gruzcontrol-{size}.png','sizes':f'{size}x{size}','type':'image/png','purpose':'any'} for size in [192,512]]+[{'src':'./icons/gruzcontrol-maskable-512.png','sizes':'512x512','type':'image/png','purpose':'maskable'}]},ensure_ascii=False))
(OUT/'.nojekyll').touch()
if MODE=='test': engine()
else:
    (OUT/'client/test-adapter.js').unlink()
    if not config['apiBase'].startswith('https://'): raise SystemExit('Server build requires HTTPS PWA_API_BASE')
assets=sorted('./'+p.relative_to(OUT).as_posix() for p in OUT.rglob('*') if p.is_file())
version=hashlib.sha256(b''.join((OUT/p[2:]).read_bytes() for p in assets)).hexdigest()[:16]
sw=(SRC/'sw.js').read_text().replace('__VERSION__',version).replace('__ASSETS__',json.dumps(assets))
(OUT/'sw.js').write_text(sw)
print(f'Built {MODE}: {len(assets)} assets, {sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())/1024/1024:.1f} MiB')
