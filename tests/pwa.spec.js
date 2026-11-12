import {test,expect} from '@playwright/test';
async function start(page,role='admin'){
 await page.goto('/');await page.locator(`[data-role="${role}"]`).click();await expect(page.locator('.nav')).toBeVisible();
}
async function api(page,path,method='GET',body){return page.evaluate(async({path,method,body})=>{
 const r=await window.PWA.fetch(path,{method,...(body?{body:JSON.stringify(body)}:{})});
 const data=r.headers.get('Content-Type')?.includes('json')?await r.json():{size:(await r.blob()).size};
 return {status:r.status,data};
},{path,method,body});}
test('cabinets, saved data, offline reload, documents, no external API',async({page,context})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const external=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:8765')&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url());});
 await start(page);
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
 await context.setOffline(true);await page.reload();await expect(page.locator('.nav')).toBeVisible();
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
