/* Экран Олеси. Склад, распределение бригад по вагонам и фурам. */
window.WagonsRoles=window.WagonsRoles||{};
window.WagonsRoles.olesya=function(ctx){
  'use strict';
  const baseShell=ctx.shell;
  const {vehicleName,vehicleField,state,$,esc,tone,money,shell,canClose,canCrew,canCreate,loadStatus,api,post,openModal,dismiss,notify,refreshLoads,formLoad}=ctx;

  function formatDateCaption(value){
    try{return new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',day:'numeric',month:'long'}).format(new Date(value+'T12:00:00Z'));}
    catch{ return value; }
  }
  function crewText(x){return x.crew_count?`Бригада · ${x.crew_count} чел.`:'Бригада не назначена';}
  function truckCrewText(x){return x.crew_count?`Бригада · ${x.crew_count} чел.`:'Бригада не выбрана';}
  function emptySection(icon,title,text){
    return `<div class="empty olesya-empty"><span class="em">${icon}</span><strong>${title}</strong><br/><small>${text}</small></div>`;
  }
  function legacyRowCard(x){
    const isWagon=x.transport==='wagon';
    const line2=isWagon?crewText(x):truckCrewText(x);
    const itemClass=isWagon?'olesya-row wagon':'olesya-row truck';
    return `<button type="button" class="${itemClass}" data-act="detail" data-id="${x.id}" aria-label="${vehicleName(x)} ${esc(x.reference||'#'+x.id)}">
      <span class="olesya-row__accent ${x.status}"></span>
      <span class="olesya-row__icon">${isWagon?'🚃':'🚚'}</span>
      <span class="olesya-row__body">
        <span class="olesya-row__top"><strong>${isWagon?'№ ':''}${esc(x.reference||'#'+x.id)}</strong><span class="olesya-row__weight">${tone(x.tonnes)} т</span></span>
        <span class="olesya-row__meta">${esc(line2)}</span>
      </span>
      <span class="olesya-row__status">${loadStatus(x.status)}</span>
    </button>`;
  }

  function legacyRenderLoads(){
    state.transport='wagon';
    if(state.end!==state.start)state.end=state.start;
    const current=state.start;
    const dayLoads=state.loads.filter(x=>x.load_date===current);
    const wagons=dayLoads.filter(x=>x.transport==='wagon').sort((a,b)=>a.id-b.id);
    const trucks=dayLoads.filter(x=>x.transport==='truck').sort((a,b)=>a.id-b.id);
    shell(`<section class="olesya-screen">
      <section class="olesya-hero pane">
        <div class="olesya-hero__header">
          <div class="olesya-hero__brand"><span class="olesya-hero__mark">🏭</span><div><h1>Склад</h1><p>Распределение погрузок</p></div></div>
          <label class="olesya-date-pill" aria-label="Выбрать дату"><span>📅</span><input id="olesya-date" type="date" value="${current}"/></label>
        </div>
        <div class="olesya-hero__caption">${formatDateCaption(current)}</div>
      </section>

      <section class="olesya-group pane">
        <div class="olesya-group__head">
          <div class="olesya-group__title"><span class="olesya-group__emoji">🚃</span><h2>Вагоны <span>${wagons.length}</span></h2></div>
          ${canCreate('wagon')?'<button class="btn primary small" data-act="olesya-new-wagon">＋ Добавить вагон</button>':''}
        </div>
        <p class="sub olesya-hint">Нажми на вагон, чтобы посмотреть детали и назначить людей.</p>
        <div class="olesya-list">${wagons.map(legacyRowCard).join('')||emptySection('📭','На эту дату вагонов нет','Добавь вагон или выбери другой день.')}</div>
      </section>

      <section class="olesya-group pane">
        <div class="olesya-group__head">
          <div class="olesya-group__title"><span class="olesya-group__emoji">🚚</span><h2>Машины <span>${trucks.length}</span></h2></div>
          ${canCreate('truck')?'<button class="btn primary small" data-act="olesya-new-truck">＋ Добавить машину</button>':''}
        </div>
        <p class="sub olesya-hint">При создании машины бригада выбирается сразу.</p>
        <div class="olesya-list">${trucks.map(legacyRowCard).join('')||emptySection('🚚','Машин пока нет','Создай машину, когда появится новая погрузка.')}</div>
      </section>
    </section>`);
  }


  const {icon,localDate,addDays,reloadBoot,saveLoadRequest}=ctx;
  const osIcon=n=>n==='truck'?'<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 4h13v13H2zM15 9h4l3 4v4h-7"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/></svg>':icon(n);
  function header(u){return `<header class="top app-toolbar os-header"><strong>${osIcon('list')} Склад</strong><div><b>${esc(u.name)}</b><small>Заведующий складом</small></div>${osIcon('user')}</header>`;}
  function menu(){return `<nav class="nav os-nav"><div class="nav-inner">${[['loads','list','Погрузки'],['os-loaders','user','Грузчики'],['os-stats','clock','Статистика']].map(([id,i,label])=>`<button class="nav-btn ${state.tab===id?'active':''}" data-act="nav" data-id="${id}" ${state.tab===id?'aria-current="page"':''}>${osIcon(i)}<span>${label}</span></button>`).join('')}</div></nav>`;}
  let drill=null;
  function rowCard(x){return `<button type="button" class="os-card" data-act="detail" data-id="${x.id}"><span class="os-card-icon">${osIcon(x.transport==='wagon'?'wagon':'truck')}</span><span class="os-card-body"><strong>${x.transport==='wagon'?'№ ':vehicleName(x)+' · '}${esc(x.reference||'Без номера')}</strong><small>${esc(x.product_name)}${x.buyer?' · '+esc(x.buyer):''}</small><small>${x.crew_count?'Бригада · '+x.crew_count+' чел.':'Бригада не назначена'}</small></span><span class="os-card-side"><b>${tone(x.tonnes)} т</b><span class="os-status ${x.status}">${loadStatus(x.status)}</span></span><span aria-hidden="true">›</span></button>`;}
  function renderLoads(){
    if(state.me.role!=='storekeeper')return legacyRenderLoads();
    state.transport='wagon';
    if(!drill&&state.end!==state.start)state.end=state.start;
    const all=state.loads.filter(x=>x.load_date>=state.start&&x.load_date<=state.end);
    const visible=all.filter(x=>!drill||((drill.transport==='all'||x.transport===drill.transport)&&(drill.kind==='all'||(drill.kind==='no_crew'?x.status!=='loaded'&&!x.crew_count:x.status===drill.kind))));
    const groups=[['wagon','Вагоны'],['truck','Машины']];
    shell(`<section class="olesya-screen"><div class="os-title"><div><h1>${drill?'Погрузки':state.start===localDate()?'Сегодня':'Погрузки'}</h1><p>${drill?formatDateCaption(state.start)+' — '+formatDateCaption(state.end):formatDateCaption(state.start)}</p></div><label class="os-date">${icon('calendar')}<input id="olesya-date" type="date" value="${state.start}" aria-label="Дата погрузок"/></label></div>
    ${drill?'<button class="btn os-back" data-act="os-back-stats">← К статистике</button>':''}
    ${groups.map(([type,title])=>{const items=visible.filter(x=>x.transport===type);return `<section class="os-group"><div class="os-group-head"><h2>${osIcon(type==='wagon'?'wagon':'truck')}${title}<span>${items.length}</span></h2>${type==='truck'?'<button class="btn primary small" data-act="olesya-new-truck">+ Машина</button>':''}</div><div class="os-list">${items.map(rowCard).join('')||'<p class="sub os-empty">Погрузок нет</p>'}</div>${type==='wagon'?'<p class="os-hint">Нажми на вагон, чтобы посмотреть детали и назначить людей.</p>':''}</section>`}).join('')}
    ${state.loads.length>=1000?'<p class="note">Показаны первые 1000 записей. Выбери отдельный день для просмотра остальных.</p>':''}</section>`);
  }
  let people=[], peopleQuery='',peopleRequest=0;
  function peopleRows(){return people.filter(x=>x.active&&x.name.toLowerCase().includes(peopleQuery.toLowerCase())).map(x=>`<div class="os-person"><span>${esc(x.name.split(/\s+/).slice(0,2).map(v=>v[0]).join(''))}</span><strong>${esc(x.name)}</strong></div>`).join('')||'<p class="sub os-empty">Грузчики не найдены</p>';}
  async function renderPeople(live=null){
    const shell=html=>baseShell(html,live);const request=++peopleRequest;if(!live)shell('<div class="os-panel">Загружаем грузчиков…</div>');try{people=await api('/api/loaders');if(state.tab!=='os-loaders'||request!==peopleRequest)return;shell(`<div class="os-title"><div><h1>Грузчики</h1><p>Общий список для вагонов и машин</p></div></div><input id="os-people-search" placeholder="Поиск по имени" value="${esc(peopleQuery)}" aria-label="Поиск грузчиков"/><button class="btn primary full os-add-person" data-act="os-new-person">+ Добавить грузчика</button><div class="os-people" id="os-people">${peopleRows()}</div>`);}catch(e){if(state.tab==='os-loaders')shell(`<div class="os-panel">${esc(e.message)}<button class="btn" data-act="os-people-retry">Повторить</button></div>`);}}
  function newPerson(){openModal('Новый грузчик',`<form id="os-loader-form"><label class="field">Имя и фамилия<input name="name" required maxlength="120" placeholder="Например, Иван Петров"/></label><p class="sub">Будет доступен при выборе бригады для вагонов и машин.</p><button class="btn primary full" type="submit">Добавить</button></form>`);}
  let statsStart=localDate(),statsEnd=localDate(),statsType='all',statsPreset='today',statsData=null,statsRequest=0,statsBusy=false,statsError='';
  function renderStats(live=null){
    const shell=html=>baseShell(html,live);const t=statsData?.totals;
    shell(`<section class="os-statistics"><div class="os-title"><div><h1>Статистика</h1><p>По дате погрузки · выбранный период</p></div></div><div class="os-panel"><div class="os-tabs">${[['today','Сегодня'],['week','Неделя'],['month','Месяц'],['custom','Свой период']].map(([id,name])=>`<button class="${statsPreset===id?'selected':''}" data-act="os-period" data-id="${id}">${name}</button>`).join('')}</div><div class="os-range"><label>С<input id="os-start" type="date" value="${statsStart}"/></label><label>По<input id="os-end" type="date" value="${statsEnd}"/></label></div><button class="btn full" data-act="os-stats-refresh">Показать</button><div class="os-tabs os-types">${[['all','Все'],['wagon','Вагоны'],['truck','Машины']].map(([id,name])=>`<button class="${statsType===id?'selected':''}" data-act="os-type" data-id="${id}">${name}</button>`).join('')}</div></div>
    ${statsBusy?'<div class="os-panel" role="status">Считаем итоги…</div>':statsError?`<div class="os-panel">${esc(statsError)}<button class="btn" data-act="os-stats-refresh">Повторить</button></div>`:t?`<section class="os-panel"><p class="os-overline">ФАКТИЧЕСКИ ОТГРУЖЕНО</p><div class="os-tonnes">${tone(t.tonnes_loaded)} <small>тонн</small></div><p class="sub">Только завершённые погрузки</p><div class="os-numbers"><span><b>${t.loaded}</b>Завершено</span><span><b>${t.wagons}</b>Вагонов</span><span><b>${t.trucks}</b>Машин</span></div></section><h2 class="os-day-heading">По дням</h2>${statsData.days.map(d=>`<button class="os-day" data-act="os-day" data-id="${d.date}">${icon('calendar')}<span><b>${formatDateCaption(d.date)}</b><small>Завершено: ${d.wagons} ваг. · ${d.trucks} машин</small></span><strong>${tone(d.tonnes_loaded)} т</strong><span>›</span></button>`).join('')||'<div class="os-panel">За этот период погрузок нет.</div>'}`:''}</section>`);
  }
  async function fetchStats(live=null){const request=++statsRequest;statsData=null;statsError='';statsBusy=true;if(!live&&state.tab==='os-stats')renderStats();try{const data=await api('/api/warehouse-stats?'+new URLSearchParams({start:statsStart,end:statsEnd,transport:statsType}));if(request===statsRequest)statsData=data;}catch(e){if(request===statsRequest)statsError=e.message;}finally{if(request===statsRequest){statsBusy=false;if(state.tab==='os-stats')renderStats(live);}}}
  async function showDrill(kind,day){drill={kind,transport:statsType};state.start=day||statsStart;state.end=day||statsEnd;state.search='';state.tab='loads';await refreshLoads();}

  let truckPicker=null, truckCopyRequest=0;
  function openTruckForm(data=null){
    truckPicker=null;truckCopyRequest++;
    const edit=!!data;
    const selected=new Set(data?.crew||[]);
    state.modalCrew=[...selected];
    openModal(edit?'Изменить машину':'Новая машина',`
      <form id="truck-form">
        <div class="modal-form-fields">
        ${vehicleField(data)}
        <div class="form-grid">
          <label class="field">Продукция *<select name="product_id" required>${state.boot.products.map(x=>`<option value="${x.id}" ${Number(data?.product_id)===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
          <label class="field">Тоннаж *<input name="tonnes" inputmode="decimal" type="text" value="${esc(data?.tonnes||'')}" required placeholder="68,6"/></label>
        </div>
        <label class="field">Дата погрузки *<input name="load_date" type="date" value="${esc(data?.load_date||state.start)}" required/></label>
        <label class="field">Покупатель *<input required name="buyer" maxlength="150" placeholder="Название организации" value="${esc(data?.buyer||'')}"/></label>
        <section class="truck-crew-summary" id="truck-crew-summary"></section>
        </div>
        <div class="modal-form-actions"><div class="form-actions"><button type="submit" class="btn primary">${edit?'Сохранить изменения':'Сохранить машину'}</button></div></div>
      </form>`);
    const form=$('#truck-form');
    form.dataset.loadId=data?.id||'';
    drawTruckSummary();
  }
  function drawTruckSummary(){
    const root=$('#truck-crew-summary');if(!root)return;
    const names=state.boot.loaders.filter(x=>state.modalCrew.includes(x.id)).map(x=>esc(x.name));
    root.innerHTML=`<b>Бригада · ${names.length} чел.</b><p class="sub">${names.join(', ')||'Грузчики пока не выбраны'}</p><button type="button" class="btn full" data-act="truck-crew-open">${names.length?'Изменить состав':'Выбрать грузчиков'}</button>`;
  }
  function openTruckPicker(){
    const form=$('#truck-form')||$('#load-form[data-create-crew]');if(!form||truckPicker)return;
    const head=$('#modal .modal-head h2'), close=$('#modal .modal-head .x');
    const day=form.elements.load_date.value;
    truckPicker={form,day,crew:[...state.modalCrew],title:head.textContent,closeText:close.textContent,closeLabel:close.getAttribute('aria-label'),scroll:form.querySelector('.modal-form-fields').scrollTop};
    // Keep the original form nodes, values and operation ID intact.
    form.hidden=true;head.textContent='Выбрать грузчиков';close.textContent='←';close.setAttribute('aria-label','Назад без изменения состава');
    $('#modal').insertAdjacentHTML('beforeend',`<section class="crew-editor truck-picker" id="truck-picker">
      <div class="truck-picker-tools"><input id="truck-crew-search" placeholder="Поиск грузчика" aria-label="Поиск грузчика"/>
      <button type="button" class="btn full small" data-act="truck-crew-repeat">Повторить бригаду дня · ${esc(day)}</button></div>
      <div class="modal-form-fields"><div id="truck-crew-list"></div></div>
      <div class="modal-form-actions"><button type="button" class="btn primary full" data-act="truck-crew-done" id="truck-crew-done"></button></div>
    </section>`);
    drawTruckCrew();
  }
  function closeTruckPicker(commit=false){
    const picker=truckPicker;if(!picker)return false;
    truckPicker=null;truckCopyRequest++;
    if(!$('#truck-picker')||!picker.form.isConnected)return false;
    $('#truck-picker input:focus')?.blur();
    if(commit)state.modalCrew=[...picker.crew];
    $('#truck-picker').remove();picker.form.hidden=false;
    $('#modal .modal-head h2').textContent=picker.title;
    const close=$('#modal .modal-head .x');close.textContent=picker.closeText;close.setAttribute('aria-label',picker.closeLabel||'Закрыть');
    drawTruckSummary();picker.form.querySelector('.modal-form-fields').scrollTop=picker.scroll;
    return true;
  }
  function updateTruckPickerCount(){
    const button=$('#truck-crew-done');if(button&&truckPicker)button.textContent=`Готово · выбрано ${truckPicker.crew.length}`;
  }
  async function copyTruckCrew(){
    const picker=truckPicker;if(!picker)return;
    const request=++truckCopyRequest;
    const r=await api('/api/day-crew?'+new URLSearchParams({date:picker.day}));
    if(truckPicker!==picker||request!==truckCopyRequest)return;
    if(!r.crew.length){notify('На эту дату ещё нет доступной бригады. Выбери грузчиков вручную.');return;}
    picker.crew=[...new Set(r.crew)].filter(id=>state.boot.loaders.some(x=>x.id===id));drawTruckCrew();
  }
  function drawTruckCrew(){
    const root=$('#truck-crew-list');if(!root||!truckPicker)return;
    const search=($('#truck-crew-search')?.value||'').toLowerCase();
    const filtered=state.boot.loaders.filter(x=>x.name.toLowerCase().includes(search));
    root.innerHTML=filtered.map(x=>`<label class="choice"><input type="checkbox" data-truck-loader="${x.id}" ${truckPicker.crew.includes(x.id)?'checked':''}/><strong>${esc(x.name)}</strong></label>`).join('')||'<p class="muted">Ничего не найдено</p>';
    updateTruckPickerCount();
  }
  async function saveTruck(){
    const form=$('#truck-form');if(!form||!form.reportValidity())return;
    const body=Object.fromEntries(new FormData(form));
    body.transport='truck';body.product_id=Number(body.product_id);body.crew=[...state.modalCrew];
    if(!await saveLoadRequest(form,body))return;
    dismiss();notify(form.dataset.loadId?'Машина обновлена':'Машина создана');await refreshLoads();
  }

  async function formCrew(id){const obj=await api('/api/loads/'+id);state.focusLoad=obj;state.modalCrew=[...obj.crew];

    openModal(`Бригада · ${esc(obj.reference||'#'+obj.id)}`,
      `<div class="crew-editor"><div class="modal-form-fields"><p class="sub">Отметь грузчиков из общего списка. Можно скопировать бригаду с другой погрузки.</p>
      <button type="button" class="btn full" data-act="crew-repeat-day">Повторить бригаду дня · ${esc(obj.load_date)}</button>
      <input id="crew-search" placeholder="🔎 Поиск грузчика" />
      <div id="crew-list" style="margin-top:12px;max-height:38vh;overflow:auto"></div>
      <p class="sub" id="crew-count"></p></div><div class="modal-form-actions"><div class="form-actions"><button class="btn primary full" data-act="save-crew">Сохранить бригаду</button></div></div></div>`);
    drawCrew();
  }
  function drawCrew(){const root=$('#crew-list');if(!root)return;
    const search=($('#crew-search')?.value||'').toLowerCase();const filtered=state.boot.loaders.filter(x=>x.name.toLowerCase().includes(search));
    root.innerHTML=filtered.map(x=>`<label class="choice"><input type="checkbox" data-loader="${x.id}" ${state.modalCrew.includes(x.id)?'checked':''}/><strong>${esc(x.name)}</strong></label>`).join('')||'<p class="muted">Ничего не найдено</p>';
    $('#crew-count').textContent=`Выбрано: ${state.modalCrew.length} чел.`;
  }
  async function saveCrew(){if(!state.focusLoad)return;await post(`/api/loads/${state.focusLoad.id}/crew`,{crew:state.modalCrew},'PUT');dismiss();notify('Бригада сохранена');await refreshLoads();}

  async function handleClick(act,id){
    if(act==='truck-crew-open'){openTruckPicker();return true;}
    if(act==='truck-crew-done'){closeTruckPicker(true);return true;}
    if(act==='truck-crew-repeat'){await copyTruckCrew();return true;}
    if(act==='crew-repeat-day'){
      const obj=state.focusLoad, root=$('#crew-list'), request=++truckCopyRequest;
      if(!obj||!root)return true;
      const r=await api('/api/day-crew?'+new URLSearchParams({date:obj.load_date}));
      if(state.focusLoad!==obj||$('#crew-list')!==root||request!==truckCopyRequest)return true;
      if(!r.crew.length){notify('На эту дату ещё нет доступной бригады. Выбери грузчиков вручную.');return true;}
      state.modalCrew=r.crew.filter(id=>state.boot.loaders.some(x=>x.id===id));drawCrew();return true;
    }
    if(state.me.role==='storekeeper'){
      if(act==='detail'){
        const x=await api('/api/loads/'+id);
        openModal(`${vehicleName(x)+' '}${esc(x.reference||'#'+id)}`,`
          <div class="split"><div class="value-card"><small>Тоннаж</small><b>${tone(x.tonnes)} т</b></div><div class="value-card"><small>Состояние</small><b style="font-size:15px">${x.status==='loaded'?'Загружен':x.status==='progress'?'В работе':'Ожидает'}</b></div></div>
          <p class="note">${esc(x.product_name)} · ${formatDateCaption(x.load_date)}<br>Покупатель: ${esc(x.buyer||'Не указан')}</p>
          <h3>Бригада · ${x.crew.length} чел.</h3><div class="pill-list">${(x.crew_names||[]).map(n=>`<span class="pill">${esc(n)}</span>`).join('')||'<p class="sub">Не назначена</p>'}</div>
          ${x.status!=='loaded'?`<div class="form-actions"><button class="btn primary" data-act="crew" data-id="${x.id}">Выбрать бригаду</button>${x.transport==='truck'?`<button class="btn" data-act="edit" data-id="${x.id}">Изменить машину</button>`:''}</div>`:''}
          ${x.status!=='loaded'?`<div class="form-actions"><button class="btn primary" data-act="close" data-id="${x.id}" ${x.crew.length?'':'disabled'}>Завершить погрузку</button></div>`:''}`);
        state.liveDetailId=Number(id);
        return true;
      }
      if(act==='nav'||act==='quick-nav'){
        dismiss();state.tab=id;
        if(id==='os-loaders')await renderPeople();
        else if(id==='os-stats')await fetchStats();
        else {drill=null;state.start=state.end=localDate();state.search='';await refreshLoads();}
        return true;
      }
      if(act==='os-new-person'){newPerson();return true;}
      if(act==='os-people-retry'){await renderPeople();return true;}
      if(act==='os-back-stats'){state.tab='os-stats';await fetchStats();return true;}
      if(act==='os-stats-refresh'){await fetchStats();return true;}
      if(act==='os-type'){statsType=id;await fetchStats();return true;}
      if(act==='os-period'){
        statsPreset=id;const today=localDate();statsEnd=today;
        if(id==='today')statsStart=today;
        if(id==='week'){const weekday=(new Date(today+'T12:00:00Z').getUTCDay()+6)%7;statsStart=addDays(today,-weekday);}
        if(id==='month')statsStart=today.slice(0,8)+'01';
        if(id==='custom'){statsData=null;renderStats();}else await fetchStats();return true;
      }
      if(act==='os-drill'){await showDrill(id);return true;}
      if(act==='os-day'){await showDrill('all',id);return true;}
    }
    if(act==='crew'){await reloadBoot();await formCrew(Number(id));return true;}
    if(act==='save-crew'){await saveCrew();return true;}
    if(act==='olesya-new-wagon'){state.transport='wagon';formLoad();return true;}
    if(act==='olesya-new-truck'){await reloadBoot();openTruckForm();return true;}
    if(act==='edit'){const obj=await api('/api/loads/'+id); if(obj.transport==='truck'){openTruckForm(obj); return true;}}
    return false;
  }
  function handleInput(target){
    if(target.id==='os-people-search'){peopleQuery=target.value;$('#os-people').innerHTML=peopleRows();return true;}
    if(target.id==='crew-search'){drawCrew();return true;}
    if(target.id==='truck-crew-search'){drawTruckCrew();return true;}
    if(target.dataset.loader){
      truckCopyRequest++;
      const id=Number(target.dataset.loader);
      state.modalCrew=target.checked?[...new Set([...state.modalCrew,id])]:state.modalCrew.filter(x=>x!==id);
      const counter=$('#crew-count');if(counter)counter.textContent=`Выбрано: ${state.modalCrew.length} чел.`;
      return true;
    }
    if(target.dataset.truckLoader){
      if(!truckPicker)return true;
      truckCopyRequest++;
      const id=Number(target.dataset.truckLoader);
      truckPicker.crew=target.checked?[...new Set([...truckPicker.crew,id])]:truckPicker.crew.filter(x=>x!==id);
      updateTruckPickerCount();return true;
    }
    return false;
  }
  async function handleChange(target){
    if(target.id==='olesya-date'){drill=null;state.start=state.end=target.value||localDate();state.search='';await refreshLoads();return true;}
    if(target.id==='os-start'||target.id==='os-end'){if(target.id==='os-start')statsStart=target.value;else statsEnd=target.value;statsPreset='custom';statsData=null;statsRequest++;statsBusy=false;renderStats();return true;}
    return false;
  }
  async function handleSubmit(form){
    if(form.id==='os-loader-form'&&state.me.role==='storekeeper'){
      const name=String(new FormData(form).get('name')||'').trim();if(!name){notify('Укажи имя грузчика');return true;}
      const button=form.querySelector('button[type="submit"]');button.disabled=true;
      try{await post('/api/loaders',{name});await reloadBoot();dismiss();notify('Грузчик добавлен');await renderPeople();}finally{button.disabled=false;}return true;
    }
    if(form.id==='truck-form'){await saveTruck();return true;}
    return false;
  }
  return {drawTruckSummary,closeTruckPicker,fetchStats,header,menu,renderPeople,renderStats,renderLoads,formCrew,drawCrew,saveCrew,handleClick,handleInput,handleChange,handleSubmit};
};
