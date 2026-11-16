const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path'),assert=require('assert');
const w=new JSDOM('<main></main><div id="modal"></div>',{runScripts:'outside-only'}).window,$=s=>w.document.querySelector(s);
for(const n of ['lev','admin'])w.eval(fs.readFileSync(path.join(__dirname,'../static/roles/'+n+'.js'),'utf8'));
w.confirm=()=>true;
const state={me:{role:'admin'},tab:'report',boot:{tariffs:[],contractor_rates:[{product_id:1,rate:'600'}]}};
const requests=[];let row={id:7,from:'2026-11-02',to:'2026-11-02',cancelled:0,stats:{total_cents:100000}},slow=null;
function draft(include){return {id:7,from:row.from,to:row.to,token:include?'with':'without',include_contractor:include,previous_total_cents:100000,stats:{total_cents:include?160000:100000},loads:[],revision_loads:[{id:12,reference:'12345678',load_date:row.from,product_name:'Мука',tonnes:'50',transport:'wagon'}],by_loader:[],details:include?[{is_contractor:true,reference:'123',product_name:'Мука',rate_snapshot:'600',amount_cents:60000}]:[]};}
const ctx={state,$,openModal:(title,html)=>$('#modal').innerHTML=html,dismiss:()=>$('#modal').innerHTML='',esc:s=>String(s??''),money:String,tone:String,vehicleName:()=> 'Вагон',shell:s=>$('main').innerHTML=s,notify(){},reloadBoot:async()=>{},localDate:()=> '2026-11-11',api:async u=>{
 requests.push(u);
 if(u==='/api/settlement-overview')return {pending:{...draft(true),cancelled:!!row.cancelled},unfinished:[]};
 if(u==='/api/loaders')return [{id:1,name:'Иван',active:1},{id:2,name:'Пётр',active:1}];
 if(u==='/api/loads/12')return {id:12,transport:'wagon',reference:'12345678',buyer:'Покупатель',product_id:1,product_name:'Мука',load_date:row.from,status:'loaded',tonnes:'50',rate_snapshot:'1000',crew:[1]};
 if(u==='/api/products')return [{id:1,name:'Мука',active:1},{id:2,name:'Отруби',active:1}];
 if(u==='/api/statements')return [row];
 if(u==='/api/statements/7')return {...draft(true),cancelled:false};
 if(u.startsWith('/api/admin/statements/7/revision')){if(slow)await slow;return draft(u.endsWith('true'));}
 throw Error(u);
},post:async(u,b,m)=>{requests.push({u,b,m});if(u.endsWith('/cancel'))row.cancelled=1;if(u==='/api/statements')row.cancelled=0;return {id:7}}};
const lev=w.WagonsRoles.lev(ctx),admin=w.WagonsRoles.admin({...ctx,openRevision:id=>lev.openRevision(id)});
(async()=>{
 for(const role of ['admin','manager']){state.me.role=role;await lev.renderTariffs();assert($('main').textContent.includes('Наемник на тупике'));assert.equal($('#contractor-rate-1').value,'600');$('#contractor-rate-2').value='400';await lev.handleClick('save-contractor-rate','2');assert(requests.some(r=>r.u==='/api/contractor-rates'&&r.b.rate==='400'));}
 state.me.role='admin';state.tab='report';await lev.handleClick('lv-mode','archive');await lev.handleClick('lv-statement','7',{dataset:{cancelled:'0'}});assert($('[data-act="ad-cancel-statement"]'));
 await admin.handleClick('ad-cancel-statement','7');assert(!$('#lv-include-contractor'));assert($('main').textContent.includes('2026-11-02'));
 assert($('[data-act="ad-revision-edit"]'));assert.equal($('[data-act="ad-revision-edit"]').dataset.statement,'7');
 await admin.handleClick('ad-revision-edit','12',$('[data-act="ad-revision-edit"]'));
 $('#ad-load-form [name="crew"][value="2"]').checked=true;
 await admin.handleClick('ad-save');
 assert(requests.some(r=>r.u==='/api/loads/12'&&r.m==='PATCH'&&r.b.crew.length===2));
 assert($('[data-act="lv-submit"]'));
 await lev.handleClick('lv-submit','7',$('[data-act="lv-submit"]'));
 assert(requests.some(r=>r.u==='/api/statements'&&r.b.token==='with'));
 assert($('[data-act="ad-cancel-statement"]'));assert($('main').textContent.includes('Ведомость № 7'));
 row.cancelled=1;await lev.handleClick('lv-mode','archive');assert($('main').textContent.includes('На исправлении'));
 const b=$('[data-act="lv-statement"]');await lev.handleClick('lv-statement','7',b);assert(!$('#lv-include-contractor'));assert($('[data-act="ad-revision-edit"]'));
 state.me.role='manager';await lev.handleClick('lv-open');assert($('main').textContent.includes('Новые завершённые погрузки'));assert($('[data-act="lv-submit"]'));assert(!$('[data-act="ad-revision-edit"]'));
 console.log('PASS tariffs for both roles, cancellation opens original draft, editable original loads, no manual contractor checkbox, same-id resubmit and draft recovery');
})().catch(e=>{console.error(e);process.exitCode=1});
