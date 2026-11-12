const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path'),assert=require('assert');
const dom=new JSDOM('<main id="app"></main><div id="modal"></div>',{runScripts:'outside-only'}),w=dom.window,$=s=>w.document.querySelector(s);
const root=path.join(__dirname,'../static');
for(const name of ['lev','olesya'])w.eval(fs.readFileSync(path.join(root,'roles',name+'.js'),'utf8'));
const state={me:{role:'manager'},tab:'lev-home',start:'2026-11-11',boot:{products:[{id:1,name:'Мука'}],loaders:[{id:1,name:'Иван'}]}};
let wagonDate,body,rendered;
const ctx={state,$,vehicleName:x=>x.transport==='wagon'?'Вагон':'Фура',vehicleField:()=>'<select name="vehicle_kind"><option value="fura">Фура</option></select>',esc:x=>String(x??''),tone:String,money:String,localDate:()=>state.start,
 shell:html=>{$('#app').innerHTML=html},api:async url=>url==='/api/overdue-loads'?[]:url.startsWith('/api/loads?')?[]:url.startsWith('/api/day-crew')?{crew:[1]}:null,
 reloadBoot:async()=>{},formLoad:()=>{wagonDate=state.start},openModal:(title,html)=>{$('#modal').innerHTML='<div class="modal-head"><h2>'+title+'</h2><button class="x"></button></div>'+html},saveLoadRequest:async(f,b)=>{body=b;return true},dismiss(){},notify(){},refreshLoads:async()=>{rendered=true}};
const warehouse=w.WagonsRoles.olesya(ctx),lev=w.WagonsRoles.lev({...ctx,openTruckForm:async()=>{await warehouse.handleClick('olesya-new-truck');return true}});
(async()=>{
 await lev.renderOverview();assert.equal((lev.menu().match(/data-act="lv-new-load"/g)||[]).length,2);
 lev.handleChange({id:'lv-date',value:'2026-11-12'});
 await lev.handleClick('lv-new-load','wagon');assert.equal(wagonDate,'2026-11-12');
 await lev.handleClick('lv-new-load','truck');const form=$('#truck-form');assert(!form.elements.reference);assert.equal(form.elements.load_date.value,'2026-11-12');
 form.elements.buyer.value='Покупатель';form.elements.tonnes.value='21';
 await warehouse.handleClick('truck-crew-open');await warehouse.handleClick('truck-crew-repeat');await warehouse.handleClick('truck-crew-done');
 await warehouse.handleSubmit(form);assert.equal(body.reference,undefined);assert.equal(body.buyer,'Покупатель');assert.deepEqual(Array.from(body.crew),[1]);assert(rendered);
 console.log('PASS Lev creation date, machine form, repeat crew and save without number');
})().catch(e=>{console.error(e);process.exitCode=1});
