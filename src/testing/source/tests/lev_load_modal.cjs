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
 for(const transport of ['wagon','truck'])for(const status of ['planned','progress','loaded'])for(const act of ['lv-load','lv-trace-load','detail']){
  const x={id:42,transport,status,reference:transport==='wagon'?'12345678':'',product_name:'Мука',tonnes:'68.5',load_date:'2026-11-11',buyer:'Покупатель',crew:[1],crew_names:['Иванов'],total_cents:4000000,rate_snapshot:40000};
  let urls=[];w.fetch=async url=>{urls.push(url);return {ok:true,json:async()=>x}};
  t.state.tab=act==='lv-trace-load'?'lev-detail':'lev-home';const tab=t.state.tab;
  await t.lev.handleClick(act,'42');
  assert.deepEqual(urls,['/api/loads/42']);assert.equal(t.state.tab,tab);assert(!$('#overlay').classList.contains('hidden'));assert($('#modal').textContent.includes('Иванов'));
  for(const action of ['edit','crew','close'])assert.equal(!!$('#modal [data-act="'+action+'"]'),status!=='loaded');
  assert(!$('#modal').textContent.includes('Управление погрузкой'));
 }
 console.log('PASS all 3 entry actions, wagon/truck, 3 statuses: modal opens without page navigation; loaded is read-only');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
