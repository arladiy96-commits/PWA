/* Run with Playwright installed: node tests/financial_trace_ui.cjs */
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
 const packaged=process.env.TRACE_CHROMIUM_MODULE?require(process.env.TRACE_CHROMIUM_MODULE).default:null;
 const browser=await chromium.launch({headless:true,...(packaged?{executablePath:await packaged.executablePath(),args:packaged.args}: {})});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 const root=path.join(__dirname,'../static');
 await page.setContent('<html class="lev-skin"><body><main id="app" data-role="lev"></main></body></html>');
 for(const f of ['style.css','roles/lev.css'])await page.addStyleTag({content:fs.readFileSync(path.join(root,f),'utf8')});
 await page.addScriptTag({content:fs.readFileSync(path.join(root,'roles/lev.js'),'utf8')});
 await page.evaluate(()=>{
   const x={id:7,load_id:7,reference:'А123ВС',transport:'truck',vehicle_kind:'fura',product_name:'Мука',load_date:'2026-10-05',tonnes:'40',status:'loaded',total_cents:3600000,rate_snapshot:'900',crew:[1],crew_count:3,crew_labels:{1:'Иванов'},payouts:[{loader_id:1,amount_cents:1200000}]};
   const d={from:'2026-10-05',to:'2026-10-05',token:'token',loads:[x],stats:{total_cents:300000},by_loader:[{loader_id:1,name:'Иванов',wagon_count:0,truck_count:1,amount_cents:300000}],details:[{...x,loader_id:1,loader_name:'Иванов',paid_cents:900000,amount_cents:300000}]};
   window.calls=[];window.state={tab:'report',me:{role:'manager'},reportStart:'2026-10-01',reportEnd:'2026-10-31'};
   const ctx={state,$:s=>document.querySelector(s),esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money:n=>(n/100).toLocaleString('ru-RU')+' ₸',tone:String,vehicleName:()=> 'Фура',shell:s=>document.querySelector('#app').innerHTML=s,notify:s=>{throw Error(s)},api:async u=>{
     calls.push(u);
     if(u==='/api/settlement-overview')return {pending:d,unfinished:[{...x,id:8,status:'progress'}]};
     if(u==='/api/load-trace/7')return {load:x,statements:[{id:4,amount_cents:2700000,created_at:'2026-10-05T10:00:00Z',cancelled:0}],events:[{action:'load_updated',actor_name:'Админ',created_at:'2026-10-05T12:00:00Z',before:{total_cents:2700000,rate_snapshot:'675',payouts:[{loader_id:1,amount_cents:900000}]},after:{...x,reason:'Уточнили тариф <script>'}}]};
     if(u.startsWith('/api/loader-ledger/1'))return {person:{name:'Иванов'},items:[{...x,earned_cents:1200000,paid_cents:900000,balance_cents:300000,statements:[{statement_id:4,amount_cents:900000}]}],earned_cents:1200000,paid_cents:900000,balance_cents:300000};
     if(u==='/api/statements/4')return {...d,id:4};
     throw Error('Unexpected API '+u);
   },post:async()=>{},render:async()=>{document.querySelector('#app').textContent='Админ обзор'}};
   window.role=window.WagonsRoles.lev(ctx);
   document.addEventListener('click',async e=>{const b=e.target.closest('[data-act]');if(b)await role.handleClick(b.dataset.act,b.dataset.id,b)});
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(()=>role.renderReport());
 await page.getByText('Состав к сдаче · 1 погрузок').click();
 await page.locator('[data-act="lv-trace-load"][data-id="7"]').first().click();
 await page.getByText('История погрузки',{exact:true}).click();
 await page.getByText('Причина: Уточнили тариф <script>',{exact:true}).waitFor();
 assert.equal(await page.locator('script').count(),1); // only our injected module script
 await page.screenshot({path:'/tmp/trace-load.png',fullPage:true});
 await page.locator('[data-act="lv-person"]').click();
 await page.getByText('Остаток к сдаче',{exact:true}).waitFor();
 assert((await page.evaluate(()=>calls.at(-1))).includes('start=2026-10-01&end=2026-10-31'));
 await page.locator('#lv-person-start').fill('2026-09-01');
 await page.locator('[data-act="lv-person-period"]').click();
 await page.waitForFunction(()=>calls.at(-1).includes('start=2026-09-01'));
 await page.screenshot({path:'/tmp/trace-loader.png',fullPage:true});
 await page.locator('[data-act="lv-trace-statement"]').click();
 await page.getByText('Сданный наряд',{exact:true}).waitFor();
 await page.locator('[data-act="lv-trace-back"]').click();
 await page.getByText('Остаток к сдаче',{exact:true}).waitFor();
 assert.equal(await page.locator('#lv-person-start').inputValue(),'2026-09-01');
 await page.evaluate(()=>role.refreshLive(null));
 assert.equal(await page.locator('#lv-person-start').inputValue(),'2026-09-01');
 await page.locator('[data-act="lv-trace-back"]').click();
 await page.getByText('История погрузки',{exact:true}).waitFor();
 await page.locator('[data-act="lv-trace-back"]').click();
 await page.getByText('К СДАЧЕ В КАССУ',{exact:true}).waitFor();
 await page.evaluate(async()=>{state.me.role='admin';state.tab='admin-home';await role.handleClick('lv-trace-load','7',{});await role.handleClick('lv-trace-back','',{});});
 assert.equal(await page.locator('#app').textContent(),'Админ обзор');
 assert.deepEqual(errors,[]);
 await browser.close();console.log('PASS trace navigation, date filters, archived statement, escaped reason, live refresh and admin return');
})().catch(e=>{console.error(e);process.exitCode=1});
