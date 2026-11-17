import {createNavigation} from './navigation.js';
import config from './config.js';
import {createAppDialogs} from './dialog.js';
import {showDocument} from './document-panel.js';
import {createServerAdapter} from './server-adapter.js';
import {showLogin} from './login.js';
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
let offlineStatus = 'Подготовка…';
let updateApp;

function settingsMarkup() {
  return `<p class="sub" id="pwa-cache-status" role="status">${offlineStatus}</p>
    <button type="button" class="btn full" data-act="pwa-update"${updateApp ? '' : ' hidden'}>Обновить приложение</button>
    ${config.mode === 'test' ? '<a class="btn full pwa-login-link" href="?login-preview=1">Проверить экран входа</a>' : ''}
    <button type="button" class="btn full" data-act="pwa-switch">${config.mode === 'test' ? 'Сменить кабинет' : 'Выйти'}</button>`;
}

async function leaveCabinet() {
  if (config.mode === 'server') {
    try { await adapter.fetch(config.logoutPath, {method:'POST'}); } catch {}
    sessionStorage.removeItem('gruzcontrol-server-session');
  } else {
    sessionStorage.removeItem('gruzcontrol-test-role');
  }
  location.reload();
}

const appDialogs = createAppDialogs(navigation);
window.PWA={...appDialogs,navigation,mode:config.mode,fetch:(...args)=>adapter.fetch(...args),download:showDocument,settingsMarkup,leaveCabinet,applyUpdate:()=>updateApp?.()};
async function openApp(role){
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
async function setupOffline(){
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
function openLoginPreview(target, onBack) {
  const selected = sessionStorage.getItem('gruzcontrol-test-role');
  showLogin(target, {
    demo: {
      login: 'lev',
      password: 'demo',
      backHref: './',
      backLabel: roleNames[selected] ? 'Вернуться в кабинет' : 'Выбрать тестовый кабинет',
      onBack
    },
    signIn({login, password}) {
      if (login !== 'lev' || password !== 'demo') return 401;
      sessionStorage.setItem('gruzcontrol-test-role', 'manager');
      location.replace('./');
    }
  });
}

let loginPreview;
function showLoginPreview(link) {
  if (loginPreview) return;
  const root = document.documentElement;
  const preview = document.createElement('dialog');
  const theme = document.querySelector('meta[name="theme-color"]');
  const previousTheme = theme?.content;
  const viewport = window.visualViewport;

  function fitViewport() {
    if (viewport.scale !== 1) return;
    preview.style.top = `${viewport.offsetTop}px`;
    preview.style.height = `${viewport.height}px`;
  }

  loginPreview = preview;
  preview.className = 'pwa-login-preview';
  preview.setAttribute('aria-labelledby', 'login-title');
  preview.addEventListener('close', () => {
    viewport?.removeEventListener('resize', fitViewport);
    viewport?.removeEventListener('scroll', fitViewport);
    preview.remove();
    loginPreview = undefined;
    root.classList.remove('pwa-login-page');
    if (theme) theme.content = previousTheme;
    link.focus();
  }, {once: true});
  openLoginPreview(preview, () => preview.close());
  document.body.append(preview);
  if (theme) theme.content = getComputedStyle(preview).backgroundColor;
  if (viewport) {
    fitViewport();
    viewport.addEventListener('resize', fitViewport);
    viewport.addEventListener('scroll', fitViewport);
  }
  preview.showModal();
}

if(config.mode==='test'){
  document.addEventListener('click', event => {
    const link = event.target.closest('a.pwa-login-link');
    if (!link || event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
        typeof window.HTMLDialogElement?.prototype.showModal !== 'function') return;
    event.preventDefault();
    showLoginPreview(link);
  });
  const selected=sessionStorage.getItem('gruzcontrol-test-role');
  if (new URLSearchParams(location.search).get('login-preview') === '1') {
    openLoginPreview(app);
    void setupOffline();
  } else if(roleNames[selected])openApp(selected);
  else{
    app.innerHTML=`<section class="pwa-entry"><span class="eyebrow">ТЕСТОВАЯ ВЕРСИЯ</span><h1>ГрузКонтроль</h1><p>Выбери кабинет</p><div class="pwa-roles">${Object.entries(roleNames).map(([id,name])=>`<button class="btn" data-role="${id}">${name}<span>→</span></button>`).join('')}</div><a class="btn pwa-login-link" href="?login-preview=1">Проверить экран входа</a><p class="sub">Данные только на этом устройстве. Рабочий сервер не подключён.</p><p class="sub" id="pwa-build">Сборка: …</p><details><summary>Как установить на телефон</summary><p>iPhone: Safari → «Поделиться» → «На экран Домой». Android: меню браузера → «Установить приложение» или «Добавить на главный экран».</p><p>Для работы без сети открой меню приложения и дождись надписи «Готово оффлайн».</p></details></section>`;
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
