const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'../static');
const dom=new JSDOM('<html><body><div id="app" class="app-frame"></div><div id="overlay" class="hidden"><div id="modal"></div></div><div id="toast"></div></body></html>',{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,$=s=>w.document.querySelector(s);let requests=[];
const tg={isFullscreen:true,viewportStableHeight:844,safeAreaInset:{top:24,bottom:24},contentSafeAreaInset:{top:48,bottom:0},onEvent(){},initData:'test'};w.Telegram={WebApp:tg};w.innerHeight=844;
w.fetch=async url=>{requests.push(url);const d=url.startsWith('/api/loads?')?[{id:1,transport:'wagon',reference:'12345678',product_name:'Мука',tonnes:'68.5',status:'planned',crew_count:0},{id:2,transport:'truck',vehicle_kind:'kamaz',reference:'',product_name:'Отруби',tonnes:'18',status:'progress',crew_count:3,buyer:'Астык'}]:[];return {ok:true,json:async()=>d}};
for(const n of ['maxim','olesya','lev','admin'])w.eval(fs.readFileSync(path.join(root,'roles/'+n+'.js'),'utf8'));
let code=fs.readFileSync(path.join(root,'app.js'),'utf8');
code=code.replace('  enter();\n})();','  window.testUI={state,lev,shell,formLoad,syncTelegramViewport,syncModalViewport,openModal};\n})();');w.eval(code);
const t=w.testUI;t.state.me={role:'manager',name:'Лев'};t.state.tab='lev-home';t.state.boot={products:[{id:1,name:'Мука'}],loaders:[],tariffs:[]};
(async()=>{
 t.syncTelegramViewport();assert.equal(w.document.documentElement.style.getPropertyValue('--lev-safe-top'),'72px');assert.equal(w.document.documentElement.style.getPropertyValue('--wagon-safe-bottom'),'24px');
 await t.lev.renderOverview();assert(w.document.documentElement.classList.contains('lev-frost'));
 assert.equal($('.lf-header .lf-brand').textContent,'ГрузКонтроль');assert.equal($('.lf-header .lf-identity').textContent,'Лев');
 assert.equal(w.document.querySelectorAll('#lv-date').length,1);assert.equal(w.document.querySelectorAll('.lv-load-group').length,2);assert.equal(w.document.querySelectorAll('.lf-footer [data-act="lv-new-load"]').length,2);
 assert.equal(w.document.querySelectorAll('.lf-footer .nav-btn').length,5);assert(!$('#app').textContent.includes('Журнал работ'));assert(!$('#app').textContent.includes('Сейчас в работе'));assert(!$('#app').textContent.includes('Без номера'));
 const date=$('#lv-date').value;await t.lev.handleClick('lv-step-day','1');assert.notEqual($('#lv-date').value,date);await t.lev.handleClick('lv-step-day','-1');assert.equal($('#lv-date').value,date);
 t.state.transport='wagon';t.state.start=date;t.formLoad();
 assert($('#load-form>.modal-form-fields'));assert($('#load-form>.modal-form-actions'));assert($('#load-form [name="reference"]').required);
 $('#load-form [name="reference"]').value='87654321';$('#load-form [name="buyer"]').value='Покупатель';$('#load-form [name="tonnes"]').value='68,5';
 const payload=Object.fromEntries(new w.FormData($('#load-form')));assert.equal(payload.reference,'87654321');assert.equal(payload.buyer,'Покупатель');assert.equal(payload.tonnes,'68,5');
 const input=$('#load-form [name="buyer"]');input.focus();w.innerHeight=430;t.syncModalViewport();assert($('#overlay').classList.contains('keyboard-visible'));assert.equal($('#overlay').style.getPropertyValue('--sheet-top'),'80px');assert.equal($('#overlay').style.getPropertyValue('--sheet-height'),'350px');
 tg.isFullscreen=false;tg.safeAreaInset.top=0;tg.contentSafeAreaInset.top=0;t.syncTelegramViewport();t.syncModalViewport();assert.equal($('#overlay').style.getPropertyValue('--sheet-top'),'8px');
 // Class and redesigned header are removed outside the manager role.
 t.state.me.role='admin';t.state.tab='report';t.shell('admin');assert(!w.document.documentElement.classList.contains('lev-frost'));assert(!$('.lf-header'));assert(!$('.lf-footer'));
 console.log('PASS Lev-only skin, compact header, one date, date arrows, grouped loads, fixed actions, unchanged form fields, fullscreen/keyboard geometry, admin isolation');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
