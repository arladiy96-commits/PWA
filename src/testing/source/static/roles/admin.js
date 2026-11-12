/* Главный администратор. Доступ, аудит и резервное копирование. */
window.WagonsRoles=window.WagonsRoles||{};
window.WagonsRoles.admin=function(ctx){
  'use strict';
  const baseShell=ctx.shell;
  const {state,$,esc,shell,api,post,notify,localDate,tg,dismiss,syncWagonTelegramTheme,refreshLoads,openModal,reloadBoot,tone,money,vehicleName}=ctx;
  async function downloadBackup(){
    const res=await fetch('/api/admin/backup',{headers:{'X-Telegram-Init-Data':tg?.initData||''},cache:'no-store'});
    if(!res.ok){let msg='Не удалось создать резервную копию';try{msg=(await res.json()).detail||msg}catch{}throw new Error(msg);}
    const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='Резервная_копия_ГрузКонтроль_'+localDate().split('-').reverse().join('.')+'.sqlite3';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    notify('Резервная копия сформирована');
  }
  async function renderUsers(live=null){
    const shell=html=>baseShell(html,live);
    const users=await api('/api/users');
    const pending=users.filter(x=>x.state==='pending');
    const activeUsers=users.filter(x=>x.state==='active');
    const other=users.filter(x=>x.state!=='pending'&&x.state!=='active');
    const label=x=>({active:'Активен',pending:'Новая заявка',denied:'Отклонена',blocked:'Заблокирован'})[x.state]||'Неизвестно';
    const card=x=>`<article class="pane" style="margin-bottom:10px">
        <div class="row between"><div class="grow"><b>${esc(x.name)}</b><p class="tiny muted" style="margin:5px 0">${x.username?'@'+esc(x.username)+' · ':''}ID ${x.tg_id}</p></div>
        <span class="badge ${x.state==='active'?'done':x.state==='pending'?'progress':''}">${label(x)}</span></div>
        ${x.role==='admin'?'<p class="sub">👑 Главный администратор (смена роли запрещена)</p>':`
        <div style="margin-top:12px"><label class="field">Роль сотрудника
          <select id="role-${x.tg_id}">
            <option value="wagon" ${x.role==='wagon'?'selected':''}>Вагоны · Максим</option>
            <option value="storekeeper" ${x.role==='storekeeper'?'selected':''}>Заведующий складом · Олеся</option>
            <option value="manager" ${x.role==='manager'?'selected':''}>Отчёты · Лев</option>
          </select></label></div>
        <div class="split" style="margin-top:8px">
          <button class="btn good" data-act="approve" data-id="${x.tg_id}">${x.state==='active'?'Сохранить роль':'✓ Выдать доступ'}</button>
          <button class="btn danger" data-act="${x.state==='pending'?'deny':'block'}" data-id="${x.tg_id}" ${x.state==='blocked'||x.state==='denied'?'disabled':''}>${x.state==='pending'?'Отклонить':'Заблокировать'}</button>
        </div>
        ${x.state==='blocked'||x.state==='denied'?'<p class="sub">Для восстановления выбери роль и нажми «Выдать доступ».</p>':''}
        `}</article>`;
    shell(`<div class="row between" style="gap:12px;margin-bottom:8px"><div class="grow"><span class="eyebrow">ГЛАВНЫЙ АДМИНИСТРАТОР</span><h2 class="page-title">Доступ</h2></div><button class="btn small" data-act="refresh-users">↻ Обновить</button></div>
      <p class="sub">Новые сотрудники запускают бота и открывают Mini App. Ты назначаешь роль — доступ появляется автоматически.</p>
      <section style="margin:18px 0 22px"><div class="section-head"><h2>Новые заявки</h2><span class="badge progress">${pending.length}</span></div>
        ${pending.map(card).join('')||'<div class="empty">Новых заявок пока нет. Запусти бота со второго Telegram-аккаунта.</div>'}</section>
      <section style="margin-bottom:22px"><div class="section-head"><h2>Сотрудники с доступом</h2><span class="badge">${activeUsers.length}</span></div>
        ${activeUsers.map(card).join('')||'<p class="sub">Пока никого нет</p>'}</section>
      ${other.length?`<section><div class="section-head"><h2>Отклонённые и заблокированные</h2><span class="badge">${other.length}</span></div>${other.map(card).join('')}</section>`:''}`);
  }
  async function accessUser(id,action){
    const select=$(`#role-${id}`);if(!select)return;
    if(action==='deny'&&!confirm('Отклонить заявку этого пользователя?'))return;
    if(action==='block'&&!confirm('Заблокировать доступ сотруднику?'))return;
    const wantedState=action==='approve'?'active':action==='deny'?'denied':'blocked';
    const result=await post(`/api/users/${id}/access`,{role:select.value,state:wantedState});
    notify(result.changed===false?'Изменений нет':action==='approve'?'Доступ выдан':action==='deny'?'Заявка отклонена':'Доступ заблокирован');
    await renderUsers();
  }
  async function renderAudit(live=null){
    const shell=html=>baseShell(html,live);const records=await api('/api/audit');
    shell(`<div class="eyebrow">КОНТРОЛЬ ИЗМЕНЕНИЙ</div><h2 class="page-title">История</h2><p class="sub">Последние 150 изменений сохраняются с автором и временем.</p><button class="btn" data-act="backup" style="margin-bottom:12px">⬇ Скачать резервную копию базы</button>
      <div class="cards">${records.map(x=>`<div class="pane"><div class="row between"><b>${esc(x.actor_name||x.actor)}</b><span class="tiny muted">${esc(x.created_at.replace('T',' ').slice(0,16))}</span></div>
        <div class="sub">${esc(x.action)} · ${esc(x.entity)} #${x.entity_id}</div>
        <details><summary class="tiny" style="color:var(--accent);margin-top:7px;cursor:pointer">Детали изменения</summary><pre style="overflow-x:auto;white-space:pre-wrap;color:var(--muted);font-size:11px">До: ${esc(x.before_json||'—')}\nПосле: ${esc(x.after_json||'—')}</pre></details></div>`).join('')||'<div class="empty">Пока ничего нет</div>'}</div>`);
  }
  const head=(title,sub='Главный администратор')=>`<header class="ad-head"><small>${sub}</small><h2>${title}</h2></header>`;
  const button=(text,act,id='',danger=false)=>`<button type="button" class="btn ${danger?'danger':''}" data-act="${act}" data-id="${id}">${text}</button>`;
  let day=localDate(),filter='all',selected=null,saving=false,operationId='';
  async function renderHome(live=null){
    const items=await api('/api/loads?'+new URLSearchParams({start:day,end:day}));
    state.overdue=await api('/api/overdue-loads');
    if(state.tab!=='admin-home')return;
    const visible=items.filter(x=>filter==='all'||x.status===filter);
    baseShell(head('Обзор','Погрузки · исправления · контроль')+`<div class="ad-tools"><input type="date" id="ad-date" value="${day}" aria-label="Дата">${button('Сегодня','ad-today')}${button('↻','ad-refresh')}</div><div class="ad-tools">${button('+ Вагон','ad-new','wagon')}${button('+ Машина','ad-new','truck')}</div><div class="lv-tabs">${[['all','Все'],['planned','Ожидают'],['progress','В работе'],['loaded','Загружены']].map(([k,v])=>`<button data-act="ad-filter" data-id="${k}" class="${filter===k?'selected':''}">${v}</button>`).join('')}</div><div class="ad-summary">Всего ${items.length} · Завершено ${items.filter(x=>x.status==='loaded').length} · ${tone(items.filter(x=>x.status==='loaded').reduce((n,x)=>n+Number(x.tonnes),0))} т отгружено</div>`+[['wagon','Вагоны'],['truck','Машины']].map(([kind,title])=>`<section class="pane"><h3>${title} <small>${visible.filter(x=>x.transport===kind).length}</small></h3>${visible.filter(x=>x.transport===kind).map(x=>`<button class="ad-load" data-act="ad-edit" data-id="${x.id}"><span><b>${vehicleName(x)} · ${esc(x.reference||'Без номера')}</b><small>${esc(x.product_name)} · ${tone(x.tonnes)} т · ${x.crew_count} чел.</small></span><span class="lv-status ${x.status}">${({planned:'Ожидает',progress:'В работе',loaded:'Загружен'})[x.status]}</span></button>`).join('')||'<p class="sub">Нет погрузок</p>'}</section>`).join(''),live);
  }
  async function editor(id,kind){
    await reloadBoot();selected=id?await api('/api/loads/'+id):null;
    operationId=crypto.randomUUID();
    const allPeople=await api('/api/loaders'),allProducts=await api('/api/products');
    const x=selected||{transport:kind,load_date:day,crew:[],vehicle_kind:'fura'};
    if(selected){
      if(!allProducts.some(p=>p.id===x.product_id))allProducts.push({id:x.product_id,name:x.product_name,active:0});
      for(const p of allProducts)if(p.id===x.product_id)p.name=x.product_name;
      for(const id of x.crew){const old=allPeople.find(p=>p.id===id);if(old)old.name=x.crew_labels?.[id]||old.name;else allPeople.push({id,name:x.crew_labels?.[id]||('Грузчик #'+id),active:0});}
    }
    const field=(name,label,value='',type='text')=>`<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value??'')}" required></label>`;
    openModal(id?'Изменить погрузку':'Новая погрузка',`<form id="ad-load-form" onsubmit="return false"><input type="hidden" name="transport" value="${x.transport}">${x.transport==='truck'?`<label class="field">Машина<select name="vehicle_kind"><option value="fura">Фура</option><option value="kamaz" ${x.vehicle_kind==='kamaz'?'selected':''}>КамАЗ</option></select></label>`:''}${x.transport==='wagon'?field('reference','Номер вагона',x.reference):''}<label class="field">Продукция<select name="product_id">${allProducts.filter(p=>p.active||p.id===x.product_id).map(p=>`<option value="${p.id}" ${p.id===x.product_id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><div class="split">${field('tonnes','Вес, т',x.tonnes)}${field('load_date','Дата',x.load_date,'date')}</div><label class="field">Покупатель *<input required name="buyer" value="${esc(x.buyer||'')}"></label>${x.status==='loaded'?field('rate_snapshot',x.transport==='wagon'?'Ставка за вагон, ₸':'Ставка за тонну, ₸',x.rate_snapshot)+'<p class="sub">Ставка этой погрузки. При смене продукции или весовой категории убери значение, чтобы взять действующий тариф.</p>':''}<p class="sub">Если убрать всех грузчиков с завершённой погрузки, она вернётся в ожидание, начисления отменятся.</p><details class="pane"><summary>Бригада · выбрано ${x.crew.length}</summary><input id="ad-crew-search" placeholder="Поиск грузчика"><div class="ad-crew-list">${allPeople.filter(l=>l.active||x.crew.includes(l.id)).map(l=>`<label class="choice" data-name="${esc(l.name.toLowerCase())}"><input type="checkbox" name="crew" value="${l.id}" ${x.crew.includes(l.id)?'checked':''}>${esc(l.name)}</label>`).join('')}</div></details>${x.status==='loaded'?'<label class="field">Причина исправления<input name="reason" maxlength="500" placeholder="Например: уточнили тариф"></label>':''}${button('Сохранить изменения','ad-save')}</form>${id?`<div class="ad-tools">${(x.status==='loaded'?[x.crew.length?'progress':'planned']:(x.crew.length?['loaded']:[])).map(v=>button(({planned:'В ожидание',progress:'Отменить завершение',loaded:'Завершить'})[v],'ad-status',v)).join('')}</div>${button('История и расчёт','lv-trace-load',id)}${button('Удалить погрузку','ad-delete',id,true)}`:''}`);
  }
  async function renderPeople(){
    const people=await api('/api/loaders');
    shell(head('Люди')+`<div class="ad-tools">${button('Доступ сотрудников','ad-go','users')}${button('+ Грузчик','ad-person-new')}</div>`+people.map(x=>`<section class="pane"><div class="row between"><b>${esc(x.name)}</b><small>${x.active?'Активен':'Архив'}</small></div><div class="ad-tools">${button('Заработок','lv-person',x.id)}${button('Изменить','ad-person-edit',x.id)}${button(x.active?'В архив':'Вернуть','ad-person-toggle',x.id)}${button('Удалить','ad-person-delete',x.id,true)}</div></section>`).join(''));
  }
  async function renderSettings(){shell(head('Управление')+`<section class="pane ad-grid">${button('Продукция','ad-go','ad-products')}${button('Покупатели','ad-go','ad-buyers')}${button('История изменений','ad-go','audit')}${button('Резервные копии','ad-go','ad-backups')}${button('Корзина','ad-go','ad-trash')}${button('Очистить тестовые данные','ad-reset-open','',true)}</section><p class="sub">Изменения справочников действуют для нового ввода. Данные сохранённых погрузок остаются прежними.</p>`);}
  const stamp=value=>value?esc(value.replace('T',' ').slice(0,19)):'Ещё нет данных';
  async function renderTrash(){
    const items=await api('/api/admin/trash');
    shell(head('Корзина')+button('← Управление','ad-go','ad-settings')+`<p class="sub">Восстанавливаются запись, бригады и начисления на момент удаления. Новые изменения защищены от перезаписи. Здесь отображаются удаления после установки этого обновления. Полная очистка тестовых данных в корзину не попадает.</p>`+items.map(x=>`<section class="pane"><b>${esc(({load:'Погрузка',loader:'Грузчик',product:'Продукция'})[x.kind])} · ${esc(x.label)}</b><p class="sub">${stamp(x.created_at)}</p>${button('Восстановить','ad-restore',x.id)}</section>`).join('')+(items.length?'':'<div class="empty">Корзина пуста</div>'));
  }
  async function renderBackups(){
    const x=await api('/api/admin/backups/status');
    shell(head('Резервные копии')+`<div class="ad-tools">${button('← Управление','ad-go','ad-settings')}${button('Обновить','ad-backups-refresh')}</div>`+(x.unavailable?'<section class="pane">Резервирование недоступно. Проверь настройки сервера.</section>':`<section class="pane"><h3>База → Telegram</h3><p class="sub">${x.db_enabled?'Ежедневно в '+esc(x.clock)+' · Казахстан':'Автоматическая отправка выключена'}</p><p>Последняя отправка: <b>${stamp(x.db_sent_at)}</b></p>${x.db_error?`<p class="sub" role="alert">${esc(x.db_error)} · ${stamp(x.db_error_at)}</p>`:''}<button class="btn" data-act="ad-backup-send" ${x.busy||!x.telegram_ready?'disabled':''}>${x.busy?'Копия отправляется…':'Отправить базу мне в Telegram'}</button>${!x.telegram_ready?'<p class="sub">Не настроены BOT_TOKEN или ADMIN_TG_ID.</p>':''}<p class="sub">Ручная копия не отменяет ежедневную отправку.</p></section><section class="pane"><h3>Проект → GitHub</h3><p class="sub">${x.github_enabled?'Через 5 минут после изменения файлов':'Не настроено'}</p><p>Последнее сохранение: <b>${stamp(x.source_saved_at)}</b></p>${x.source_error?`<p class="sub" role="alert">${esc(x.source_error)} · ${stamp(x.source_error_at)}</p>`:''}</section>`));
  }
  let buyerTransport='wagon',buyerItems=[];
  async function renderBuyers(){
    buyerItems=await api('/api/admin/buyers?'+new URLSearchParams({transport:buyerTransport}));
    shell(head('Покупатели')+button('← Управление','ad-go','ad-settings')+`<div class="lv-tabs">${[['wagon','Вагоны'],['truck','Машины']].map(([id,name])=>`<button data-act="ad-buyers-tab" data-id="${id}" class="${id===buyerTransport?'selected':''}">${name}</button>`).join('')}</div><input id="ad-buyers-search" placeholder="Поиск покупателя" aria-label="Поиск покупателя"><p class="sub">Изменения касаются только подсказок. Покупатели в сохранённых погрузках не меняются.</p>`+buyerItems.map(x=>`<section class="pane ad-buyer-row" data-name="${esc(x.name.toLocaleLowerCase('ru'))}"><b>${esc(x.name)}</b><div class="ad-tools">${button('Изменить','ad-buyer-edit',x.id)}${button('Удалить','ad-buyer-delete',x.id,true)}</div></section>`).join('')+(buyerItems.length?'':'<div class="empty">Покупателей пока нет</div>'));
  }
  async function renderProducts(){const items=await api('/api/products');shell(head('Продукция')+button('+ Добавить','ad-product-new')+items.map(x=>`<section class="pane"><b>${esc(x.name)}</b><small> · ${x.active?'Активна':'Архив'}</small><div class="ad-tools">${button('Изменить','ad-product-edit',x.id)}${button(x.active?'В архив':'Вернуть','ad-product-toggle',x.id)}${button('Удалить из справочника','ad-product-delete',x.id,true)}</div></section>`).join(''));}
  async function handleChange(target){if(target.id==='ad-date'){day=target.value;await renderHome();return true;}return false;}
  function handleInput(target){if(target.id==='ad-buyers-search'){document.querySelectorAll('.ad-buyer-row').forEach(x=>x.hidden=!x.dataset.name.includes(target.value.trim().toLocaleLowerCase('ru')));return true;}if(target.id!=='ad-crew-search')return false;document.querySelectorAll('.ad-crew-list .choice').forEach(x=>x.hidden=!x.dataset.name.includes(target.value.toLowerCase()));return true;}
  async function handleClick(act,id){
    if(act==='ad-buyers-tab'){buyerTransport=id;await renderBuyers();return true;}
    if(act==='ad-buyer-edit'){
      const x=buyerItems.find(x=>x.id===Number(id));if(!x)return true;
      const name=prompt('Название покупателя',x.name);
      if(name?.trim()){await post('/api/admin/buyers/'+id,{name},'PATCH');await renderBuyers();notify('Подсказка изменена');}return true;
    }
    if(act==='ad-buyer-delete'){
      if(confirm('Удалить покупателя из подсказок? В сохранённых погрузках он останется.')){await post('/api/admin/buyers/'+id,{},'DELETE');await renderBuyers();notify('Покупатель убран из подсказок');}return true;
    }

    if(act==='ad-backups-refresh'){await renderBackups();return true;}
    if(act==='ad-backup-send'){
      if(saving)return true;saving=true;
      const b=document.querySelector('[data-act="ad-backup-send"]');if(b){b.disabled=true;b.textContent='Создаю и отправляю…';}
      try{await post('/api/admin/backups/send',{});notify('База отправлена тебе в Telegram');}
      finally{saving=false;await renderBackups();}return true;
    }
    if(act==='ad-restore'){
      if(saving)return true;
      if(!confirm('Восстановить запись и связанные данные? Вес, количество и остаток к сдаче будут пересчитаны. Сданные ведомости останутся в истории.'))return true;
      saving=true;try{await post('/api/admin/trash/'+id+'/restore',{});await reloadBoot();await renderTrash();notify('Восстановлено. Итоги пересчитаны');}finally{saving=false;}return true;
    }
    if(act==='ad-go'){state.tab=id;await ctx.render();return true;}
    if(act==='ad-today'){day=localDate();await renderHome();return true;}
    if(act==='ad-refresh'){await renderHome();return true;}
    if(act==='ad-filter'){filter=id;await renderHome();return true;}
    if(act==='ad-edit'||act==='ad-new'){await editor(act==='ad-edit'?Number(id):null,id);return true;}
    if(act==='ad-save'){
      if(saving)return true;saving=true;
      try{
      const form=$('#ad-load-form'),f=new FormData(form),b=Object.fromEntries(f);b._request_id=operationId;b.product_id=Number(b.product_id);b.crew=f.getAll('crew').map(Number);
      if(!b.rate_snapshot)delete b.rate_snapshot;
      await post(selected?'/api/loads/'+selected.id:'/api/loads',b,selected?'PATCH':'POST');dismiss();await renderHome();notify('Сохранено. Итоги пересчитаны');}finally{saving=false;}return true;
    }
    if(act==='ad-status'){if(!confirm('Изменить статус? Начисления будут пересчитаны.'))return true;await post('/api/loads/'+selected.id+'/status',{status:id,reason:$('#ad-load-form [name="reason"]')?.value||''});dismiss();await renderHome();return true;}
    if(act==='ad-delete'){if(confirm('Удалить погрузку? Вес, количество и начисления будут пересчитаны.')){await post('/api/loads/'+id,{},'DELETE');dismiss();await renderHome();}return true;}
    if(act.startsWith('ad-person-')){
      const items=await api('/api/loaders'),x=items.find(x=>x.id===Number(id));
      if(act.endsWith('-new')){const name=prompt('Имя грузчика');if(name?.trim())await post('/api/loaders',{name});}
      if(act.endsWith('-edit')){const name=prompt('Имя грузчика',x.name);if(name?.trim())await post('/api/loaders/'+id,{name},'PATCH');}
      if(act.endsWith('-toggle'))await post('/api/loaders/'+id,{active:!x.active},'PATCH');
      if(act.endsWith('-delete')&&confirm('Удалить грузчика из справочника? Ранее внесённые бригады и начисления сохранятся.'))await post('/api/admin/loaders/'+id,{},'DELETE');
      await reloadBoot();await renderPeople();return true;
    }
    if(act.startsWith('ad-product-')){
      const items=await api('/api/products'),x=items.find(x=>x.id===Number(id));
      if(act.endsWith('-new')){const name=prompt('Название продукции');if(name?.trim())await post('/api/products',{name});}
      if(act.endsWith('-edit')){const name=prompt('Название продукции',x.name);if(name?.trim())await post('/api/admin/products/'+id,{name},'PATCH');}
      if(act.endsWith('-toggle'))await post('/api/admin/products/'+id,{active:!x.active},'PATCH');
      if(act.endsWith('-delete')&&confirm('Удалить продукцию из справочника? Ранее внесённые погрузки и начисления сохранятся.'))await post('/api/admin/products/'+id,{},'DELETE');
      await reloadBoot();await renderProducts();return true;
    }
    if(act==='ad-cancel-statement'){if(confirm('Отменить сдачу для исправления? Номер, дата и состав ведомости сохранятся. Затем её нужно сдать заново.')){await post('/api/admin/statements/'+id+'/cancel',{});state.tab='report';await ctx.openRevision(id);notify('Сдача отменена. Проверь и сдай эту же ведомость заново.');}return true;}
    if(act==='ad-reset-open'){openModal('Очистить тестовые данные',`<p class="sub">Удалятся все погрузки, грузчики, бригады дня, начисления, ведомости и история. Пользователи и их доступы сохранятся.</p><label class="choice"><input type="checkbox" id="ad-reset-catalogs">Также удалить продукцию и тарифы</label><label class="field">Введи УДАЛИТЬ<input id="ad-reset-confirm" autocomplete="off"></label>${button('Очистить данные','ad-reset','',true)}`);return true;}
    if(act==='ad-reset'){await post('/api/admin/reset',{confirmation:$('#ad-reset-confirm').value,catalogs:$('#ad-reset-catalogs').checked});dismiss();await reloadBoot();state.loads=[];state.report=null;state.tab='admin-home';await renderHome();notify('Тестовые данные очищены');return true;}
    if(['approve','deny','block'].includes(act)){await accessUser(Number(id),act);return true;}
    if(act==='refresh-users'){await renderUsers();notify('Список обновлён');return true;}
    if(act==='backup'){await downloadBackup();return true;}
    if(act==='preview-on'){
      dismiss();state.previewWagon=true;syncWagonTelegramTheme();state.maximDate=localDate();
      state.tab='loads';state.transport='wagon';state.filter='all';state.search='';
      state.start=state.end=localDate();await refreshLoads();return true;
    }
    if(act==='preview-off'){
      dismiss();state.previewWagon=false;syncWagonTelegramTheme();state.tab='loads';
      state.filter='open';await refreshLoads();return true;
    }
    return false;
  }
  return {renderBuyers,renderTrash,renderBackups,renderHome,renderPeople,renderSettings,renderProducts,handleChange,handleInput,renderUsers,accessUser,renderAudit,downloadBackup,handleClick};
};
