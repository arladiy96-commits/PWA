const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../dist/testing');
const {loadPyodide}=require(root+'/runtime/pyodide.js');
(async()=>{
 const py=await loadPyodide({indexURL:root+'/runtime/'});
 const manifest=JSON.parse(fs.readFileSync(root+'/runtime-files.json'));
 await py.loadPackage(manifest.packages);
 py.FS.mkdirTree('/engine');py.FS.mkdirTree('/data');py.FS.mkdirTree('/usr/local/share/fonts');
 for(const name of fs.readdirSync(root)){if(/\.(py|whl)$/.test(name))py.FS.writeFile('/engine/'+name,fs.readFileSync(root+'/'+name));}
 py.FS.writeFile('/usr/local/share/fonts/DejaVuSans.ttf',fs.readFileSync(root+'/DejaVuSans.ttf'));
 await py.runPythonAsync(`import sys,pathlib,zipfile
sys.path.insert(0,'/engine')
for wheel in pathlib.Path('/engine').glob('*.whl'):
 with zipfile.ZipFile(wheel) as z:z.extractall('/engine')
import bridge
bridge.initialize()`);
 async function raw(role,method,url,body){py.globals.set('payload',JSON.stringify({role,method,path:url,body}));return JSON.parse(await py.runPythonAsync('await bridge.dispatch(payload)'));}
 async function call(role,method,url,body){const r=await raw(role,method,url,body);assert.equal(r.status,200,JSON.stringify(r));return r.body??r;}
 const get=(url)=>call('admin','GET',url);
 const boot=await get('/api/bootstrap');const pid=boot.products[0].id;
 const one=(await call('manager','POST','/api/loaders',{name:'Тест Иванов'})).id;
 const two=(await call('manager','POST','/api/loaders',{name:'Тест Петров'})).id;
 const three=(await call('manager','POST','/api/loaders',{name:'Тест Сидоров'})).id;
 await call('manager','PUT','/api/tariffs',{transport:'wagon',product_id:pid,rate:'100.01'});
 await call('manager','PUT','/api/tariffs',{transport:'truck',product_id:pid,rate:'100',rate_over20:'150'});
 await call('manager','PUT','/api/contractor-rates',{product_id:pid,rate:'50'});
 const body={transport:'wagon',reference:'12345678',buyer:'Тестовый покупатель',product_id:pid,tonnes:'68,5',load_date:'2026-11-11',_request_id:'test-idempotency-001'};
 const w=(await call('wagon','POST','/api/loads',body)).id;
 assert.equal((await call('wagon','POST','/api/loads',body)).id,w);
 assert.equal((await raw('wagon','POST',`/api/loads/${w}/status`,{status:'loaded'})).status,403);
 await call('manager','PUT',`/api/loads/${w}/crew`,{crew:[one,two,three]});
 await call('manager','POST',`/api/loads/${w}/status`,{status:'loaded'});
 let wagon=await get('/api/loads/'+w);
 assert.equal(wagon.total_cents,10001);assert.deepEqual(wagon.payouts.map(x=>x.amount_cents),[3334,3334,3333]);assert.equal(wagon.contractor.amount_cents,5000);
 await call('manager','PUT','/api/tariffs',{transport:'wagon',product_id:pid,rate:'999'});
 assert.equal((await get('/api/loads/'+w)).total_cents,10001);
 for(const [tonnes,total] of [['20',200000],['20.001',300015]]){
  const id=(await call('manager','POST','/api/loads',{transport:'truck',vehicle_kind:'kamaz',buyer:'Тест',product_id:pid,tonnes,load_date:'2026-11-11',crew:[one]})).id;
  await call('manager','POST',`/api/loads/${id}/status`,{status:'loaded'});assert.equal((await get('/api/loads/'+id)).total_cents,total);
 }
 const pending=await get('/api/statements/pending');assert.equal(pending.stats.total_cents,515016);
 const sid=(await call('manager','POST','/api/statements',{token:pending.token})).id;
 assert.equal((await call('manager','POST','/api/statements',{token:pending.token})).id,sid);
 assert.equal((await get('/api/statements/pending')).details.length,0);
 for(const fmt of ['docx','xlsx','pdf']){
  const r=await get('/api/report/export/'+fmt+'?start=2026-11-11&end=2026-11-11');const bytes=Buffer.from(r.binary,'base64');assert(bytes.length>100);assert(bytes.toString('ascii',0,4).startsWith(fmt==='pdf'?'%PDF':'PK'));console.log(fmt,bytes.length);
 }
 for(const body of [{person_id:one},{loader_summary:true},{stats_section:'days'},{statement_id:sid},{pending:true}]){
  const r=await call('manager','POST','/api/report/send/docx',{start:'2026-11-11',end:'2026-11-11',...body});assert(Buffer.from(r.binary,'base64').length>100);
 }
 await call('admin','POST',`/api/admin/statements/${sid}/cancel`,{});
 await call('admin','PUT',`/api/loads/${w}/crew`,{crew:[one,two]});
 const revision=await get(`/api/admin/statements/${sid}/revision`);
 await call('admin','POST',`/api/admin/statements/${sid}/resubmit`,{token:revision.token});
 const statement=await get('/api/statements/'+sid);assert.equal(statement.from,'2026-11-11');assert.equal(statement.to,'2026-11-11');
 const saved=py.runPython('bridge.export_database()');py.globals.set('saved',saved);py.runPython('bridge.restore_database(saved)\nbridge.initialize()');
 assert.equal((await get('/api/statements/'+sid)).stats.total_cents,statement.stats.total_cents);
 await call('admin','DELETE','/api/loads/'+w);assert.equal((await raw('admin','GET','/api/loads/'+w)).status,404);
 const trash=await get('/api/admin/trash');await call('admin','POST','/api/admin/trash/'+trash[0].id+'/restore',{});assert.equal((await get('/api/loads/'+w)).status,'loaded');
 assert.equal((await raw('manager','POST','/api/users/222/access',{role:'manager',state:'active'})).status,403);
 console.log('WASM domain: calculations, boundaries, roles, idempotency, documents, resubmission, persistence and trash passed');
})().catch(e=>{console.error(e);process.exitCode=1});
