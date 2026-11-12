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
 const blank={loaded:0,planned:0,progress:0,tonnes:'0',amount_cents:0,cost_per_tonne_cents:0};let exported='',sent;
 w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};
 w.fetch=async(url,opt={})=>{if(url.includes('/export/'))exported=url;if(opt.method==='POST')sent=JSON.parse(opt.body);return {ok:true,blob:async()=>new w.Blob(['test']),json:async()=>({totals:blank,transport:{wagon:blank,truck:blank},products:[],days:[],people:[],paid_cents:0,balance_cents:0})};};
 t.state.tab='lev-stats';await t.lev.renderStats();assert.equal(w.document.querySelectorAll('[data-act="lv-stats-export"]').length,4);
 for(const transport of ['all','wagon','truck']){
  t.lev.handleChange({id:'lv-stats-transport',value:transport});await t.lev.renderStats();
  const old=$('#lv-stats-start').value;t.lev.handleChange({id:'lv-stats-start',value:'2020-01-01'});
  await t.lev.handleClick('lv-stats-export','days',$('[data-id="days"]'));assert.equal(sent.stats_section,'days');assert.equal(sent.transport,transport);assert.equal(sent.start,old);assert.equal(exported,'');
  await t.lev.handleClick('lv-stats-send','',$('[data-act="lv-stats-send"]'));assert.equal(sent.transport,transport);assert.equal(sent.start,old);
 }
 console.log('PASS four icons; download and summary use rendered period/transport for all filters');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
