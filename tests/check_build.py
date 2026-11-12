import ast,json,os,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
source=ast.parse((root/'src/testing/source/app.py').read_text())
local=ast.parse((root/'dist/testing/domain.py').read_text())
a={n.name:ast.dump(n,include_attributes=False) for n in source.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
b={n.name:ast.dump(n,include_attributes=False) for n in local.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
for name in ['recompute','create_load','edit_load','set_status','update_crew','pending_statement','statement_submit','statement_resubmit','cancel_statement','report_data','manager_stats','loader_ledger','restore_trash']:
 assert a[name]==b[name],name+' diverged from original'
print('Original business functions are AST-identical')
# Prove that server builds physically omit the entire offline engine.
subprocess.run([sys.executable,'tools/build.py'],cwd=root,env={**os.environ,'PWA_MODE':'server','PWA_API_BASE':'https://server.invalid'},check=True)
assert not (root/'dist/testing').exists()
assert not (root/'dist/client/test-adapter.js').exists()
assert not list((root/'dist').rglob('*.py'))
assert not list((root/'dist').rglob('*.wasm'))
assert not list((root/'dist').rglob('*.sqlite3'))
print('Server build contains no local domain/runtime/database')
subprocess.run([sys.executable,'tools/build.py'],cwd=root,env={**os.environ,'PWA_MODE':'test'},check=True)
