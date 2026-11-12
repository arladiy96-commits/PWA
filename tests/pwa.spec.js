import {test,expect} from '@playwright/test';
import http from 'node:http';
let originServer;
test.afterEach(async()=>{if(originServer?.listening)await stopOrigin();});
async function stopOrigin(){await new Promise(resolve=>{originServer.close(resolve);originServer.closeAllConnections();});}
async function temporaryOrigin(){
 originServer=http.createServer((req,res)=>{
  const upstream=http.request({hostname:'127.0.0.1',port:8765,path:req.url,method:req.method},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
  upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
 });
 await new Promise(resolve=>originServer.listen(0,'127.0.0.1',resolve));
 return `http://127.0.0.1:${originServer.address().port}`;
}
async function start(page,role='admin',origin='/'){
 await page.goto(origin);await page.locator(`[data-role="${role}"]`).click();await expect(page.locator('.nav')).toBeVisible();
}
async function api(page,path,method='GET',body){return page.evaluate(async({path,method,body})=>{
 const r=await window.PWA.fetch(path,{method,...(body?{body:JSON.stringify(body)}:{})});
 const data=r.headers.get('Content-Type')?.includes('json')?await r.json():{size:(await r.blob()).size};
 return {status:r.status,data};
},{path,method,body});}
test('cabinets, saved data, offline reload, documents, no external API',async({page,context,browserName})=>{
 const origin=await temporaryOrigin();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const external=[];page.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url());});
 await start(page,'admin',origin);
 const boot=await api(page,'/api/bootstrap');expect(boot.status).toBe(200);const pid=boot.data.products[0].id;
 const lid=(await api(page,'/api/loaders','POST',{name:'Проверка сохранения'})).data.id;
 await api(page,'/api/tariffs','PUT',{transport:'truck',product_id:pid,rate:'100',rate_over20:'150'});
 const {data:{id}}=await api(page,'/api/loads','POST',{transport:'truck',buyer:'Тестовая компания',product_id:pid,tonnes:'20',crew:[lid]});
 expect((await api(page,`/api/loads/${id}/status`,'POST',{status:'loaded'})).status).toBe(200);
 const pending=await api(page,'/api/statements/pending');expect(pending.data.stats.total_cents).toBe(200000);
 const sid=(await api(page,'/api/statements','POST',{token:pending.data.token})).data.id;
 expect((await api(page,`/api/statements/${sid}/export`)).data.size).toBeGreaterThan(100);
 await expect(page.locator('#pwa-cache-status')).toHaveText('Готово оффлайн');
 await page.reload();await expect(page.locator('.nav')).toBeVisible();
 expect((await api(page,`/api/loads/${id}`)).data.total_cents).toBe(200000);
 // WebKit's offline emulation kills SW responses before dispatch (#42775).
 // Stop the actual origin instead, and prove it is unreachable outside the SW.
 await stopOrigin();
 await expect(fetch(origin)).rejects.toThrow();
 if(browserName!=='webkit')await context.setOffline(true);
 await page.reload();await expect(page.locator('.nav')).toBeVisible();
 expect((await api(page,`/api/statements/${sid}`)).data.stats.total_cents).toBe(200000);
 for(const role of ['manager','wagon','storekeeper']){
  await page.locator('#pwa-bar button').click();await page.locator(`[data-role="${role}"]`).click();await expect(page.locator('.nav')).toBeVisible();
  expect((await api(page,'/api/loads')).status).toBe(200);
  if(role==='manager'){
   await page.locator('[data-act="nav"][data-id="loaders"]').click();
   await page.locator('[data-act="lv-add-loader"]').click();
   await page.locator('#lv-loader-editor input[name="name"]').fill('Добавлен через форму');
   await page.locator('#lv-loader-editor button[type="submit"]').click();
   await expect(page.locator('#overlay')).toHaveClass(/hidden/);
   expect((await api(page,'/api/loaders')).data.some(x=>x.name==='Добавлен через форму')).toBe(true);
  }
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);expect(overflow).toBe(false);
 }
 expect(external).toEqual([]);expect(errors).toEqual([]);
 await page.screenshot({path:`test-results/${test.info().project.name}-warehouse.png`});
});
test('server adapter never falls back and always uses server responses',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {createServerAdapter}=await import('/client/server-adapter.js');const original=window.fetch;const calls=[];
  window.fetch=async(url,opts)=>{calls.push({url:String(url),authorization:opts.headers.get('Authorization'),telegram:opts.headers.get('X-Telegram-Init-Data')});return new Response(JSON.stringify({total_cents:987654321}),{headers:{'Content-Type':'application/json'}});};
  const adapter=createServerAdapter({apiBase:'https://server.invalid'},'test-token');const value=await(await adapter.fetch('/api/report')).json();
  window.fetch=async()=>{throw new TypeError('offline');};let error;try{await adapter.fetch('/api/loads',{method:'POST',body:'{}'});}catch(e){error=e.message;}window.fetch=original;return {calls,value,error};
 });
 expect(result.calls).toEqual([{url:'https://server.invalid/api/report',authorization:'Bearer test-token',telegram:null}]);expect(result.value.total_cents).toBe(987654321);expect(result.error).toContain('Изменения не сохранены');
});

test('system Back unwinds tabs, forms and crew picker without losing parent input',async({page})=>{
 await start(page,'manager');
 const nav=id=>page.locator(`[data-act="nav"][data-id="${id}"]`);
 await nav('loaders').click();
 await page.locator('[data-act="lv-add-loader"]').click();
 await expect(page.locator('#lv-loader-editor')).toBeVisible();
 await page.goBack();
 await expect(page.locator('#overlay')).toHaveClass(/hidden/);
 await expect(nav('loaders')).toHaveClass(/active/);
 await page.goBack();await expect(nav('lev-home')).toHaveClass(/active/);
 await nav('tariffs').click();await nav('loaders').click();
 await page.goBack();await expect(nav('tariffs')).toHaveClass(/active/);
 await page.goBack();await expect(nav('lev-home')).toHaveClass(/active/);
 await page.locator('[data-act="lv-new-load"][data-id="truck"]').click();
 await page.locator('#truck-form input[name="buyer"]').fill('Черновик покупателя');
 await page.locator('[data-act="truck-crew-open"]').click();
 await expect(page.locator('#truck-picker')).toBeVisible();
 await page.goBack();await expect(page.locator('#truck-picker')).toHaveCount(0);
 await expect(page.locator('#truck-form input[name="buyer"]')).toHaveValue('Черновик покупателя');
 await page.goBack();await expect(page.locator('#overlay')).toHaveClass(/hidden/);
 await expect(nav('lev-home')).toHaveClass(/active/);
 // Closing with the X must consume the same history entry, without a dead Back.
 await page.locator('[data-act="lv-new-load"][data-id="truck"]').click();
 await page.locator('#modal [data-act="dismiss"]').click();
 await expect(page.locator('#overlay')).toHaveClass(/hidden/);
 await nav('tariffs').click();await page.goBack();
 await expect(nav('lev-home')).toHaveClass(/active/);
});
