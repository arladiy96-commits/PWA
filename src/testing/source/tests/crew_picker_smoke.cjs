/* Run with jsdom available: node tests/crew_picker_smoke.cjs */
const {JSDOM}=require('jsdom');
const fs=require('fs'),path=require('path'),assert=require('assert');
const dom=new JSDOM('<div id="modal"></div>',{runScripts:'outside-only'});
const w=dom.window,$=s=>w.document.querySelector(s);
const root=path.join(__dirname,'..','static');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
w.eval(app.slice(app.indexOf('  function vehicleName'),app.indexOf('  function roleName')));
w.eval(fs.readFileSync(path.join(root,'roles/olesya.js'),'utf8'));
const state={me:{role:'storekeeper'},start:'2026-11-03',loads:[{id:9,transport:'truck',vehicle_kind:'kamaz',crew_count:2,load_date:'2026-11-03'}],boot:{products:[{id:1,name:'Мука'}],loaders:Array.from({length:100},(_,i)=>({id:i+1,name:'Грузчик '+(i+1)}))}};
let resolveCopy,saved,lastUrl;
const ctx={state,$,vehicleName:w.vehicleName,vehicleField:w.vehicleField,esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),shell(){},localDate:()=>state.start,
openModal:(title,html)=>{$('#modal').innerHTML=`<div class="modal-head"><h2>${title}</h2><button class="x" aria-label="Закрыть">×</button></div>${html}`},
reloadBoot:async()=>{},api:url=>{lastUrl=url;assert(url.startsWith('/api/day-crew?date='));return new Promise(resolve=>resolveCopy=resolve)},saveLoadRequest:async(f,b)=>{saved=b;return true},dismiss(){},notify(){},refreshLoads:async()=>{}};
const role=w.WagonsRoles.olesya(ctx);
(async()=>{
 await role.handleClick('olesya-new-truck');
 const form=$('#truck-form');assert(!form.elements.reference);form.elements.tonnes.value='21,5';form.elements.buyer.value='Заказчик';form.elements.vehicle_kind.value='kamaz';form.dataset.operationId='preserve-me';
 assert(!$('#truck-crew-list'));
 await role.handleClick('truck-crew-open');assert(form.hidden);assert(!$('#truck-crew-source'));assert.equal($('#truck-crew-list').children.length,100);
 function check(id,on){const input=$(`[data-truck-loader="${id}"]`);input.checked=on;role.handleInput(input);}
 check(1,true);$('#truck-crew-search').value='Грузчик 99';role.handleInput($('#truck-crew-search'));check(99,true);
 assert($('#truck-crew-done').textContent.includes('2'));
 await role.handleClick('truck-crew-done');assert.strictEqual($('#truck-form'),form);assert(!form.hidden);
 assert.deepEqual(Array.from(state.modalCrew),[1,99]);assert.equal(form.elements.tonnes.value,'21,5');assert(!form.elements.reference);assert.equal(form.elements.vehicle_kind.value,'kamaz');assert.equal(form.dataset.operationId,'preserve-me');
 assert($('#truck-crew-summary').textContent.includes('Грузчик 99'));
 await role.handleClick('truck-crew-open');check(1,false);assert(role.closeTruckPicker(false));assert.deepEqual(Array.from(state.modalCrew),[1,99]);
 await role.handleClick('truck-crew-open');let copy=role.handleClick('truck-crew-repeat',9);role.closeTruckPicker(false);resolveCopy({crew:[2,3]});await copy;assert.deepEqual(Array.from(state.modalCrew),[1,99]);
 await role.handleClick('truck-crew-open');copy=role.handleClick('truck-crew-repeat',9);resolveCopy({crew:[2,3,999]});await copy;await role.handleClick('truck-crew-done');assert.deepEqual(Array.from(state.modalCrew),[2,3]);
 form.elements.load_date.value='2026-11-04';
 await role.handleClick('truck-crew-open');copy=role.handleClick('truck-crew-repeat');assert.equal(lastUrl,'/api/day-crew?date=2026-11-04');resolveCopy({crew:[],exists:false});await copy;
 await role.handleClick('truck-crew-done');assert.deepEqual(Array.from(state.modalCrew),[2,3]);
 await role.handleSubmit(form);assert.equal(saved.buyer,'Заказчик');assert.equal(saved.vehicle_kind,'kamaz');assert.deepEqual(Array.from(saved.crew),[2,3]);
 console.log('PASS 100 loaders: search, confirm, cancel, copy, stale response, form identity/values and save');
})().catch(e=>{console.error(e);process.exitCode=1});
