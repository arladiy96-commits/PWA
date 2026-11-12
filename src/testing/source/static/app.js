/* ВАГОНЫ / Telegram Mini App. No framework, no external build step. */
(() => {
  'use strict';
  const tg = window.Telegram?.WebApp;
  const $ = s => document.querySelector(s);
  const state = {
    me:null, boot:{products:[],loaders:[],tariffs:[]}, loads:[], tab:'loads', transport:'wagon',
    filter:'open', start:localDate(), end:localDate(), reportStart:monthStart(), reportEnd:localDate(),
    search:'', modalCrew:[], lastCrew:[], report:null, focusLoad:null, previewWagon:false, maximDate:localDate()
  };
  function icon(name){const paths={wagon:'<path d="M3 5h18v12H3zM8 5v12M16 5v12M2 17h20"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="20" r="2"/>',list:'<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M4 9h16M4 15h16M8 3v18"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v7h5"/>',plus:'<path d="M12 3v18M3 12h18"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18M7 15h10"/>',check:'<path d="m5 12 4 4L19 6"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2z"/>'};return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||''}</svg>`;}
  let toastTimer;
  function localDate(){ const d=new Date();return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(d); }
  function monthStart(){return localDate().slice(0,8)+'01';}
  function addDays(date,days){const dt=new Date(date+'T12:00:00Z');dt.setUTCDate(dt.getUTCDate()+days);return dt.toISOString().slice(0,10);}
  function dateHuman(s){return new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',day:'numeric',month:'long',weekday:'long'}).format(new Date(s+'T12:00:00Z'));}

  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function money(c){return (Number(c||0)/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₸';}
  function tone(x){return Number(x||0).toLocaleString('ru-RU',{maximumFractionDigits:3});}
  function vehicleName(x){return x.transport==='wagon'?'Вагон':x.vehicle_kind==='kamaz'?'КамАЗ':'Фура';}
  function vehicleField(data){return `<label class="field">Тип машины<select name="vehicle_kind"><option value="fura" ${data?.vehicle_kind!=='kamaz'?'selected':''}>Фура</option><option value="kamaz" ${data?.vehicle_kind==='kamaz'?'selected':''}>КамАЗ</option></select></label>`;}
  function roleName(role){return ({admin:'Главный администратор',manager:'Отчёты и тарифы',wagon:'Ответственный за вагоны',storekeeper:'Заведующий складом'})[role]||'Ожидает доступа';}
  function canEditLoad(x){return state.me.role==='admin'|| (x.status!=='loaded' && (state.me.role==='manager'||(x.transport==='wagon'?state.me.role==='wagon':state.me.role==='storekeeper')));}
  function canClose(x){return state.me.role==='admin'||(x.status!=='loaded' &&['storekeeper','manager'].includes(state.me.role));}
  function canCrew(x){return state.me.role==='admin'||(['storekeeper','manager'].includes(state.me.role)&&x.status!=='loaded');}
  function canCreate(t){return ['admin','manager'].includes(state.me.role)||(t==='wagon'?state.me.role==='wagon':state.me.role==='storekeeper');}
  function canManage(){return ['admin','manager'].includes(state.me.role);}
  async function api(path, opts={}){
    const res=await fetch(path,{...opts,headers:{'X-Telegram-Init-Data':tg?.initData||'',...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})},cache:'no-store'});
    if(!res.ok){let message='Ошибка сервера';try{const r=await res.json();message=r.detail||message;}catch{}throw new Error(message);}
    return res.json();
  }
  async function saveLoadRequest(form, body){
    if(form.dataset.saving==='1')return null;
    const editing=!!form.dataset.loadId;
    const signature=JSON.stringify(body), storageKey='vagony-pending-load:'+state.me.tg_id;
    if(!editing){
      let pending=null;try{pending=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
      if(form.dataset.operationBody!==signature){
        form.dataset.operationId=pending?.body===signature?pending.id:
          (crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join(''));
        form.dataset.operationBody=signature;
      }
      body._request_id=form.dataset.operationId;
      try{sessionStorage.setItem(storageKey,JSON.stringify({id:body._request_id,body:signature}));}catch{}
    }
    form.dataset.saving='1';
    const buttons=Array.from(form.querySelectorAll('button'));buttons.forEach(x=>x.disabled=true);
    try{
      const result=await post(editing?'/api/loads/'+form.dataset.loadId:'/api/loads',body,editing?'PATCH':'POST');
      if(!editing){try{sessionStorage.removeItem(storageKey);}catch{}}
      return result;
    }finally{form.dataset.saving='0';buttons.forEach(x=>x.disabled=false);}
  }
  async function post(path, body, method='POST'){return api(path,{method,body:JSON.stringify(body)});}
  function notify(s){clearTimeout(toastTimer);const el=$('#toast');el.textContent=s;el.classList.remove('hidden');toastTimer=setTimeout(()=>el.classList.add('hidden'),3500);}
  function isWagonMode(){return state.me?.role==='wagon'||(state.me?.role==='admin'&&state.previewWagon);}
  function appPages(){if(state.me.role==='admin'&&!state.previewWagon)return [['admin-home','◫','Обзор'],['report','≡','Расчёты'],['ad-people','♙','Люди'],['ad-settings','⚙','Управление']];if(state.me.role==='manager')return [['lev-home','◫','Обзор'],['report','≡','Начисления'],['lev-stats','◷','Статистика'],['tariffs','₸','Тарифы']];if(state.me.role==='storekeeper')return [['loads','▤','Погрузки'],['os-loaders','♙','Грузчики'],['os-stats','◷','Статистика']];if(isWagonMode())return roleMethod(maxim,'pages');const pages=[[ 'loads','▤',state.me.role==='storekeeper'?'Склад':'Погрузки' ]];if(canManage())pages.push(['report','◫','Отчёты'],['loaders','♙','Грузчики'],['tariffs','₸','Тарифы']);if(state.me.role==='admin')pages.push(['users','♧','Доступ'],['audit','≡','История']);return pages;}
  // Как в «Мельнице»: узкая неподвижная верхняя панель, без большой дублирующей шапки.
  function appHeader(){const u=state.me;if(u.role==='manager')return roleMethod(lev,'header');if(u.role==='admin'&&!state.previewWagon)return '';if(u.role==='storekeeper')return olesya.header(u);if(isWagonMode())return roleMethod(maxim,'header',u);
    const shortRole=({admin:'Администратор',manager:'Отчёты',wagon:'Вагоны',storekeeper:'Заведующий складом'})[u.role]||'Сотрудник';return `<header class="top app-toolbar"><button type="button" class="toolbar-menu" data-act="quick-menu" aria-label="Открыть меню">☰</button><div class="toolbar-role" title="${esc(u.name)} · ${esc(roleName(u.role))}"><i aria-hidden="true"></i><span>${esc(shortRole)}</span></div></header>`;}
  function menu(){
    if(state.me.role==='manager')return roleMethod(lev,'menu');
    if(state.me.role==='storekeeper')return olesya.menu();
    if(isWagonMode())return roleMethod(maxim,'menu');
    return `<nav class="nav" aria-label="Разделы"><div class="nav-inner">${appPages().map(([id,icon,text])=>`<button class="nav-btn ${(state.tab===id||(state.tab==='lev-detail'&&(state.traceRootTab===id||state.me.role==='admin'&&id==='report'&&['lev-stats','report'].includes(state.traceRootTab)))||(state.me.role==='admin'&&({users:'ad-people',tariffs:'report','lev-stats':'report',audit:'ad-settings','ad-products':'ad-settings','ad-buyers':'ad-settings','ad-trash':'ad-settings','ad-backups':'ad-settings'})[state.tab]===id))?'active':''}" data-act="nav" data-id="${id}" ${state.tab===id?'aria-current="page"':''}><b>${icon}</b>${text}</button>`).join('')}</div></nav>`;
  }
  // Telegram's native header is owned by the client; align our wagon UI and
  // requested client chrome colors with the slate surface.
  function syncWagonTelegramTheme(){
    const light=!!(state.me && (isWagonMode()||['storekeeper','manager','admin'].includes(state.me.role)));
    const header=light?'#c8d1db':'#081321';
    const bottom=light?'#b9c4d0':'#071521';
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute('content',header);
    try{tg?.setHeaderColor?.(header);tg?.setBackgroundColor?.(header);tg?.setBottomBarColor?.(bottom);}catch(e){console.debug('Telegram theme:',e);}
  }
  let lastShellTab=null;
  let lastShellHTML='',liveListPaint=null;
  function overduePanel(){
    if(!['loads','lev-home','admin-home'].includes(state.tab))return '';
    const items=(state.overdue||[]).filter(x=>state.me.role!=='wagon'||x.transport==='wagon');
    if(!items.length)return '';
    const act=state.me.role==='admin'?'ad-edit':state.me.role==='manager'?'lv-load':'detail';
    return `<section class="overdue-panel" aria-label="Незавершённые погрузки"><h2>Не завершены за прошлые дни <span>${items.length}</span></h2><div class="overdue-list">${items.map(x=>`<button type="button" data-act="${act}" data-id="${x.id}"><span><b>${vehicleName(x)} · ${esc(x.reference||'Без номера')}</b><small>${esc(x.load_date.split('-').reverse().join('.'))} · ${esc(x.product_name)} · ${tone(x.tonnes)} т</small>${x.buyer?`<small>${esc(x.buyer)}</small>`:''}</span><strong>${x.status==='progress'?'В работе':'Ожидает'} ›</strong></button>`).join('')}</div></section>`;
  }
  function shell(inner,live=null){
    if(state.tab!=='lev-home'||inner.includes('lv-overview'))inner=overduePanel()+inner;
    live=live||liveListPaint;
    if(live){
      if(live.epoch!==uiEpoch||live.tab!==state.tab||liveBlocked()){livePending=true;return;}
      if(inner===lastShellHTML)return;
      const page=$('#page-scroll');
      if(!page){livePending=true;return;}
      const y=page.scrollTop;
      const expanded=Array.from(page.querySelectorAll('details')).map(x=>x.open);
      page.innerHTML=inner;
      page.querySelectorAll('details').forEach((x,i)=>{x.open=!!expanded[i];});
      page.scrollTop=y;lastShellHTML=inner;return;
    }
    lastShellHTML=inner;
    const previous=$('#page-scroll');
    const y=previous&&lastShellTab===state.tab?previous.scrollTop:0;
    const wagon=isWagonMode();$('#app').classList.toggle('wagon-mode',wagon);$('#app').dataset.role=wagon?'maxim':({storekeeper:'olesya',manager:'lev',admin:'admin'}[state.me.role]||'other');document.documentElement.classList.toggle('wagon-skin',wagon);document.documentElement.classList.toggle('lev-frost',state.me.role==='manager'&&!wagon);document.documentElement.classList.toggle('lev-skin',['manager','admin'].includes(state.me.role)&&!wagon);document.documentElement.classList.toggle('olesya-skin',state.me.role==='storekeeper'&&!wagon);
    $('#app').innerHTML=appHeader()+`<main class="page-scroll" id="page-scroll">${inner}</main>`+menu();
    $('#page-scroll').scrollTop=y;
    lastShellTab=state.tab;
  }
  function quickMenu(){
    openModal('Меню',`<p class="sub">${esc(state.me.name)} · ${esc(roleName(state.me.role))}</p><div class="quick-links">${appPages().map(([id,icon,name])=>`<button class="btn full quick-link ${state.tab===id?'primary':''}" data-act="quick-nav" data-id="${id}">${icon} ${name}</button>`).join('')}</div>${state.previewWagon?'<button class="btn full" style="margin-top:15px" data-act="preview-off">← Вернуться в админку</button>':state.me.role==='admin'?'<button class="btn full" style="margin-top:15px" data-act="preview-on">Предпросмотр экрана Максима</button>':''}`);
  }
  // Высота Telegram Mini App может отличаться от 100vh, особенно при раскрытии окна.
  function syncTelegramViewport(){
    const h=Number(tg?.viewportStableHeight);
    if(Number.isFinite(h)&&h>250)document.documentElement.style.setProperty('--miniapp-height',`${h}px`);
    const full=!!tg?.isFullscreen;
    document.documentElement.classList.toggle('telegram-fullscreen',full);
    const safe=tg?.safeAreaInset||{},content=tg?.contentSafeAreaInset||{};
    // В полноэкранном режиме учитываем и системную панель, и кнопки Telegram.
    const top=full?Math.max(0,Number(safe.top)||0)+Math.max(0,Number(content.top)||0):0;
    const bottom=full?Math.max(0,Number(safe.bottom)||0,Number(content.bottom)||0):0;
    document.documentElement.style.setProperty('--telegram-top',`${top}px`);
    document.documentElement.style.setProperty('--telegram-bottom',`${bottom}px`);
    // Нижняя безопасная область нужна Максиму и вне fullscreen.
    const levTop=full?top:Math.max(0,Number(safe.top)||0,Number(content.top)||0);
    document.documentElement.style.setProperty('--lev-safe-top',levTop+'px');
    for(const side of ['left','right'])document.documentElement.style.setProperty('--lev-safe-'+side,Math.max(0,Number(safe[side])||0,Number(content[side])||0)+'px');
    const wagonBottom=Math.max(0,Number(safe.bottom)||0,Number(content.bottom)||0);
    document.documentElement.style.setProperty('--wagon-safe-bottom',`${wagonBottom}px`);
  }
  tg?.onEvent?.('viewportChanged',event=>{if(event?.isStateStable!==false)syncTelegramViewport();});
  tg?.onEvent?.('fullscreenChanged',()=>{syncTelegramViewport();syncWagonTelegramTheme();});
  tg?.onEvent?.('fullscreenFailed',syncTelegramViewport);
  tg?.onEvent?.('safeAreaChanged',syncTelegramViewport);
  tg?.onEvent?.('contentSafeAreaChanged',syncTelegramViewport);
  function render(){if(!state.me)return;switch(state.tab){case'admin-home':return admin.renderHome();case'ad-people':return admin.renderPeople();case'ad-settings':return admin.renderSettings();case'ad-trash':return admin.renderTrash();case'ad-backups':return admin.renderBackups();case'ad-products':return admin.renderProducts();case'ad-buyers':return admin.renderBuyers();case'lev-detail':lev.renderTrace();break;case'lev-stats':lev.renderStats();break;case'lev-home':lev.renderOverview();break;case'os-loaders':olesya.renderPeople();break;case'os-stats':olesya.renderStats();break;case'loads':isWagonMode()?renderMaximLoads():renderLoads();break;case'wagon-history':renderMaximHistory();break;case'report':renderReport();break;case'loaders':renderLoaders();break;case'tariffs':renderTariffs();break;case'users':renderUsers();break;case'audit':renderAudit();break;}}
  function loadStatus(x){return x==='loaded'?'<span class="badge done">✓ Загружен</span>':x==='progress'?'<span class="badge progress">● В работе</span>':'<span class="badge">○ Ожидает</span>';}
  async function refreshLoads(){if(isWagonMode()&&state.tab==='loads')state.start=state.end=state.maximDate||localDate();const p=new URLSearchParams({start:state.start,end:state.end});if(state.search.trim())p.set('search',state.search.trim());[state.loads,state.overdue]=await Promise.all([api('/api/loads?'+p),api('/api/overdue-loads')]);render();}
  // Единая геометрия открытых модалок во всех ролях. Android Telegram может
  // уменьшать visualViewport, window.innerHeight или оба значения при вызове IME.
  // Меняем только координаты контейнера; поля никогда не пересоздаём при фокусе.
  let modalCloseTimer=0, sheetViewportRaf=0, sheetOpeningRaf=0, sheetBaseHeight=0;
  let backdropReleaseTimer=0, backdropReleaseDeadline=0;
  function freezeModalBackdrop(){
    // The image-backed role dashboards use background-size:cover. Their image must
    // not be resized behind a dialog when Android WebView shrinks for the IME.
    clearTimeout(backdropReleaseTimer);backdropReleaseTimer=0;
    const frame=$('#app');
    if(!frame||document.documentElement.classList.contains('modal-background-frozen'))return;
    const height=Math.round(frame.getBoundingClientRect().height);
    if(height<200)return;
    frame.style.setProperty('--modal-frame-height',height+'px');
    document.documentElement.classList.add('modal-background-frozen');
  }
  function releaseModalBackdrop(){
    if(backdropReleaseTimer)clearTimeout(backdropReleaseTimer);
    backdropReleaseDeadline=Date.now()+1600;
    const tryRelease=()=>{
      backdropReleaseTimer=0;
      if(!$('#overlay').classList.contains('hidden'))return;
      const vv=window.visualViewport;
      const visible=vv?.height||window.innerHeight;
      if(sheetBaseHeight-visible>100&&Date.now()<backdropReleaseDeadline){
        backdropReleaseTimer=setTimeout(tryRelease,80);return;
      }
      document.documentElement.classList.remove('modal-background-frozen');
      $('#app')?.style.removeProperty('--modal-frame-height');
    };
    backdropReleaseTimer=setTimeout(tryRelease,120);
  }
  // Native controls own their gestures. Follow viewport changes on the next
  // frame; delayed blur/picker handling and geometry holds cause visible gaps.
  function syncModalViewport(){
    const overlay=$('#overlay');
    if(overlay.classList.contains('hidden')||overlay.classList.contains('closing'))return;
    const vv=window.visualViewport;
    const layoutHeight=window.innerHeight;
    const visibleHeight=Math.max(160,Math.round(vv?.height>100?Math.min(vv.height,layoutHeight):layoutHeight));
    const visualTop=Math.max(0,Math.round(vv?.offsetTop||0));
    const focused=overlay.contains(document.activeElement)&&document.activeElement?.matches?.('input:not([type="checkbox"]):not([type="radio"]),textarea,[contenteditable="true"]');
    const occlusion=Math.max(0,sheetBaseHeight-visibleHeight,layoutHeight-visualTop-visibleHeight);
    const wasKeyboard=overlay.classList.contains('keyboard-visible');
    const keyboard=occlusion>120&&(!!focused||wasKeyboard);
    // Нативная верхняя панель Telegram не входит в safe-area: без этого
    // заголовок фуры уезжает под кнопку «Закрыть» при появлении клавиатуры.
    const safe=tg?.safeAreaInset||{},content=tg?.contentSafeAreaInset||{};
    const levTop=tg?.isFullscreen?Math.max(0,Number(safe.top)||0)+Math.max(0,Number(content.top)||0):Math.max(0,Number(safe.top)||0,Number(content.top)||0);
    const clearance=state.me?.role==='manager'?levTop+8:(tg&&!tg.isFullscreen?52:8);
    const top=visualTop+clearance,height=Math.max(120,visibleHeight-clearance);
    overlay.style.setProperty('--sheet-top',top+'px');
    overlay.style.setProperty('--sheet-height',height+'px');
    overlay.classList.toggle('keyboard-visible',keyboard);
  }
  function queueModalViewport(){
    if(sheetViewportRaf)return;
    sheetViewportRaf=requestAnimationFrame(()=>{sheetViewportRaf=0;syncModalViewport();});
  }
  window.visualViewport?.addEventListener('resize',queueModalViewport);
  window.visualViewport?.addEventListener('scroll',queueModalViewport);
  window.addEventListener('resize',queueModalViewport);
  tg?.onEvent?.('viewportChanged',queueModalViewport);
  document.addEventListener('focusin',e=>{if(e.target.closest?.('#overlay'))queueModalViewport();});
  document.addEventListener('focusout',e=>{if(e.target.closest?.('#overlay'))queueModalViewport();});
  function attachBuyerSuggestions(){
    const input=$('#modal input[name="buyer"]');if(!input)return;
    input.autocomplete='off';
    const wrap=document.createElement('div');wrap.className='buyer-autocomplete';
    input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
    const list=document.createElement('div');list.className='buyer-suggestions';list.hidden=true;
    list.setAttribute('role','group');list.setAttribute('aria-label','Подсказки покупателей');wrap.appendChild(list);
    let buyers=[];
    const normalize=s=>s.trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
    function draw(){
      const q=normalize(input.value);
      const matches=q?buyers.filter(name=>normalize(name).includes(q)&&normalize(name)!==q).slice(0,6):[];
      list.replaceChildren();list.hidden=!matches.length;
      for(const name of matches){
        const button=document.createElement('button');button.type='button';button.textContent=name;
        button.addEventListener('pointerdown',e=>e.preventDefault());
        button.addEventListener('click',()=>{input.value=name;list.hidden=true;input.dispatchEvent(new Event('input',{bubbles:true}));list.hidden=true;input.focus({preventScroll:true});});
        list.appendChild(button);
      }
    }
    input.addEventListener('input',draw);input.addEventListener('focus',draw);
    input.addEventListener('keydown',e=>{if(e.key==='Escape')list.hidden=true;if(e.key==='ArrowDown'&&!list.hidden){e.preventDefault();list.querySelector('button')?.focus();}});
    wrap.addEventListener('focusout',()=>setTimeout(()=>{if(!wrap.contains(document.activeElement))list.hidden=true;},0));
    const form=input.closest('form');
    const transport=form?.querySelector('[name="transport"]')?.value||form?.dataset.transport||(form?.id==='truck-form'?'truck':state.transport);
    api('/api/buyers?'+new URLSearchParams({transport})).then(names=>{if(!input.isConnected)return;buyers=names;if(document.activeElement===input)draw();}).catch(()=>{});
  }
  function openModal(title,html,opts={}){
    uiEpoch++;clearTimeout(liveTimer);
    state.liveDetailId=null;
    const overlay=$('#overlay');
    freezeModalBackdrop();
    clearTimeout(modalCloseTimer);
    if(sheetOpeningRaf)cancelAnimationFrame(sheetOpeningRaf);
    const wasWagonOpen=!overlay.classList.contains('hidden')&&overlay.classList.contains('wagon-entry');
    const wagonEntry=!!opts.wagonEntry;
    overlay.classList.remove('closing','entering','keyboard-visible');
    overlay.classList.toggle('wagon-entry',wagonEntry);
    overlay.classList.add('modal-viewport');
    $('#modal').innerHTML=`<div class="modal-head"><h2>${title}</h2><button class="x" data-act="dismiss" aria-label="Закрыть">×</button></div>${html}`;
    attachBuyerSuggestions();
    overlay.classList.remove('hidden');overlay.setAttribute('aria-hidden','false');
    sheetBaseHeight=Math.max(window.innerHeight,window.visualViewport?.height||0);
    if(wagonEntry&&!wasWagonOpen)overlay.classList.add('entering');
    syncModalViewport();
    if(wagonEntry&&!wasWagonOpen){
      // Перед анимацией фиксируем начальное состояние, иначе первая отрисовка дёргается.
      void $('#modal').offsetHeight;
      sheetOpeningRaf=requestAnimationFrame(()=>{sheetOpeningRaf=0;overlay.classList.remove('entering');});
    }
  }
  function dismiss(){
    if(olesya?.closeTruckPicker?.(false))return;
    uiEpoch++;setTimeout(flushLive,350);
    const overlay=$('#overlay');
    if(overlay.classList.contains('hidden')||overlay.classList.contains('closing'))return;
    overlay.setAttribute('aria-hidden','true');
    if(overlay.contains?.(document.activeElement))document.activeElement.blur();
    if(overlay.classList.contains('wagon-entry')){
      overlay.classList.add('closing');
      modalCloseTimer=setTimeout(()=>{
        if(!overlay.classList.contains('closing'))return;
        overlay.classList.add('hidden');overlay.classList.remove('closing','wagon-entry','keyboard-visible','modal-viewport');
        overlay.style.removeProperty('--sheet-top');overlay.style.removeProperty('--sheet-height');
        $('#modal').innerHTML='';
        releaseModalBackdrop();
      },200);
    }else{
      overlay.classList.add('hidden');overlay.classList.remove('keyboard-visible','modal-viewport');
      overlay.style.removeProperty('--sheet-top');overlay.style.removeProperty('--sheet-height');
      $('#modal').innerHTML='';
      releaseModalBackdrop();
    }
  }
  function productOptions(chosen){return state.boot.products.map(x=>`<option value="${x.id}" ${Number(chosen)===x.id?'selected':''}>${esc(x.name)}</option>`).join('');}
  function formLoad(data=null,newDate=null){const t=data?.transport||state.transport;const edit=!!data;
    const withCrew=t==='wagon'&&state.me.role==='manager'&&!edit;
    if(withCrew)state.modalCrew=[];
    if(t==='wagon'&&isWagonMode())return formMaximLoad(data,newDate);
    openModal(edit?'Изменить погрузку':(t==='wagon'?'Новый вагон':'Новая машина'),
      `<form id="load-form" data-transport="${t}">${t==='truck'?vehicleField(data):''}${t==='wagon'?`<label class="field">Номер вагона *<input name="reference" value="${esc(data?.reference||'')}" required placeholder="Например, 52594066" maxlength="80"/></label>`:''}
      <div class="form-grid"><label class="field">Продукция *<select name="product_id" required>${productOptions(data?.product_id)}</select></label>
      <label class="field">Тоннаж *<input name="tonnes" inputmode="decimal" type="text" value="${esc(data?.tonnes||'')}" required placeholder="68,6"/></label></div>
      <label class="field">Дата погрузки *<input name="load_date" type="date" value="${esc(data?.load_date||state.start)}" required/></label>
      <label class="field">Покупатель *<input required name="buyer" maxlength="150" placeholder="Название организации" value="${esc(data?.buyer||'')}"/></label>
      ${withCrew?'<section class="truck-crew-summary" id="truck-crew-summary"></section>':''}
      <div class="note">${edit?'Изменения будут сохранены в журнале.':'После сохранения карточка сразу появится в системе.'}</div>
      <div class="form-actions"><button type="submit" class="btn primary">${edit?'Сохранить изменения':'Сохранить'}</button>${!edit?'<button class="btn" type="button" data-act="save-next">＋ Ещё один</button>':''}</div></form>`);
    if(withCrew){$('#load-form').dataset.createCrew='1';olesya.drawTruckSummary();}
    $('#load-form').dataset.transport=t;$('#load-form').dataset.loadId=data?.id||'';
    if(state.me.role==='manager'){const form=$('#load-form'),actions=form.querySelector('.form-actions'),fields=document.createElement('div');fields.className='modal-form-fields';while(form.firstChild&&form.firstChild!==actions)fields.appendChild(form.firstChild);form.insertBefore(fields,actions);actions?.classList.add('modal-form-actions');}
  }
  async function saveLoad(again=false){const form=$('#load-form');if(!form||form.dataset.flowSaving==='1'||!form.reportValidity())return;
    form.dataset.flowSaving='1';
    try{
    const data=Object.fromEntries(new FormData(form));data.transport=form.dataset.transport;data.product_id=Number(data.product_id);
    const saved=await saveLoadRequest(form,data);if(!saved)return;
    if(form.dataset.createCrew==='1'){
      form.dataset.loadId=String(saved.id||form.dataset.loadId);
      try{await post('/api/loads/'+form.dataset.loadId+'/crew',{crew:[...state.modalCrew]},'PUT');}
      catch(e){throw new Error('Вагон сохранён, но бригада не назначена. Нажми «Сохранить» ещё раз: второй вагон не создастся. '+e.message);}
    }
    await refreshLoads();
    if(again){const t=data.transport;formLoad(null,t==='wagon'&&isWagonMode()?data.load_date:null);$('#load-form [name="product_id"]').value=String(data.product_id);if(!(t==='wagon'&&isWagonMode()))$('#load-form [name="load_date"]').value=data.load_date;notify('Сохранено! Можно добавить следующий вагон');}
    else {dismiss();notify(isWagonMode()&&data.load_date!==localDate()?'Вагон сохранён на '+dateHuman(data.load_date)+'. Он будет в журнале.':'Вагон сохранён');}
    return saved;
    }finally{form.dataset.flowSaving='0';}
  }
  async function showDetail(id){const x=await api('/api/loads/'+id);state.focusLoad=x;
    const readonly=state.me.role==='manager'&&(x.status==='loaded'||x.deleted);
    const rights=!readonly&&canEditLoad(x),crewRights=!readonly&&canCrew(x),changeStatus=state.me.role==='admin';
    openModal(`${(x.transport==='wagon'?'🚂 ':'🚚 ')+vehicleName(x)} ${esc(x.reference||'#'+id)}`,
      `<div class="split"><div class="value-card"><small>Тоннаж</small><b>${tone(x.tonnes)} т</b></div><div class="value-card"><small>Состояние</small><b style="font-size:14px;margin-top:5px">${x.status==='loaded'?'Загружен':x.status==='progress'?'В работе':'Ожидает'}</b></div></div>
      <div class="note"><b>${esc(x.product_name)}</b> · ${esc(x.load_date)}${x.buyer?'<br/>Покупатель: '+esc(x.buyer):''}${x.status==='loaded'?'<br/>Тариф: '+esc(x.rate_snapshot)+(x.transport==='wagon'?' ₸/вагон':' ₸/т')+' · Фонд: '+money(x.total_cents):''}</div>
      <h3 style="margin-bottom:7px">Бригада (${x.crew.length})</h3><div class="pill-list">${x.crew_names.map(n=>`<span class="pill">${esc(n)}</span>`).join('')||'<span class="sub">Не назначена</span>'}</div>
      <div class="form-actions" style="flex-wrap:wrap">${rights?`<button class="btn" data-act="edit" data-id="${id}">✎ Изменить</button>`:''}${crewRights?`<button class="btn" data-act="crew" data-id="${id}">♙ Бригада</button>`:''}</div>
      ${state.me.role==='manager'&&!readonly&&canClose(x)?`<button class="btn primary full" data-act="close" data-id="${id}" ${x.crew.length?'':'disabled'}>Завершить погрузку</button>`:''}
      ${changeStatus&&x.status==='loaded'?`<button class="btn ghost full" style="margin-top:10px" data-act="reopen" data-id="${id}">↶ Вернуть в работу и отменить начисления</button>`:''}
      ${state.me.role==='admin'?`<button class="btn danger full" style="margin-top:10px" data-act="delete" data-id="${id}">Удалить запись</button>`:''}`);
    state.liveDetailId=id;
  }
  async function changeStatus(id,status){const x=state.loads.find(x=>x.id===id)||await api('/api/loads/'+id);
    if(status==='loaded'&&!window.confirm(`Подтвердить завершение: ${vehicleName(x)} ${x.reference||'#'+id}?\nПосле этого изменять запись сможет только администратор.`))return;
    if(status==='planned'&&!window.confirm('Вернуть в ожидание? Начисления этой погрузки будут отменены.'))return;
    await post(`/api/loads/${id}/status`,{status});dismiss();notify(status==='loaded'?'Погрузка завершена, начисления рассчитаны':'Статус обновлён');await refreshLoads();}
  async function deleteLoad(id){if(!window.confirm('Удалить погрузку из активного учёта? Действие попадёт в журнал.'))return;await api(`/api/loads/${id}`,{method:'DELETE'});dismiss();await refreshLoads();notify('Запись удалена');}
  // Отдельные модули ролевых экранов, общая авторизация и API — здесь.
  // Ошибка в экране одного сотрудника не ломает загрузку остальных ролей.
  function createRole(name,context){
    try{
      const factory=window.WagonsRoles?.[name];
      if(typeof factory!=='function')throw new Error('Не загружен модуль: '+name);
      return factory(context);
    }catch(err){console.error('Ошибка модуля '+name,err);return {};}
  }
  const maxim=createRole('maxim',{state,$,esc,icon,tone,localDate,monthStart,addDays,dateHuman,canClose,shell,openModal,productOptions,refreshLoads,isWagonMode,notify,api});
  const olesya=createRole('olesya',{vehicleName,vehicleField,state,$,esc,tone,money,shell,canClose,canCrew,canCreate,loadStatus,api,post,openModal,dismiss,notify,refreshLoads,formLoad,icon,localDate,addDays,reloadBoot,saveLoadRequest});
  const lev=createRole('lev',{openModal,showDetail,openTruckForm:async()=>{await olesya.handleClick('olesya-new-truck');return true;},formLoad,render,dismiss,vehicleName,state,$,esc,tone,money,shell,api,post,notify,reloadBoot,tg});
  const admin=createRole('admin',{openRevision:(id)=>lev.openRevision(id),openModal,reloadBoot,tone,money,vehicleName,render,state,$,esc,shell,api,post,notify,localDate,tg,dismiss,syncWagonTelegramTheme,refreshLoads});
  function roleMethod(module,method,...args){
    if(typeof module[method]!=='function')throw new Error('Экран временно недоступен: '+method);
    return module[method](...args);
  }
  const renderMaximLoads=(...args)=>roleMethod(maxim,'renderMaximLoads',...args);
  const renderMaximHistory=(...args)=>roleMethod(maxim,'renderMaximHistory',...args);
  const switchMaximTab=(...args)=>roleMethod(maxim,'switchMaximTab',...args);
  const formMaximLoad=(...args)=>roleMethod(maxim,'formMaximLoad',...args);
  const renderLoads=(...args)=>roleMethod(olesya,'renderLoads',...args);
  const formCrew=(...args)=>roleMethod(olesya,'formCrew',...args);
  const drawCrew=(...args)=>roleMethod(olesya,'drawCrew',...args);
  const saveCrew=(...args)=>roleMethod(olesya,'saveCrew',...args);
  const renderReport=(...args)=>roleMethod(lev,'renderReport',...args);
  const loadReport=(...args)=>roleMethod(lev,'loadReport',...args);
  const sendReport=(...args)=>roleMethod(lev,'sendReport',...args);
  const downloadReport=(...args)=>roleMethod(lev,'downloadReport',...args);
  const renderLoaders=(...args)=>roleMethod(lev,'renderLoaders',...args);
  const renderTariffs=(...args)=>roleMethod(lev,'renderTariffs',...args);
  const saveRates=(...args)=>roleMethod(lev,'saveRates',...args);
  const renderUsers=(...args)=>roleMethod(admin,'renderUsers',...args);
  const accessUser=(...args)=>roleMethod(admin,'accessUser',...args);
  const renderAudit=(...args)=>roleMethod(admin,'renderAudit',...args);
  const downloadBackup=(...args)=>roleMethod(admin,'downloadBackup',...args);
  // Правки модулей видны только там, где действительно используется их функциональность.
  function activeModules(){
    if(isWagonMode())return state.me?.role==='admin'?[admin,maxim]:[maxim];
    if(state.me?.role==='admin')return [admin,lev,olesya];
    if(state.me?.role==='manager')return [lev,olesya];
    if(state.me?.role==='storekeeper')return [olesya];
    return [];
  }
  async function delegatedClick(act,id,button){
    for(const mod of activeModules())if(await mod.handleClick?.(act,id,button))return true;
    return false;
  }
  async function delegatedChange(target){
    for(const mod of activeModules())if(await mod.handleChange?.(target))return true;
    return false;
  }
  function delegatedInput(target){
    for(const mod of activeModules())if(mod.handleInput?.(target))return true;
    return false;
  }
  async function reloadBoot(){state.boot=await api('/api/bootstrap');}
  async function enter(){
    tg?.ready();tg?.expand();
    tg?.setHeaderColor?.('#081321');tg?.setBackgroundColor?.('#081321');tg?.setBottomBarColor?.('#071521');
    // Не позволяем свайпу списка случайно сдвинуть/закрыть окно Mini App.
    try{tg?.disableVerticalSwipes?.();}catch(e){console.debug('Vertical swipe setting unavailable',e);}
    // Режим как у «Мельницы», если Telegram на устройстве его поддерживает.
    try{tg?.requestFullscreen?.();}catch(e){console.debug('Fullscreen unavailable',e);}
    syncTelegramViewport();
    if(!tg?.initData){$('#app').innerHTML=`<div class="loading"><div style="font-size:46px">🚂</div><h2>ВАГОНЫ</h2><p>Это Telegram Mini App.<br/>Открой его через кнопку в личном чате с ботом.</p><p class="sub">Обычная браузерная ссылка не передаёт авторизацию Telegram.</p></div>`;return;}
    try{const data=await api('/api/me');state.me=data.user;
      if(state.me.state!=='active'){
        function pendingScreen(u){
          const denied=u.state==='denied',blocked=u.state==='blocked';
          const title=blocked?'Доступ заблокирован':denied?'Заявка отклонена':'Заявка отправлена';
          const hint=blocked||denied?'Обратись к главному администратору.':'Заявка уже поступила администратору. Как только он назначит роль, этот экран обновится сам.';
          $('#app').innerHTML=`<div class="loading"><div style="font-size:45px">${blocked?'🔒':denied?'❌':'⏳'}</div><h2>${title}</h2><p>${hint}</p><p class="sub">Telegram ID: ${u.tg_id}</p><button class="btn primary" data-act="retry-access">↻ Проверить доступ</button></div>`;
        }
        pendingScreen(state.me);
        const poll=async()=>{
          try{
            if(document.visibilityState==='hidden')return;
            const next=(await api('/api/me')).user;
            if(next.state==='active'){clearInterval(timer);location.reload();return;}
            if(next.state!==state.me.state){state.me=next;pendingScreen(next);}
          }catch(err){console.debug('Access poll:',err.message);}
        };
        const timer=setInterval(poll,8000);
        return;
      }
      syncWagonTelegramTheme();
      state.start=data.today;state.end=data.today;state.maximDate=data.today;state.reportEnd=data.today;state.reportStart=data.today.slice(0,8)+'01';
      if(state.me.role==='storekeeper'){state.transport='wagon';state.start=state.end=localDate();}if(state.me.role==='wagon')state.filter='all';if(state.me.role==='manager')state.tab='lev-home';if(state.me.role==='admin')state.tab='admin-home';
      await reloadBoot();await refreshLoads();if(state.tab==='report')await loadReport();
      const params=new URLSearchParams(location.search);
      if(state.me.role==='admin'&&params.get('section')==='users'){state.tab='users';await renderUsers();}
      if(['admin','manager'].includes(state.me.role)&&['report','tariffs'].includes(params.get('section'))){state.tab=params.get('section');render();}
      const id=params.get('load');if(/^\d+$/.test(id||''))await showDetail(Number(id));
      startLive();
    }catch(e){$('#app').innerHTML=`<div class="loading"><div style="font-size:45px">⚠️</div><h2>Ошибка подключения</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Повторить</button></div>`;}
  }
  document.addEventListener('click',async e=>{
    const btn=e.target.closest('[data-act]');if(!btn)return;const act=btn.dataset.act,id=btn.dataset.id;
    try{
      if(await delegatedClick(act,id,btn))return;
      if(act==='quick-menu'){quickMenu();}
      else if(act==='quick-nav'){dismiss();if(isWagonMode())await switchMaximTab(id);else {state.tab=id;render();if(id==='report'&&!state.report)await loadReport();}}
      else if(act==='nav'){if(isWagonMode())await switchMaximTab(id);else {state.tab=id;render();if(id==='report'&&!state.report)await loadReport();}}
      else if(act==='journal-day'){const today=localDate();state.start=id==='month'?monthStart():id==='tomorrow'?addDays(today,1):today;state.end=id==='month'?addDays(today,7):state.start;await refreshLoads();}

      else if(act==='transport'){state.transport=id;render();}
      else if(act==='today'){state.start=state.end=localDate();state.search='';await refreshLoads();}
      else if(act==='new'){formLoad();}
      else if(act==='dismiss'){dismiss();}
      else if(act==='save-next'){await saveLoad(true);}
      else if(act==='detail'){await showDetail(Number(id));}
      else if(act==='edit'){await (async()=>formLoad(await api('/api/loads/'+id)))();}
      else if(act==='progress'){await changeStatus(Number(id),'progress');}
      else if(act==='close'){await changeStatus(Number(id),'loaded');}
      else if(act==='reopen'){await changeStatus(Number(id),'planned');}
      else if(act==='delete'){await deleteLoad(Number(id));}
      else if(act==='retry-access'){const u=(await api('/api/me')).user;if(u.state==='active')location.reload();else{state.me=u;notify(u.state==='pending'?'Пока ожидаем решения':'Доступ пока закрыт');}}
    }catch(err){notify('⚠ '+err.message);}
  });
  document.addEventListener('submit',async e=>{
    if(!['load-form','loader-form','product-form','truck-form','os-loader-form'].includes(e.target.id))return;e.preventDefault();
    try{
      if(e.target.id==='load-form')await saveLoad(false);
      else if(await olesya.handleSubmit?.(e.target))return;
      else if(['admin','manager'].includes(state.me?.role))await lev.handleSubmit?.(e.target);
    }catch(err){notify('⚠ '+err.message);}
  });
  let searchTimer;
  document.addEventListener('input',e=>{
    if(delegatedInput(e.target))return;
    if(e.target.id==='load-search'){state.search=e.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{try{await refreshLoads();$('#load-search')?.focus();}catch(err){notify(err.message);}},350);}
  });
  document.addEventListener('change',async e=>{
    try{
      if(await delegatedChange(e.target))return;
      if(e.target.id==='start'||e.target.id==='end'){state[e.target.id]=e.target.value;await refreshLoads();}
      if(e.target.id==='olesya-date'){state.start=e.target.value;state.end=e.target.value;await refreshLoads();}
      if(e.target.id==='status-filter'){state.filter=e.target.value;render();}
    }catch(err){notify(err.message);}
  });
  document.addEventListener('visibilitychange',()=>{if(isWagonMode())maxim.onVisible?.();});

  let liveBusy=false,livePending=false,liveTimer=null,liveController=null,mainDirty=false,uiEpoch=0;
  function liveBlocked(){
    return mainDirty||!$('#overlay').classList.contains('hidden')||
      document.activeElement?.matches?.('input,select,textarea,[contenteditable="true"]');
  }
  function flushLive(){
    if(livePending&&!liveBlocked()&&!liveBusy){livePending=false;void refreshLive();}
  }
  document.addEventListener('pointerdown',()=>{uiEpoch++;});
  document.addEventListener('focusin',()=>{uiEpoch++;});
  document.addEventListener('focusout',()=>{clearTimeout(liveTimer);liveTimer=setTimeout(flushLive,400);});
  document.addEventListener('input',e=>{uiEpoch++;if(e.target.closest?.('#page-scroll form, #page-scroll .field'))mainDirty=true;});
  document.addEventListener('click',e=>{
    uiEpoch++;
    if(['nav','quick-nav'].includes(e.target.closest?.('[data-act]')?.dataset.act))mainDirty=false;
    clearTimeout(liveTimer);liveTimer=setTimeout(flushLive,500);
  });
  async function refreshLive(){
    if(!state.me||document.visibilityState==='hidden')return;
    if(liveBusy||liveBlocked()){livePending=true;return;}
    liveBusy=true;
    const tab=state.tab,live={tab,epoch:uiEpoch};
    try{
      const me=(await api('/api/me')).user;
      if(me.state!=='active'||me.role!==state.me.role){location.reload();return;}
      const previousOverdue=JSON.stringify(state.overdue||[]);
      state.overdue=await api('/api/overdue-loads');
      await reloadBoot();
      if(live.epoch!==uiEpoch||tab!==state.tab||liveBlocked()){livePending=true;return;}
      if(tab==='loads'){
        const params=new URLSearchParams({start:state.start,end:state.end});
        if(state.search.trim())params.set('search',state.search.trim());
        const loads=await api('/api/loads?'+params);
        if(live.epoch!==uiEpoch||state.tab!==tab||liveBlocked()){livePending=true;return;}
        if(JSON.stringify(loads)===JSON.stringify(state.loads)&&previousOverdue===JSON.stringify(state.overdue))return;
        state.loads=loads;
        // These renderers are synchronous; paint through the guarded shell.
        liveListPaint=live;
        try{render();}finally{liveListPaint=null;}
      }else if(tab==='wagon-history')await maxim.loadJournal?.(live);
      else if(tab==='os-stats')await olesya.fetchStats?.(live);
      else if(tab==='lev-detail'||tab==='lev-home'||tab==='report'||tab==='lev-stats')await lev.refreshLive?.(live);
      else if(tab==='os-loaders')await olesya.renderPeople(live);
      else if(tab==='admin-home')await admin.renderHome(live);
      else if(tab==='audit')await admin.renderAudit(live);
      else if(tab==='users')await admin.renderUsers(live);
      else if(tab==='tariffs')await lev.renderTariffs(live);
      else if(tab==='loaders')await lev.renderLoaders(live);
    }catch(e){console.debug('Live refresh:',e.message);}
    finally{liveBusy=false;if(livePending&&!liveBlocked()){clearTimeout(liveTimer);liveTimer=setTimeout(flushLive,500);}}
  }
  function startLive(){
    if(typeof ReadableStream==='undefined'||typeof AbortController==='undefined')return;
    let connecting=false;
    const connect=async()=>{
      if(connecting||document.visibilityState==='hidden')return;
      connecting=true;liveController=new AbortController();
      let watchdog;
      const touch=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>liveController?.abort(),45000);};
      try{
        touch();
        const res=await fetch('/api/events',{headers:{'X-Telegram-Init-Data':tg?.initData||''},cache:'no-store',signal:liveController.signal});
        if(res.status===401||res.status===403){location.reload();return;}
        if(!res.ok||!res.body)throw Error('Live connection unavailable');
        const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='';
        while(true){
          const {value,done}=await reader.read();if(done)break;touch();
          buffer+=decoder.decode(value,{stream:true});
          let end;
          while((end=buffer.indexOf('\n\n'))!==-1){
            const message=buffer.slice(0,end);buffer=buffer.slice(end+2);
            if(message.includes('event: access')){location.reload();return;}
            if(message.includes('event: change'))void refreshLive();
          }
        }
      }catch(e){if(document.visibilityState!=='hidden')void refreshLive();}
      finally{clearTimeout(watchdog);connecting=false;setTimeout(connect,1500);}
    };
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='hidden')liveController?.abort();
      else{void refreshLive();void connect();}
    });
    window.addEventListener('online',()=>{void refreshLive();void connect();});
    void connect();
  }

  $('#overlay').addEventListener('click',e=>{if(e.target===$('#overlay'))dismiss();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')dismiss();});
  enter();
})();
