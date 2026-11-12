import {createNavigation} from './navigation.js';
import config from './config.js';
import {createServerAdapter} from './server-adapter.js';
const app=document.getElementById('app');
const roleNames={admin:'Администратор',manager:'Лев',wagon:'Максим',storekeeper:'Заведующий складом',pending:'Тестовая заявка'};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const loadScript=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL('../'+src,import.meta.url);s.onload=resolve;s.onerror=()=>reject(Error('Не удалось загрузить интерфейс'));document.head.append(s);});
let adapter;
let downloadUrl;
async function download(response){
  const disposition=response.headers.get('Content-Disposition')||'';
  const encoded=disposition.match(/filename\*=UTF-8''(.+)/i);
  let name=encoded?decodeURIComponent(encoded[1]):'ГрузКонтроль.docx';
  const blob=await response.blob();
  if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=URL.createObjectURL(blob);
  let panel=document.getElementById('pwa-document');if(!panel){panel=document.createElement('aside');panel.id='pwa-document';document.body.append(panel);}
  panel.innerHTML=`<b>Документ готов</b><a download="${escape(name)}" href="${downloadUrl}">Сохранить / открыть</a><button type="button" aria-label="Закрыть">×</button>`;
  panel.querySelector('button').onclick=()=>panel.remove();
  // Explicit second tap works on iOS even after a long asynchronous document build.
}
window.PWA={navigation:createNavigation(),mode:config.mode,fetch:(...args)=>adapter.fetch(...args),download};
async function openApp(role){
  app.innerHTML='<div class="loading"><div class="spinner"></div><h2>ГрузКонтроль</h2><p>Готовим тестовую базу…</p><p class="sub">Первая загрузка может занять немного времени.</p></div>';
  try{
    if(config.mode==='test'){
      const {createTestAdapter}=await import('./test-adapter.js');adapter=await createTestAdapter(role);
    }
    const bar=document.createElement('div');bar.id='pwa-bar';
    bar.innerHTML=`<span>${config.mode==='test'?'ТЕСТ · '+escape(roleNames[role]):'ГрузКонтроль'}</span><span id="pwa-cache-status">Подготовка…</span><button type="button">${config.mode==='test'?'Кабинет':'Выйти'}</button>`;
    bar.querySelector('button').onclick=async()=>{
      if(config.mode==='server'){
        try{await adapter.fetch(config.logoutPath,{method:'POST'});}catch{}
        sessionStorage.removeItem('gruzcontrol-server-session');
      }else sessionStorage.removeItem('gruzcontrol-test-role');
      location.reload();
    };
    document.body.prepend(bar);document.documentElement.classList.add('pwa');
    for(const file of ['static/roles/maxim.js','static/roles/olesya.js','static/roles/lev.js','static/roles/admin.js','static/app.js'])await loadScript(file);
    await setupOffline();
  }catch(error){app.innerHTML=`<div class="loading"><h2>Не удалось открыть</h2><p>${escape(error.message)}</p><button class="btn primary" onclick="location.reload()">Повторить</button></div>`;}
}
async function setupOffline(){
  const label=document.getElementById('pwa-cache-status');
  if(!('serviceWorker' in navigator)){label.textContent='Оффлайн недоступен';return;}
  try{
    const reg=await navigator.serviceWorker.register(new URL('../sw.js',import.meta.url),{scope:new URL('../',import.meta.url).pathname});
    const status=()=>{label.textContent=reg.active?(config.mode==='test'?'Готово оффлайн':navigator.onLine?'Сервер':'Нет сети'):'Загружаем оффлайн…';};
    status();navigator.serviceWorker.addEventListener('controllerchange',status);
    const watch=worker=>worker?.addEventListener('statechange',()=>{status();if(worker.state==='installed'&&reg.active){label.textContent='Есть обновление';label.onclick=()=>{if(confirm('Обновить приложение? Несохранённый ввод будет потерян.')){worker.postMessage('ACTIVATE');navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});}};}});
    watch(reg.installing);reg.addEventListener('updatefound',()=>watch(reg.installing));
  }catch{label.textContent='Оффлайн не готов';}
}
window.addEventListener('pwa-session-expired',()=>{sessionStorage.removeItem('gruzcontrol-server-session');location.reload();});
if(config.mode==='test'){
  const selected=sessionStorage.getItem('gruzcontrol-test-role');
  if(roleNames[selected])openApp(selected);
  else{
    app.innerHTML=`<section class="pwa-entry"><span class="eyebrow">ТЕСТОВАЯ ВЕРСИЯ</span><h1>ГрузКонтроль</h1><p>Выбери кабинет</p><div class="pwa-roles">${Object.entries(roleNames).map(([id,name])=>`<button class="btn" data-role="${id}">${name}<span>→</span></button>`).join('')}</div><p class="sub">Данные только на этом устройстве. Рабочий сервер не подключён.</p><details><summary>Как установить на телефон</summary><p>iPhone: Safari → «Поделиться» → «На экран Домой». Android: меню браузера → «Установить приложение» или «Добавить на главный экран».</p><p>Для работы без сети дождись надписи «Готово оффлайн».</p></details></section>`;
    app.querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>{sessionStorage.setItem('gruzcontrol-test-role',b.dataset.role);openApp(b.dataset.role);});
  }
}else{
  const token=sessionStorage.getItem('gruzcontrol-server-session');
  if(token){adapter=createServerAdapter(config,token);openApp();}
  else{
    app.innerHTML='<form class="pwa-entry" id="login"><h1>ГрузКонтроль</h1><label class="field">Логин<input name="login" autocomplete="username" required></label><label class="field">Пароль<input name="password" type="password" autocomplete="current-password" required></label><p id="login-error" role="alert"></p><button class="btn primary">Войти</button></form>';
    app.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.target;f.querySelector('button').disabled=true;
      try{const client=createServerAdapter(config);const r=await client.fetch(config.loginPath,{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(f)))});const data=await r.json();if(!r.ok||!data.access_token)throw Error(data.detail||'Сервер не подтвердил вход');sessionStorage.setItem('gruzcontrol-server-session',data.access_token);location.reload();}
      catch(err){document.getElementById('login-error').textContent=err.message;f.querySelector('button').disabled=false;}};
  }
}
