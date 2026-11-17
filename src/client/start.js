import {createNavigation} from './navigation.js';
import config from './config.js';
import {createAppDialogs} from './dialog.js';
import {showDocument} from './document-panel.js';
import {createServerAdapter} from './server-adapter.js';
import {showLogin} from './login.js';
const app=document.getElementById('app');
const demoAccounts = [
  {login:'admin', role:'admin', label:'Главный админ'},
  {login:'lev', role:'manager', label:'Лев'},
  {login:'maxim', role:'wagon', label:'Максим'},
  {login:'olesya', role:'storekeeper', label:'Олеся'}
];
const demoPassword = 'demo';
const demoSessionKey = 'gruzcontrol-demo-session';
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
let offlineStatus = 'Подготовка…';
let updateApp;

function updateMarkup() {
  return `<p class="sub" id="pwa-cache-status" role="status">${offlineStatus}</p>
    <button type="button" class="btn full" data-act="pwa-update"${updateApp ? '' : ' hidden'}>Обновить приложение</button>`;
}

function settingsMarkup() {
  return `${updateMarkup()}
    <button type="button" class="btn full" data-act="pwa-switch">Выйти</button>`;
}

async function leaveCabinet() {
  if (config.mode === 'server') {
    try { await adapter.fetch(config.logoutPath, {method:'POST'}); } catch {}
    sessionStorage.removeItem('gruzcontrol-server-session');
  } else {
    localStorage.removeItem(demoSessionKey);
  }
  location.reload();
}

const appDialogs = createAppDialogs(navigation);
window.PWA={...appDialogs,navigation,mode:config.mode,fetch:(...args)=>adapter.fetch(...args),download:showDocument,settingsMarkup,leaveCabinet,applyUpdate:()=>updateApp?.()};
async function openApp(role){
  document.documentElement.classList.remove('pwa-login-page');
  app.innerHTML = config.mode === 'test'
    ? '<div class="loading"><div class="spinner"></div><h2>ГрузКонтроль</h2><p>Готовим тестовую базу…</p><p class="sub">Первая загрузка может занять немного времени.</p></div>'
    : '<div class="loading"><div class="spinner"></div><h2>ГрузКонтроль</h2><p>Открываем кабинет…</p></div>';
  try{
    if(config.mode==='test'){
      const {createTestAdapter}=await import('./test-adapter.js');adapter=await createTestAdapter(role);
    }
    document.documentElement.classList.add('pwa');
    for(const file of ['static/roles/maxim.js','static/roles/olesya.js','static/roles/lev.js','static/roles/admin.js','static/app.js'])await loadScript(file);
    await setupOffline();
  }catch(error){app.innerHTML=`<div class="loading"><h2>Не удалось открыть</h2><p>${escape(error.message)}</p><button class="btn primary" onclick="location.reload()">Повторить</button></div>`;}
}
let offlineSetup;
function setupOffline() {
  return offlineSetup ??= registerOffline();
}

async function registerOffline(){
  function displayStatus(text, update) {
    offlineStatus = text;
    updateApp = update;
    const label = document.getElementById('pwa-cache-status');
    if (label) label.textContent = text;
    const button = document.querySelector('[data-act="pwa-update"]');
    if (button) button.hidden = !update;
  }
  if (!('serviceWorker' in navigator)) {
    displayStatus('Оффлайн недоступен');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register(new URL('../sw.js',import.meta.url),{scope:new URL('../',import.meta.url).pathname});
    const status = () => {
      const waiting = reg.waiting;
      const text = waiting ? 'Есть обновление' : reg.active
        ? (config.mode === 'test' ? 'Готово оффлайн' : navigator.onLine ? 'Сервер' : 'Нет сети')
        : 'Загружаем оффлайн…';
      displayStatus(text, waiting ? async () => {
        if (!await appDialogs.confirmAction({title:'Обновить приложение?',message:'Несохранённый ввод будет потерян.',confirmLabel:'Обновить'})) return;
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {once: true});
        waiting.postMessage('ACTIVATE');
      } : undefined);
    };
    const watch = () => reg.installing?.addEventListener('statechange', status);
    status();
    watch();
    reg.addEventListener('updatefound', watch);
    navigator.serviceWorker.addEventListener('controllerchange', status);
  } catch { displayStatus('Оффлайн не готов'); }
}
window.addEventListener('pwa-session-expired', () => {
  if (!sessionStorage.getItem('gruzcontrol-server-session')) return;
  sessionStorage.removeItem('gruzcontrol-server-session');
  sessionStorage.setItem('gruzcontrol-session-expired', '1');
  location.reload();
});
if (config.mode === 'test') {
  let savedRole;
  try { savedRole = localStorage.getItem(demoSessionKey); } catch {}
  if (demoAccounts.some(account => account.role === savedRole)) {
    void openApp(savedRole);
  } else {
    showLogin(app, {
      demo: {accounts: demoAccounts, password: demoPassword},
      signIn({login, password}) {
        const account = demoAccounts.find(item => item.login === login.toLowerCase());
        if (!account || password !== demoPassword) return 401;
        localStorage.setItem(demoSessionKey, account.role);
        return openApp(account.role);
      }
    });
    app.querySelector('.pwa-login').insertAdjacentHTML('beforeend', `
      <div class="pwa-login-meta">
        ${updateMarkup()}
        <p class="sub" id="pwa-build" hidden></p>
      </div>`);
    app.querySelector('[data-act="pwa-update"]').addEventListener('click', () => updateApp?.());
    fetch(new URL('../build.json', import.meta.url))
      .then(response => response.json())
      .then(({version}) => {
        const label = document.getElementById('pwa-build');
        if (label && version) {
          label.textContent = 'Сборка: ' + version;
          label.hidden = false;
        }
      })
      .catch(() => {});
    void setupOffline();
  }
}else{
  const token=sessionStorage.getItem('gruzcontrol-server-session');
  if(token){adapter=createServerAdapter(config,token);openApp();}
  else{
    const expired = sessionStorage.getItem('gruzcontrol-session-expired') === '1';
    sessionStorage.removeItem('gruzcontrol-session-expired');
    showLogin(app, {
      expired,
      async signIn(credentials) {
        const response = await createServerAdapter(config).fetch(config.loginPath, {
          method: 'POST',
          body: JSON.stringify(credentials),
          signal: AbortSignal.timeout?.(15000)
        });
        if (!response.ok) return response.status;
        const data = await response.json().catch(() => null);
        if (typeof data?.access_token !== 'string' || !data.access_token.trim()) return 'invalidResponse';
        sessionStorage.setItem('gruzcontrol-server-session', data.access_token);
        location.reload();
      }
    });
  }
}
