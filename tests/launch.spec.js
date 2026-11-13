import {test,expect} from '@playwright/test';

test('brand launch dismisses and leaves entry usable; icons are available',async({page})=>{
  // Inspect the poster independently of browser codec support.
  await page.route('**/client/launch.js',route=>route.fulfill({contentType:'text/javascript',body:''}));
  await page.goto('/');
  await expect(page.locator('#pwa-launch video')).toHaveAttribute('poster','./client/launch-poster.jpg');
  await expect(page.locator('#pwa-launch')).toBeHidden({timeout:5500});
  await expect(page.locator('[data-role="manager"]')).toBeVisible();
  expect(await page.evaluate(()=>document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('#pwa-launch')!==null)).toBe(false);
  const icons=await page.evaluate(async()=>{
    const manifest=await(await fetch('./manifest.webmanifest')).json();
    return Promise.all([...manifest.icons.map(i=>i.src),document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href')].map(src=>new Promise(resolve=>{
      const image=new Image();image.onload=()=>resolve(image.naturalWidth);image.onerror=()=>resolve(0);image.src=src;
    })));
  });
  expect(icons).toEqual([192,512,512,180]);
});

test('reduced motion and failed launch module cannot trap the user',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  await expect(page.locator('#pwa-launch')).toHaveCount(0,{timeout:2000});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.route('**/client/launch.js',route=>route.abort());
  await page.reload();
  await expect(page.locator('#pwa-launch')).toBeHidden({timeout:5500});
  await expect(page.locator('[data-role="manager"]')).toBeVisible();
});

test('launch asset and playback failure fallback',async({page,request})=>{
  const response=await request.get('/client/launch.mp4');
  expect(response.ok()).toBe(true);
  expect((await response.body()).subarray(4,8).toString()).toBe('ftyp');
  await page.route('**/client/launch.mp4',route=>route.abort());
  await page.goto('/');
  await expect(page.locator('#pwa-launch')).toHaveCount(0,{timeout:3000});
  await expect(page.locator('[data-role="manager"]')).toBeVisible();
});
