const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('assert');
const dom=new JSDOM('<main id="app"></main>',{runScripts:'outside-only'}),w=dom.window;
w.eval(fs.readFileSync(__dirname+'/../static/roles/lev.js','utf8').replace('return {header,menu,','return {personLedger,header,menu,'));
let sent,release;
const $=s=>w.document.querySelector(s);
const role=w.WagonsRoles.lev({state:{me:{role:'manager'}},$,esc:String,money:String,tone:String,vehicleName:()=>'',notify(){},post:async(url,body)=>{sent={url,body};await new Promise(r=>release=r)}});
(async()=>{
for(const id of [2,0]){
 $('#app').innerHTML=role.personLedger({person:{name:'Тест'},items:[],earned_cents:0,paid_cents:0,balance_cents:0},{id,transport:'wagon'},'2026-11-01','2026-11-11','');
 const btn=$('[data-act="lv-person-send"]');
 assert.equal($('[data-act="lv-person-period"]').nextElementSibling,btn);
 $('#lv-person-start').value='2020-01-01';
 const pending=role.handleClick('lv-person-send',String(id),btn);
 assert(btn.disabled);
 assert.deepEqual(sent,{url:'/api/report/send/docx',body:{person_id:id,start:'2026-11-01',end:'2026-11-11',transport:'wagon'}});
 release();await pending;assert(!btn.disabled);
}
console.log('PASS personal report button placement, rendered dates/filter, recipient id including contractor, double-click lock');dom.window.close();
})().catch(e=>{console.error(e);process.exitCode=1});
