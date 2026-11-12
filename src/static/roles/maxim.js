/* Экран Максима. Только вагоны: собственные карточки, журнал, форма и события. */
window.WagonsRoles=window.WagonsRoles||{};
window.WagonsRoles.maxim=function(ctx){
  'use strict';
  const baseShell=ctx.shell;
  const {state,$,esc,icon,tone,localDate,monthStart,addDays,dateHuman,canClose,shell,openModal,productOptions,refreshLoads,isWagonMode}=ctx;
  // Навигация и шапка принадлежат только экрану Максима.
  function pages(){return [['loads','▤','Сегодня'],['wagon-history','◷','Журнал']];}
  function header(u){return `<header class="top app-toolbar maxim-top"><div class="maxim-brand"><span class="maxim-brand-icon" aria-hidden="true">${icon('wagon')}</span><span>Вагоны</span></div>${state.previewWagon?'<button type="button" class="maxim-exit-preview" data-act="preview-off" aria-label="Вернуться в админку">↩ Админка</button>':`<div class="maxim-user"><strong>${esc(u.name)}</strong><span>Ответственный за вагоны</span></div><span class="maxim-avatar">${icon('user')}</span>`}</header>`;}
  function menu(){return `<nav class="nav maxim-bottom" aria-label="Разделы"><div class="nav-inner">
       <button class="nav-btn ${state.tab==='loads'?'active':''}" data-act="nav" data-id="loads"><b aria-hidden="true">${icon('list')}</b>Погрузки</button>
       <button class="nav-btn maxim-bottom-add" data-act="new" aria-label="Добавить вагон"><b aria-hidden="true">${icon('plus')}</b>Добавить</button>
       <button class="nav-btn ${state.tab==='wagon-history'?'active':''}" data-act="nav" data-id="wagon-history"><b aria-hidden="true">${icon('clock')}</b>Журнал</button>
      </div></nav>`;}
  function maximStatus(x){return x==='loaded'?'Загружен':x==='progress'?'В работе':'Ожидает';}
  function maximWagonCard(x){
    return `<article class="maxim-item is-${esc(x.status)}">
      <button class="maxim-item-open" data-act="detail" data-id="${x.id}" aria-label="Открыть вагон ${esc(x.reference)}">
       <span class="maxim-card-icon">${icon('wagon')}</span><span class="maxim-item-main"><strong>№ ${esc(x.reference||('#'+x.id))}</strong><small>${esc(x.product_name)} · ${esc(x.buyer||'Покупатель не указан')}</small></span>
       <span class="maxim-item-side"><strong>${tone(x.tonnes)} т</strong><span class="maxim-status s-${esc(x.status)}">${maximStatus(x.status)}</span></span>
      </button>
    </article>`;
  }
  function maximDateLabel(date){const d=new Date(date+'T12:00:00Z');return new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',day:'numeric',month:'short'}).format(d);}
  function renderMaximLoads(){
    const today=localDate(),day=state.maximDate||today,active=state.loads.filter(x=>x.transport==='wagon'&&x.load_date===day);
    const done=active.filter(x=>x.status==='loaded').length;
    const showing=active.filter(x=>state.filter==='all'||(state.filter==='open'?x.status!=='loaded':x.status==='loaded'));
    shell(`<div class="maxim-view">
      <div class="maxim-title-row"><div><h1>${day===today?'Сегодня':'Вагоны'}</h1><p>${dateHuman(day)}</p></div>
        <label class="maxim-main-date" title="Выбрать дату"><span>${icon('calendar')}</span><strong>${maximDateLabel(day)}</strong><em>⌄</em><input id="maxim-main-date" aria-label="Выбрать дату погрузок" type="date" value="${esc(day)}" /></label></div>
      ${day===today?'':`<button class="maxim-back-today" data-act="maxim-today">← Вернуться к сегодняшним вагонам</button>`}
      <div class="maxim-tiles" role="group" aria-label="Фильтр по состоянию">
        <button data-act="maxim-filter" data-id="all" class="maxim-tile tile-all ${state.filter==='all'?'selected':''}"><span>Всего</span><strong>${active.length}</strong></button>
        <button data-act="maxim-filter" data-id="loaded" class="maxim-tile tile-loaded ${state.filter==='loaded'?'selected':''}"><span>Загружено</span><strong>${done}</strong></button>
        <button data-act="maxim-filter" data-id="open" class="maxim-tile tile-open ${state.filter==='open'?'selected':''}"><span>Осталось</span><strong>${active.length-done}</strong></button>
      </div>
      <div class="maxim-list">${showing.map(maximWagonCard).join('')||`<div class="maxim-empty">На ${day===today?'сегодня':maximDateLabel(day)} вагонов ${state.filter==='all'?'пока нет':'с этим статусом нет'}.<br>Нажми «Добавить» внизу, чтобы добавить запись.</div>`}</div>
     </div>`);
  }
  // Журнал показывает итоги, а не повторяет карточки с экрана «Погрузки».
  // Храним выбранный месяц отдельно от общего фильтра списка погрузок.
  let journalMonth=localDate().slice(0,7);
  let journalData=null, journalLoading=false, journalError='', journalRequest=0;
  let journalCalendarOpen=false, journalSelectedDay=null, journalExpandedDay=null;
  const monthTitle=month=>{
    const formatted=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'})
      .format(new Date(month+'-01T12:00:00Z'));
    return formatted[0].toUpperCase()+formatted.slice(1);
  };
  const dateTitle=day=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'UTC'})
    .format(new Date(day+'T12:00:00Z'));
  const formatTonnes=value=>tone(value||0);
  function shiftMonth(month,offset){
    const [year,number]=month.split('-').map(Number);
    const d=new Date(Date.UTC(year,number-1+offset,1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
  }
  function zeroDay(day){return {date:day,total:0,loaded:0,remaining:0,progress:0,tonnes_loaded:'0.000'};}
  function dayDetails(day){
    return `<div class="mj-day-details">
      <div class="mj-day-stats">
        <span><small>Всего</small><b>${day.total}</b></span>
        <span><small>Загружено</small><b>${day.loaded}</b></span>
        <span><small>Осталось</small><b>${day.remaining}</b></span>
      </div>
      <div class="mj-day-bottom"><span>Отгружено <strong>${formatTonnes(day.tonnes_loaded)} т</strong></span>
        <button type="button" data-act="journal-open-day" data-id="${day.date}">Открыть погрузки <span aria-hidden="true">↗</span></button>
      </div>
    </div>`;
  }
  function journalCalendar(days){
    const [y,m]=journalMonth.split('-').map(Number);
    const first=(new Date(Date.UTC(y,m-1,1)).getUTCDay()+6)%7;
    const count=new Date(Date.UTC(y,m,0)).getUTCDate();
    const byDate=new Map(days.map(row=>[row.date,row]));
    const labels=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=>`<span class="mj-cal-weekday">${d}</span>`).join('');
    const empty=Array.from({length:first},()=>'<span class="mj-cal-blank" aria-hidden="true"></span>').join('');
    const buttons=Array.from({length:count},(_,idx)=>{
      const day=`${journalMonth}-${String(idx+1).padStart(2,'0')}`;
      const has=byDate.get(day), chosen=journalSelectedDay===day;
      const today=day===localDate();
      return `<button type="button" class="mj-cal-day ${has?'has-loads':''} ${chosen?'selected':''} ${today?'is-today':''}"
          data-act="journal-select-day" data-id="${day}" aria-pressed="${chosen}"
          aria-label="${dateTitle(day)}: ${has?has.total+' вагонов':'вагонов нет'}">
          <span>${idx+1}</span>${has?'<i aria-hidden="true"></i>':''}</button>`;
    }).join('');
    return `<div id="mj-calendar" class="mj-calendar"><div class="mj-calendar-grid">${labels}${empty}${buttons}</div>
      <p><span class="mj-calendar-dot"></span> Дни, в которые были назначены вагоны</p>
    </div>`;
  }
  function renderMaximHistory(live=null){
    const shell=html=>baseShell(html,live);
    const data=journalData?.month===journalMonth?journalData:null;
    const days=data?.days||[];
    const visibleDays=journalSelectedDay?[days.find(x=>x.date===journalSelectedDay)||zeroDay(journalSelectedDay)]:days;
    const mainContent=journalLoading?'<div class="mj-message" role="status">Загружаем сводку месяца…</div>':
      journalError?`<div class="mj-message mj-error">${esc(journalError)}<button data-act="journal-retry">Повторить</button></div>`:
      `<section class="mj-summary" aria-label="Итоги месяца">
        <div class="mj-summary-head"><span>ФАКТИЧЕСКИ ОТГРУЖЕНО</span><span class="mj-summary-mark">${icon('wagon')}</span></div>
        <div class="mj-tonnage"><strong>${formatTonnes(data?.tonnes_loaded)}</strong><span>тонн</span></div>
        <p>Тоннаж только завершённых вагонов</p>
       </section>
       <div class="mj-stats" aria-label="Количество вагонов">
        <div class="mj-stat"><span>Всего</span><strong>${data?.total||0}</strong></div>
        <div class="mj-stat mj-stat-done"><span>Загружено</span><strong>${data?.loaded||0}</strong></div>
        <div class="mj-stat mj-stat-left"><span>Осталось</span><strong>${data?.remaining||0}</strong></div>
       </div>
       <section class="mj-period">
        <button type="button" class="mj-calendar-toggle" data-act="journal-calendar-toggle" aria-expanded="${journalCalendarOpen}" aria-controls="mj-calendar">
          ${icon('calendar')}<span>${journalCalendarOpen?'Скрыть календарь':'Выбрать день в календаре'}</span><span aria-hidden="true">${journalCalendarOpen?'⌃':'⌄'}</span>
        </button>
        ${journalCalendarOpen?journalCalendar(days):''}
       </section>
       <section class="mj-days" aria-label="Итоги по дням">
        <div class="mj-days-title"><h2>${journalSelectedDay?'За '+dateTitle(journalSelectedDay):'История по дням'}</h2>
          ${journalSelectedDay?'<button type="button" data-act="journal-all-days">Все дни</button>':`<span>${days.length} ${days.length===1?'день':'дней'}</span>`}
        </div>
        ${visibleDays.length&&(!journalSelectedDay||visibleDays[0].total)?visibleDays.map(day=>`
           <article class="mj-day-card ${journalExpandedDay===day.date?'expanded':''}">
             <button type="button" class="mj-day-row" data-act="journal-day-toggle" data-id="${day.date}" aria-expanded="${journalExpandedDay===day.date}">
               <span class="mj-day-icon" aria-hidden="true">${icon('calendar')}</span><span class="mj-day-left"><strong>${dateTitle(day.date)}</strong><small>${day.total} ваг. · ${day.loaded} загружено</small></span>
               <span class="mj-day-right"><strong>${formatTonnes(day.tonnes_loaded)} т</strong><span aria-hidden="true">${journalExpandedDay===day.date?'⌃':'⌄'}</span></span>
             </button>${journalExpandedDay===day.date?dayDetails(day):''}
           </article>`).join(''):`<div class="mj-empty">${journalSelectedDay?'На этот день вагонов нет.':'В этом месяце вагонов пока нет.'}${journalSelectedDay?`<button data-act="journal-open-day" data-id="${journalSelectedDay}">Перейти к погрузкам ↗</button>`:''}</div>`}
       </section>`;
    shell(`<div class="maxim-view maxim-journal">
      <header class="mj-heading"><h1>Журнал</h1><p>Сводка погрузок</p></header>
      <div class="mj-month-picker" aria-label="Выбранный месяц">
        <button type="button" data-act="journal-month" data-id="prev" aria-label="Предыдущий месяц">‹</button>
        <div><strong>${monthTitle(journalMonth)}</strong><small>Листай влево или вправо</small></div>
        <button type="button" data-act="journal-month" data-id="next" aria-label="Следующий месяц">›</button>
      </div>${mainContent}
    </div>`);
  }
  async function loadJournal(live=null){
    const month=journalMonth, request=++journalRequest;
    journalData=null;journalLoading=true;journalError='';
    if(!live&&state.tab==='wagon-history'&&isWagonMode())renderMaximHistory();
    try{
      const next=await ctx.api('/api/wagon-journal?month='+encodeURIComponent(month));
      if(request!==journalRequest)return;
      journalData=next;
    }catch(err){
      if(request!==journalRequest)return;
      journalError=err.message||'Не удалось загрузить журнал';
    }finally{
      if(request===journalRequest){
        journalLoading=false;
        if(state.tab==='wagon-history'&&isWagonMode())renderMaximHistory(live);
      }
    }
  }
  async function switchJournalMonth(offset){
    const next=shiftMonth(journalMonth,offset);
    if(next===journalMonth)return;
    journalMonth=next;journalSelectedDay=null;journalExpandedDay=null;
    await loadJournal();
  }
  async function switchMaximTab(id){
    state.tab=id;state.filter='all';state.search='';state.transport='wagon';
    if(id==='wagon-history'){
      await loadJournal();
    }else if(id==='loads'){
      state.maximDate=localDate();state.start=state.end=state.maximDate;
      await refreshLoads();
    }
  }
  function formMaximLoad(data=null,newDate=null){
    const t='wagon',edit=!!data;
      const chosen=data?.load_date||newDate||(state.tab==='loads'?state.maximDate:localDate())||localDate();
      openModal(edit?'Изменить вагон':'Новый вагон',`<form id="load-form" class="maxim-form" data-transport="wagon">
        <div class="maxim-form-fields">
          <label class="maxim-field">Номер вагона<input name="reference" type="text" required maxlength="80" inputmode="numeric" autocomplete="off" placeholder="Например, 52594066" value="${esc(data?.reference||'')}" /></label>
          <label class="maxim-field">Покупатель *<input required name="buyer" type="text" maxlength="150" autocomplete="organization" placeholder="Название покупателя" value="${esc(data?.buyer||'')}" /></label>
          <label class="maxim-field">Продукция<select name="product_id" required>${productOptions(data?.product_id)}</select></label>
          <label class="maxim-field">Тоннаж, т<input name="tonnes" inputmode="decimal" type="text" required placeholder="Например, 68,6" value="${esc(data?.tonnes||'')}" /></label>
          <label class="maxim-field">Дата погрузки<input name="load_date" type="date" required value="${esc(chosen)}" /></label>
          <p class="maxim-form-note">После сохранения Олеся получит уведомление и назначит бригаду.</p>
        </div>
        <div class="maxim-form-actions">${!edit?'<button class="maxim-next" type="button" data-act="save-next">Сохранить и добавить ещё</button>':''}<button class="maxim-submit" type="submit">${edit?'Сохранить изменения':'Сохранить'}</button></div>
      </form>`,{wagonEntry:true});
      $('#load-form').dataset.transport=t;$('#load-form').dataset.loadId=data?.id||'';
      // Без автофокуса: клавиатура не должна вмешиваться в анимацию открытия.
      return;
  }

  async function handleClick(act,id){
    if(act==='maxim-filter'){state.filter=id;renderMaximLoads();return true;}
    if(act==='maxim-today'){state.maximDate=localDate();state.filter='all';state.search='';await refreshLoads();return true;}
    if(state.tab==='wagon-history'&&isWagonMode()){
      if(act==='journal-month'){await switchJournalMonth(id==='prev'?-1:1);return true;}
      if(act==='journal-retry'){await loadJournal();return true;}
      if(act==='journal-calendar-toggle'){journalCalendarOpen=!journalCalendarOpen;renderMaximHistory();return true;}
      if(act==='journal-select-day'){
        journalSelectedDay=id;journalExpandedDay=id;
        journalCalendarOpen=false;renderMaximHistory();return true;
      }
      if(act==='journal-all-days'){journalSelectedDay=null;journalExpandedDay=null;renderMaximHistory();return true;}
      if(act==='journal-day-toggle'){
        journalExpandedDay=journalExpandedDay===id?null:id;
        renderMaximHistory();return true;
      }
      if(act==='journal-open-day'){
        state.tab='loads';state.maximDate=id;state.start=state.end=id;
        state.filter='all';state.search='';await refreshLoads();return true;
      }
    }
    return false;
  }
  // Горизонтальный свайп меняет месяц; вертикальный скролл и нажатия не перехватываем.
  let swipe=null;
  document.addEventListener('touchstart',event=>{
    swipe=null;
    if(state.tab!=='wagon-history'||!isWagonMode()||event.touches.length!==1)return;
    if(!event.target.closest('.maxim-journal'))return;
    const t=event.touches[0];swipe={x:t.clientX,y:t.clientY};
  },{passive:true});
  document.addEventListener('touchend',event=>{
    if(!swipe||state.tab!=='wagon-history'||!isWagonMode())return;
    const previous=swipe;swipe=null;
    const t=event.changedTouches[0];if(!t)return;
    const dx=t.clientX-previous.x,dy=t.clientY-previous.y;
    if(Math.abs(dx)<75||Math.abs(dx)<Math.abs(dy)*1.5)return;
    switchJournalMonth(dx<0?1:-1).catch(err=>ctx.notify(err.message));
  },{passive:true});
  async function handleChange(target){
    if(target.id!=='maxim-main-date')return false;
    state.maximDate=target.value||localDate();state.filter='all';state.search='';await refreshLoads();return true;
  }
  let observedDay=localDate();
  function onVisible(){
    if(document.visibilityState==='visible'&&state.tab==='loads'&&observedDay!==localDate()){
      observedDay=localDate();state.maximDate=observedDay;state.filter='all';state.search='';
      refreshLoads().catch(err=>ctx.notify(err.message));
    }
  }
  return {loadJournal,pages,header,menu,renderMaximLoads,renderMaximHistory,switchMaximTab,formMaximLoad,handleClick,handleChange,onVisible};
};
