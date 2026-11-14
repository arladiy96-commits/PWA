import {createNavigation} from './navigation.js';
import config from './config.js';
import {showDocument} from './document-panel.js';
import {createServerAdapter} from './server-adapter.js';
const app=document.getElementById('app');
const roleNames={admin:'Администратор',manager:'Лев',wagon:'Максим',storekeeper:'Заведующий складом',pending:'Тестовая заявка'};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const loadScript=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL('../'+src,import.meta.url);s.onload=resolve;s.onerror=()=>reject(Error('Не удалось загрузить интерфейс'));document.head.append(s);});
let adapter;
const navigation = createNavigation({
  showExit() {
    const hint = document.createElement('div');
    hint.id = 'pwa-exit-hint';
    hint.className = 'toast';
    hint.setAttribute('role', 'status');
    hint.textContent = 'Свайпни ещё раз, чтобы выйти';
    document.body.append(hint);
  },
  hideExit() {
    document.getElementById('pwa-exit-hint')?.remove();
  }
});
window.PWA={navigation,mode:config.mode,fetch:(...args)=>adapter.fetch(...args),download:showDocument};
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
    const status = () => {
      const waiting = reg.waiting;
      label.textContent = waiting ? 'Есть обновление' : reg.active
        ? (config.mode === 'test' ? 'Готово оффлайн' : navigator.onLine ? 'Сервер' : 'Нет сети')
        : 'Загружаем оффлайн…';
      label.onclick = waiting ? () => {
        if (!confirm('Обновить приложение? Несохранённый ввод будет потерян.')) return;
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {once: true});
        waiting.postMessage('ACTIVATE');
      } : null;
    };
    const watch = () => reg.installing?.addEventListener('statechange', status);
    status();
    watch();
    reg.addEventListener('updatefound', watch);
    navigator.serviceWorker.addEventListener('controllerchange', status);
  }catch{label.textContent='Оффлайн не готов';}
}
window.addEventListener('pwa-session-expired',()=>{sessionStorage.removeItem('gruzcontrol-server-session');location.reload();});
if(config.mode==='test'){
  const selected=sessionStorage.getItem('gruzcontrol-test-role');
  if(roleNames[selected])openApp(selected);
  else{
    app.innerHTML=`<section class="pwa-entry"><span class="eyebrow">ТЕСТОВАЯ ВЕРСИЯ</span><h1>ГрузКонтроль</h1><p>Выбери кабинет</p><div class="pwa-roles">${Object.entries(roleNames).map(([id,name])=>`<button class="btn" data-role="${id}">${name}<span>→</span></button>`).join('')}</div><p class="sub">Данные только на этом устройстве. Рабочий сервер не подключён.</p><p class="sub" id="pwa-build">Сборка: …</p><details><summary>Как установить на телефон</summary><p>iPhone: Safari → «Поделиться» → «На экран Домой». Android: меню браузера → «Установить приложение» или «Добавить на главный экран».</p><p>Для работы без сети дождись надписи «Готово оффлайн».</p></details></section>`;
    fetch(new URL('../build.json', import.meta.url))
      .then(response => response.json())
      .then(({version}) => {
        const label = document.getElementById('pwa-build');
        if (label) label.textContent = 'Сборка: ' + version;
      })
      .catch(() => document.getElementById('pwa-build')?.remove());
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
