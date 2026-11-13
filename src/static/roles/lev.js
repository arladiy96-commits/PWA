/* Экран Льва. Грузчики, продукция, тарифы и отчёты. */
window.WagonsRoles=window.WagonsRoles||{};
window.WagonsRoles.lev=function(ctx){
  'use strict';
  const baseShell=ctx.shell;
  const {vehicleName,state,$,esc,tone,money,shell,api,post,notify,reloadBoot,tg}=ctx;
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let mode='pending', current=null, busy=false, detailId=null, statementId=null;
  let revisionId=null, revisionInclude=false, revisionData=null, revisionRequest=0;
  const head=(title,sub)=>`<div class="lv-heading"><div class="eyebrow">УЧЁТ ПОГРУЗОК</div><h2 class="page-title">${title}</h2><p class="sub">${sub}</p></div>`;
  const empty=text=>`<section class="pane lv-empty">${text}</section>`;
  const amount=(n)=>`<strong class="lv-money ${n<0?'negative':''}">${money(n)}</strong>`;

  const frostIcon=name=>{
    const paths={home:'<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z"/>',report:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',stats:'<path d="M12 3v9h9A9 9 0 1 1 12 3Z"/><path d="M16 3a8 8 0 0 1 5 5h-5z"/>',people:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M16 4a3 3 0 0 1 0 6M18 13a5 5 0 0 1 3 4v4M7 21v-5M11 21v-5"/>',rates:'<path d="M5 4h14M5 8h14M12 8v13"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6M17 2v6M3 11h18M7 15h3M14 15h3"/>',left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',mill:'<path d="M3 22V9l5-4 5 4v13M8 5v17M13 22V5l4-3 4 3v17M17 2v20M3 9h10M13 7h8"/>'};
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.report}</svg>`;
  };
  function header(){return `<header class="lf-header"><span class="lf-brand">${frostIcon('mill')}<b>ГрузКонтроль</b></span><span class="lf-identity">${frostIcon('people')}<span>${esc(state.me.name||'Лев')}</span></span></header>`;}
  function menu(){
    const active=state.tab==='lev-detail'?(state.traceRootTab||'report'):state.tab;
    return `<footer class="lf-footer">${state.tab==='lev-home'?`<div class="lf-add"><button class="btn primary" data-act="lv-new-load" data-id="wagon">${overviewIcon('wagon')}<span>+ Вагон</span></button><button class="btn" data-act="lv-new-load" data-id="truck">${overviewIcon('truck')}<span>+ Машина</span></button></div>`:''}<nav class="nav" aria-label="Разделы"><div class="nav-inner">${[['lev-home','home','Главная'],['report','report','Ведомости'],['lev-stats','stats','Статистика'],['loaders','people','Грузчики'],['tariffs','rates','Тарифы']].map(([id,ic,label])=>`<button class="nav-btn ${active===id?'active':''}" data-act="nav" data-id="${id}" ${active===id?'aria-current="page"':''}>${frostIcon(ic)}<span>${label}</span></button>`).join('')}</div></nav></footer>`;
  }
  function frostDay(){
    const label=(overviewDate===today()?'Сегодня, ':'')+overviewDate.split('-').reverse().join('.');
    return `<div class="lf-day"><button data-act="lv-step-day" data-id="-1" aria-label="Предыдущий день">${frostIcon('left')}</button><label class="lf-date">${frostIcon('calendar')}<span>${esc(label)}</span><input id="lv-date" aria-label="Дата погрузок" type="date" value="${overviewDate}" required></label><button data-act="lv-step-day" data-id="1" aria-label="Следующий день">${frostIcon('right')}</button></div>`;
  }
  let traceView=null, traceStack=[], traceRequest=0;
  const link=(text,act,id)=>`<button class="btn small" data-act="${act}" data-id="${id}">${text}</button>`;
  const loadLink=x=>link(esc(vehicleName(x)+' '+(x.reference||'без номера')),'lv-trace-load',x.load_id||x.id);
  const stamp=value=>{if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?esc(value):esc(d.toLocaleString('ru-RU',{timeZone:'Asia/Almaty'}));};
  async function openTrace(view){
    if(state.tab!=='lev-detail'){traceStack=[];state.traceRootTab=state.tab;}
    traceStack.push(state.tab==='lev-detail'?traceView:{type:'root',tab:state.tab,statementId});
    traceView=view;state.tab='lev-detail';
    try{await renderTrace();}catch(e){const previous=traceStack.pop();traceView=previous?.type==='root'?null:previous;state.tab=previous?.type==='root'?previous.tab:'lev-detail';throw e;}
  }
  async function traceBack(){
    const prev=traceStack.pop();
    if(prev&&prev.type!=='root'){traceView=prev;await renderTrace();return;}
    traceView=null;state.tab=prev?.tab||'report';
    if(state.tab==='lev-stats')await renderStats();
    else if(state.tab==='lev-home')await renderOverview();
    else if(state.tab==='admin-home'||state.tab==='ad-people'){await ctx.render();}
    else if(prev?.statementId)await showStatement(prev.statementId);
    else await renderReport();
  }
  const humanDay=value=>String(value||'').split('-').reverse().join('.');
  function personRows(people){return `<div class="lp-people">${people.map(x=>`<button class="lp-person" data-act="lv-person-stats" data-id="${x.loader_id}"><span class="lp-person-name"><b>${esc(x.name)}</b><small>Погрузок: ${x.loads}</small></span><span class="lp-person-money"><small>Начислено</small><b>${money(x.amount_cents)}</b></span><span aria-hidden="true">›</span></button>`).join('')||'<p class="sub">За этот период начислений нет</p>'}</div>`;}
  function personLedger(d,v,start,end,back){
    const work=x=>{
      const active=x.status==='loaded'&&!x.deleted&&x.crew_member!==0;
      const title=x.transport==='wagon'?'Вагон № '+(x.reference||'—'):vehicleName(x)+(x.buyer?' · '+x.buyer:'');
      return `<section class="pane lp-work"><button class="lp-work-link" data-act="lv-trace-load" data-id="${x.load_id||x.id}"><span><small>${esc(humanDay(x.load_date))} · ${esc(x.product_name)}</small><b>${esc(title)}</b></span><span aria-hidden="true">›</span></button>
        ${!active?'<p class="lp-cancelled">Начисление отменено: погрузка удалена, возвращена в работу или грузчик снят с бригады.</p>':''}
        <div class="lp-earned"><small>${x.is_contractor?'Начислено наемнику':'Заработок грузчика'}</small>${amount(x.earned_cents)}</div>
        <div class="lp-balances"><span><small>В сданных ведомостях</small><b>${money(x.paid_cents)}</b></span><span><small>Осталось сдать</small><b>${money(x.balance_cents)}</b></span></div>
        ${active?`<details class="lp-calculation"><summary>Подробности расчёта</summary><dl><div><dt>Тариф</dt><dd>${tone(x.rate_snapshot)} ${x.transport==='wagon'?'₸ за вагон':'₸ за тонну'}</dd></div>${x.transport!=='wagon'?`<div><dt>Тоннаж</dt><dd>${tone(x.tonnes)} т</dd></div>`:''}<div><dt>${x.is_contractor?'За разгрузку вагона':'Фонд бригады'}</dt><dd>${money(x.total_cents)}</dd></div>${!x.is_contractor?`<div><dt>Грузчиков в бригаде</dt><dd>${x.crew_count}</dd></div>`:''}</dl></details>`:''}
        ${x.statements.length?`<div class="lp-statements">${x.statements.map(a=>`<button data-act="lv-trace-statement" data-id="${a.statement_id}"><span>Ведомость № ${a.statement_id}</span><b>${money(a.amount_cents)} <span aria-hidden="true">›</span></b></button>`).join('')}</div>`:''}</section>`;
    };
    return '<div class="lp-ledger">'+head(esc(d.person.name),'Начисления за выбранный период')+back+`<section class="pane lp-period"><div class="lv-range"><label>С<input type="date" id="lv-person-start" value="${start}"></label><label>По<input type="date" id="lv-person-end" value="${end}"></label></div><button class="btn full" data-act="lv-person-period">Показать</button><button class="btn full" style="margin-top:10px" data-act="lv-person-send" data-id="${v.id}" data-start="${start}" data-end="${end}" data-transport="${v.transport||'all'}">${window.PWA.mode==='test'?'Скачать отчёт':'Отчёт в Telegram'}</button>${v.transport&&v.transport!=='all'?'<p class="sub">Фильтр: '+(v.transport==='wagon'?'вагоны':'машины')+'</p>':''}<div class="lp-earned"><small>Всего начислено</small>${amount(d.earned_cents)}</div><div class="lp-balances"><span><small>В сданных ведомостях</small><b>${money(d.paid_cents)}</b></span><span><small>Осталось сдать</small><b>${money(d.balance_cents)}</b></span></div><p class="sub">Период — по дате погрузки.${d.balance_cents<0?' Отрицательный остаток — уменьшение ранее сданной суммы.':''}</p></section><h3 class="lp-section-title">За что начислено</h3>`+d.items.map(work).join('')+(d.items.length?'':empty('За этот период начислений нет'))+'</div>';
  }
  async function renderTrace(live=null){
    if(!traceView)return;
    const request=++traceRequest,v={...traceView};let html='';
    const back=link('← Назад','lv-trace-back','');
    if(v.type==='loader'){
      const start=v.start||statsStart,end=v.end||statsEnd;
      const d=await api('/api/loader-ledger/'+v.id+'?'+new URLSearchParams({start,end,transport:v.transport||'all'}));
      if(state.me.role==='manager')html=personLedger(d,v,start,end,back);
      else html=head(esc(d.person.name),'Работы и расчёты за выбранный период')+back+`<section class="pane"><div class="lv-range"><label>С<input type="date" id="lv-person-start" value="${start}"></label><label>По<input type="date" id="lv-person-end" value="${end}"></label></div><button class="btn full" data-act="lv-person-period">Показать</button><button class="btn full" style="margin-top:10px" data-act="lv-person-send" data-id="${v.id}" data-start="${start}" data-end="${end}" data-transport="${v.transport||'all'}">${window.PWA.mode==='test'?'Скачать отчёт':'Отчёт в Telegram'}</button>${v.transport&&v.transport!=='all'?'<p class="sub">Фильтр: '+(v.transport==='wagon'?'вагоны':'машины')+'</p>':''}<div class="lv-kpis"><span><small>Начислено</small>${amount(d.earned_cents)}</span><span><small>Сдано</small>${amount(d.paid_cents)}</span><span><small>Остаток к сдаче</small>${amount(d.balance_cents)}</span></div><p class="sub">Период — по дате погрузки. Отрицательный остаток — уменьшение ранее сданной суммы.</p></section>`+d.items.map(x=>`<section class="pane">${loadLink(x)}<p>${esc(x.load_date)} · ${esc(x.product_name)}${x.deleted?' · Удалена':''}</p>${x.status==='loaded'&&!x.deleted&&x.crew_member!==0?`<p>${x.transport==='wagon'?tone(x.rate_snapshot)+' ₸ за вагон':tone(x.tonnes)+' т × '+tone(x.rate_snapshot)+' ₸/т'} = ${money(x.total_cents)}${x.is_contractor?' · Наемник на тупике':' на бригаду · '+x.crew_count+' чел.'}</p>`:'<p>Начисление отменено: погрузка удалена, открыта заново или грузчик снят с бригады.</p>'}<p>${x.is_contractor?'Начислено наемнику':'Начислено грузчику'}: <b>${money(x.earned_cents)}</b><br>Сдано: ${money(x.paid_cents)}<br>К сдаче: <b>${money(x.balance_cents)}</b></p>${x.statements.map(a=>link('Сданный наряд · '+money(a.amount_cents),'lv-trace-statement',a.statement_id)).join(' ')}</section>`).join('')+(d.items.length?'':empty('За этот период начислений нет'));
    }else if(v.type==='statement'){
      const d=await api('/api/statements/'+v.id);
      html=head(state.me.role==='manager'?'Ведомость № '+v.id:'Сданный наряд',esc(d.from===d.to?d.from:d.from+' — '+d.to))+back+`<section class="pane"><p>Суммы зафиксированы при сдаче</p>${amount(d.stats.total_cents)}${link('В Telegram','lv-send',v.id)}</section>`+details(d);
    }else{
      const d=await api('/api/load-trace/'+v.id),x=d.load;
      if(request===traceRequest&&traceView?.type==='load')traceView.loadDate=x.load_date;
      const actions={load_created:'Создана погрузка',crew_updated:'Изменена бригада',status_updated:'Изменён статус',load_updated:'Исправлена погрузка',load_deleted:'Погрузка удалена',trash_restored:'Погрузка восстановлена'};
      const labels={reference:'Номер',tonnes:'Тоннаж, т',load_date:'Дата погрузки',buyer:'Покупатель',product_name:'Продукция',status:'Статус',rate_snapshot:'Тариф',total_cents:'Начислено бригаде',crew:'Бригада'};
      const value=(key,val,obj)=>key==='total_cents'?money(val):key==='status'?statusName(val):key==='crew'?(val||[]).map(id=>obj.crew_labels?.[id]||x.crew_labels?.[id]||('Грузчик '+id)).join(', '):String(val??'—');
      html=head(esc(vehicleName(x)+' '+(x.reference||'без номера')),'Погрузка и история расчёта')+back+`<section class="pane"><p>${esc(x.load_date)} · ${esc(x.product_name)} · ${tone(x.tonnes)} т</p><p>${x.buyer?esc(x.buyer)+' · ':''}${x.deleted?'Удалена':statusName(x.status)}</p>${!x.deleted&&x.status==='loaded'?`<p>Фонд бригады: ${money(x.total_cents)} · Тариф: ${tone(x.rate_snapshot)} ${x.transport==='wagon'?'₸/вагон':'₸/т'}</p>`:''}${!x.deleted&&x.status==='loaded'&&x.contractor?`<p>${link('Наемник на тупике','lv-person',0)} · ${money(x.contractor.amount_cents)}<br><small>Тариф: ${tone(x.contractor.rate_snapshot)} ₸/вагон</small></p>`:''}${(x.crew||[]).map(id=>`<div class="lv-line">${link(esc(x.crew_labels?.[id]||'Грузчик'),'lv-person',id)}${x.status==='loaded'?amount((x.payouts||[]).find(p=>p.loader_id===id)?.amount_cents||0):''}</div>`).join('')}${state.me.role==='manager'&&!x.deleted&&x.status!=='loaded'?link('Управление погрузкой','detail',x.id):''}${!x.deleted&&!x.crew?.length?'<p class="sub">Бригада ещё не назначена</p>':''}</section><section class="pane"><h3>Наряды по этой погрузке</h3>${d.statements.map(a=>`<p>${a.cancelled?'Отменённый наряд · '+money(a.amount_cents):link('Открыть наряд · '+money(a.amount_cents),'lv-trace-statement',a.id)}<small class="sub"> ${stamp(a.created_at)}</small></p>`).join('')||'<p class="sub">Ещё не включена в сданные наряды</p>'}</section><details class="pane"><summary>История погрузки</summary><p class="sub">Показаны сохранённые события. В старых записях часть деталей может отсутствовать.</p>${d.events.map(e=>{
        const b=e.before,a=e.after;
        const changes=Object.keys(labels).filter(k=>k in a&&(!(k in b)||JSON.stringify(b[k])!==JSON.stringify(a[k]))).map(k=>`<div>${labels[k]}: ${k in b?esc(value(k,b[k],b))+' → ':''}${esc(value(k,a[k],a))}</div>`).join('');
        const shares=a.payouts&&b.payouts?Array.from(new Set([...a.payouts,...b.payouts].map(p=>p.loader_id))).map(id=>{const before=b.payouts.find(p=>p.loader_id===id)?.amount_cents||0,after=a.payouts.find(p=>p.loader_id===id)?.amount_cents||0;return before===after?'':`<div>${esc(a.crew_labels?.[id]||b.crew_labels?.[id]||('Грузчик '+id))}: ${money(before)} → ${money(after)}</div>`;}).join(''):'';
        return `<article class="lv-trace-event"><b>${esc(actions[e.action]||'Изменение погрузки')}</b><p class="sub">${esc(e.actor_name||'Пользователь')} · ${stamp(e.created_at)}</p>${changes}${shares}${a.reason?`<p>Причина: ${esc(a.reason)}</p>`:''}</article>`;
      }).join('')||'<p>Событий пока нет</p>'}</details>`;
    }
    if(request===traceRequest&&state.tab==='lev-detail')baseShell(html,live);
  }

  function details(d){return d.by_loader.length?`<section class="pane lv-statement-people" aria-label="Получатели ведомости">${d.by_loader.map(p=>`<div class="lv-statement-person"><span><b>${esc(p.name)}</b><small>${p.wagon_count} ваг. · ${p.truck_count} машин</small></span>${amount(p.amount_cents)}</div>`).join('')}</section>`:empty('Начислений нет');}
  let overviewDate=today(), overviewFilter='all', statsStart=today().slice(0,8)+'01', statsEnd=today(), statsTransport='all';
  const statusName=x=>({planned:'Ожидает',progress:'В работе',loaded:'Загружен'}[x]||x);
  const status=x=>`<span class="lv-status ${esc(x)}">${esc(statusName(x))}</span>`;
  const overviewIcon=type=>`<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${type==='wagon'?'<rect x="8" y="5" width="16" height="21" rx="4"/><path d="M13 5V2h6v3M8 16h16M11 10h10M10 26l-3 4m15-4 3 4M9 28h14"/><circle cx="12" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>':type==='truck'?'<path d="M3 7h18v18H3zM21 12h5l4 6v7h-9M25 13v6h5"/><circle cx="9" cy="26" r="3" fill="#dce7ef"/><circle cx="25" cy="26" r="3" fill="#dce7ef"/>':'<path d="m16 2 12 7v14l-12 7-12-7V9zM4 9l12 7 12-7M16 16v14M10 5l12 7"/>'}</svg>`;
  let overviewRequest=0;
  async function renderOverview(live=null){
    const request=++overviewRequest;
    const shell=html=>baseShell(html,live);
    detailId=null;
    try{
      const items=await api('/api/loads?'+new URLSearchParams({start:overviewDate,end:overviewDate}));
    state.overdue=await api('/api/overdue-loads');
      if(state.tab!=='lev-home'||request!==overviewRequest)return;
      const filtered=items.filter(x=>overviewFilter==='all'||x.status===overviewFilter);
      const frost=state.me.role==='manager';
      const group=(type,title)=>{const list=filtered.filter(x=>x.transport===type);return `<section class="lv-load-group"><h3><span class="lv-group-title">${overviewIcon(type)}${title}</span><small class="${list.length?'has-loads':''}">${list.length}</small></h3><div class="lv-group-body">${list.map(x=>`<button class="lv-load ${esc(x.status)}" data-act="lv-load" data-id="${x.id}"><span class="lv-load-icon">${overviewIcon(type)}</span><span class="lv-load-copy"><b>${frost?(type==='wagon'?'Вагон № '+esc(x.reference):esc(vehicleName(x)+(x.reference?' · '+x.reference:''))):(type==='wagon'?'№ ':vehicleName(x)+' · ')+esc(x.reference||'Без номера')}</b><small>${esc(x.product_name)} · ${tone(x.tonnes)} т · ${x.crew_count} чел.</small>${x.buyer?`<small>${esc(x.buyer)}</small>`:''}</span><span class="lv-load-side">${frost&&x.status==='planned'?'<span class="lv-status planned">Без бригады</span>':status(x.status)}<small class="lv-arrow">${frost?"Открыть":"Подробнее"} ›</small></span></button>`).join('')||`<div class="lv-nothing">${overviewIcon('empty')}<span>Нет погрузок</span></div>`}</div></section>`;};
      shell('<div class="lv-overview">'+(frost?frostDay():head('Обзор','Погрузки и назначенные бригады')+`<div class="lv-day"><input id="lv-date" aria-label="Дата погрузок" type="date" value="${overviewDate}"><button class="btn" data-act="lv-today">Сегодня</button><button class="btn" data-act="lv-refresh" aria-label="Обновить">↻</button></div>`)+`<div class="lv-tabs">${[['all','Все'],['planned','Ожидают'],['progress','В работе'],['loaded','Загружены']].map(([k,v])=>`<button data-act="lv-filter" data-id="${k}" aria-pressed="${k===overviewFilter}" class="${k===overviewFilter?'selected':''}">${v}</button>`).join('')}${frost?'<button class="lf-refresh" data-act="lv-refresh" aria-label="Обновить погрузки">↻</button>':''}</div>`+group('wagon','Вагоны')+group('truck','Машины')+'</div>');
    }catch(e){notify(e.message);}
  }
  async function showLoad(id,live=null){
    return openTrace({type:'load',id});
  }
  let statsRendered=null;
  const statsHeading=(title,section)=>`<div class="lv-stat-heading"><h3>${title}</h3><button class="lv-stat-export" data-act="lv-stats-export" data-id="${section}" aria-label="${window.PWA.mode==='test'?'Скачать Word':'Отправить Word в Telegram'}: ${title}" title="Документ Word">${frostIcon('report')}</button></div>`;
  async function renderStats(live=null){
    const shell=html=>baseShell(html,live);
    try{
      const params={start:statsStart,end:statsEnd,transport:statsTransport};
      const d=await api('/api/manager-stats?'+new URLSearchParams(params));
      if(state.tab!=='lev-stats'||params.start!==statsStart||params.end!==statsEnd||params.transport!==statsTransport)return;
      statsRendered=params;
      const table=(headers,rows)=>`<div class="lv-table-wrap"><table class="lv-table"><thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${headers.length}">Нет данных</td></tr>`}</tbody></table></div>`;
      const tr=x=>`<tr><td>${esc(x.name||x.date)}</td><td>${x.loaded}</td><td>${tone(x.tonnes)}</td><td>${money(x.amount_cents)}</td></tr>`;
      shell(head('Статистика','Тоннаж и расходы на погрузку')+`<section class="pane lv-stats-filter"><div class="lv-tabs">${[['today','Сегодня'],['week','7 дней'],['month','Месяц']].map(([k,v])=>`<button data-act="lv-stats-preset" data-id="${k}">${v}</button>`).join('')}</div><div class="lv-range"><label>С<input type="date" id="lv-stats-start" value="${statsStart}"></label><label>По<input type="date" id="lv-stats-end" value="${statsEnd}"></label></div><button class="btn full" style="margin:10px 0" data-act="lv-stats-send">📄 ${window.PWA.mode==='test'?'Скачать отчёт':'Отчёт в Telegram'}</button><p class="sub">Word · Грузчики за выбранный период и транспорт</p><div class="lv-day"><select id="lv-stats-transport" aria-label="Транспорт">${[['all','Весь транспорт'],['wagon','Вагоны'],['truck','Машины']].map(([k,v])=>`<option value="${k}" ${k===statsTransport?'selected':''}>${v}</option>`).join('')}</select><button class="btn primary" data-act="lv-stats-refresh">Показать</button></div></section><section class="pane"><div class="lv-kpis"><span><small>Отгружено</small><b>${tone(d.totals.tonnes)} т</b></span><span><small>Начислено</small><b>${money(d.totals.amount_cents)}</b></span><span><small>Сдано в кассу</small><b>${money(d.paid_cents)}</b></span><span><small>Остаток</small><b>${money(d.balance_cents)}</b></span></div><div class="lv-state-line">Ожидают <b>${d.totals.planned}</b> · В работе <b>${d.totals.progress}</b> · Загружены <b>${d.totals.loaded}</b></div><p class="sub">Средние затраты: ${money(d.totals.cost_per_tonne_cents)} / т. Тоннаж и расходы — по завершённым погрузкам.</p></section><section class="pane">${statsHeading('По транспорту','transport')}${table(['Транспорт','Шт.','Тонн','Затраты'],[['wagon','Вагоны'],['truck','Машины']].map(([k,n])=>tr({...d.transport[k],name:n})))}</section><section class="pane">${statsHeading('По продукции','products')}${table(['Продукт','Шт.','Тонн','Затраты'],d.products.map(tr))}</section><section class="pane">${statsHeading('По дням','days')}${table(['Дата','Шт.','Тонн','Затраты'],d.days.map(tr))}</section><section class="pane">${statsHeading('Начисления по грузчикам','people')}${state.me.role==='manager'?personRows(d.people):table(['Грузчик','Погрузок','Начислено'],d.people.map(x=>`<tr><td>${link(esc(x.name),'lv-person-stats',x.loader_id)}</td><td>${x.loads}</td><td>${money(x.amount_cents)}</td></tr>`))}</section>`);
    }catch(e){notify(e.message);}
  }
  function tabs(){return (state.me?.role==='admin'?'<div class="ad-tools"><button class="btn" data-act="ad-go" data-id="tariffs">Тарифы</button><button class="btn" data-act="ad-go" data-id="lev-stats">Статистика</button></div>':'')+`<div class="lv-tabs">${[['pending','К сдаче'],['period','За период'],['archive','Сданные']].map(([id,name])=>`<button data-act="lv-mode" data-id="${id}" class="${mode===id?'selected':''}">${name}</button>`).join('')}</div>`;}
  async function renderReport(live=null){
    const shell=html=>baseShell(html,live);
    statementId=null;revisionId=null;revisionData=null;revisionRequest++;
    try{
      let body='';current=null;
      if(mode==='archive'){
        const rows=await api('/api/statements');
        body=rows.map(x=>`<button class="pane lv-archive" data-act="lv-statement" data-id="${x.id}" data-cancelled="${x.cancelled?1:0}"><span><b>Ведомость № ${x.id}</b><small>${esc(x.from===x.to?x.from:x.from+' — '+x.to)} · ${x.cancelled?'На исправлении':'Сдана'}</small></span>${amount(x.stats.total_cents)}</button>`).join('')||empty('Сданных ведомостей пока нет');
      }else{
        const overview=mode==='pending'?await api('/api/settlement-overview'):null;
        const d=mode==='pending'?overview.pending:await api('/api/report?'+new URLSearchParams({start:state.reportStart,end:state.reportEnd}));
        current=d;state.report=d;
        body=(mode==='period'?`<section class="pane"><div class="lv-range"><label>С<input id="report-start" type="date" value="${state.reportStart}"></label><label>По<input id="report-end" type="date" value="${state.reportEnd}"></label></div><button class="btn full" data-act="load-report">Показать период</button></section>`:'')+`<section class="pane lv-hero"><small>${mode==='pending'?'К СДАЧЕ В КАССУ':'НАЧИСЛЕНО ЗА ПЕРИОД'}</small>${amount(d.stats.total_cents)}<p class="sub">${mode==='pending'?'Все несданные начисления, включая прошлые дни. Отрицательные суммы — корректировки.':'Общий отчёт, включая уже сданные начисления.'}</p>${mode==='pending'?`<button class="btn full" style="margin-bottom:8px" data-act="lv-draft">${window.PWA.mode==='test'?'Скачать документ':'В Telegram'}</button><button class="btn primary full" data-act="lv-submit" ${d.details.length?'':'disabled'}>Сдать ведомость</button>`:`<button class="btn primary full" data-act="send-report" data-id="docx">${window.PWA.mode==='test'?'Скачать документ':'В Telegram'}</button>`}</section>`+(mode==='pending'?`<details class="pane"><summary>Состав к сдаче · ${d.loads.length} погрузок</summary>${d.loads.map(x=>`<div class="lv-line">${loadLink(x)}<span>${esc(x.load_date)} · ${money(x.total_cents)}</span></div>`).join('')||'<p>Всё сдано</p>'}</details><details class="pane"><summary>Не завершены · ${overview.unfinished.length}</summary><p class="sub">По сегодня включительно. Пока не начислены, сдачу не блокируют.</p>${overview.unfinished.map(x=>`<div class="lv-line">${loadLink(x)}<span>${esc(x.load_date)} · ${statusName(x.status)}</span></div>`).join('')||'<p>Все погрузки завершены</p>'}</details>`:'')+details(d);
      }
      if(state.tab!=='report')return;
      shell(head('Начисления','Ведомости и расчёты с грузчиками')+tabs()+body);
    }catch(e){notify(e.message);}
  }
  async function showStatement(id,live=null){
    const shell=html=>baseShell(html,live);
    statementId=id;revisionId=null;revisionData=null;revisionRequest++;
    const d=await api('/api/statements/'+id);current=null;
    shell(head('Ведомость № '+id,'Погрузки за '+(d.from===d.to?d.from:d.from+' — '+d.to))+`<button class="btn lv-back" data-act="lv-archive">← Все ведомости</button><section class="pane lv-hero"><small>РАСЧЁТ ЗАФИКСИРОВАН</small>${amount(d.stats.total_cents)}<p class="sub">Состав и суммы сохранены на момент сдачи</p>${state.me?.role==='admin'?`<button class="btn danger full" style="margin-bottom:10px" data-act="ad-cancel-statement" data-id="${id}">Отменить сдачу ведомости</button>`:''}<button class="btn primary full" data-act="lv-send" data-id="${id}">${window.PWA.mode==='test'?'Скачать документ':'В Telegram'}</button></section>`+details(d));
  }
  async function openRevision(id,live=null){
    if(revisionId!==Number(id))revisionInclude=false;
    revisionId=Number(id);statementId=null;state.tab='report';revisionData=null;
    const request=++revisionRequest;
    try{
      const d=await api('/api/admin/statements/'+id+'/revision?include_contractor='+revisionInclude);
      if(request!==revisionRequest||state.tab!=='report')return;
      revisionData=d;
      const extra=d.details.filter(x=>x.is_contractor);
      baseShell(head('Ведомость № '+id,'Дата сохраняется: '+(d.from===d.to?d.from:d.from+' — '+d.to))+`<button class="btn lv-back" data-act="lv-archive">← Все ведомости</button><section class="pane"><b>Повторная сдача</b><p class="sub">Только погрузки исходной ведомости. Новые погрузки в неё не попадут.</p><label class="choice"><input type="checkbox" id="lv-include-contractor" ${revisionInclude?'checked':''}><strong>Добавить: Наемник на тупике — уже оплачено</strong></label><p class="sub">Тарифы берутся из раздела «Тарифы». Уже учтённые суммы повторно не добавляются.</p><p>Прежний итог: ${money(d.previous_total_cents)}<br>Новый итог: ${money(d.stats.total_cents)}</p>${extra.map(x=>`<p class="sub">№ ${esc(x.reference)} · ${esc(x.product_name)} · ${tone(x.rate_snapshot)} ₸/вагон · ${money(x.amount_cents)}</p>`).join('')}<button class="btn primary full" data-act="lv-resubmit" data-id="${id}">Сдать заново ведомость № ${id}</button></section>`+details(d),live);
    }catch(e){
      if(request!==revisionRequest||state.tab!=='report')return;
      baseShell(head('Ведомость № '+id,'На исправлении')+`<button class="btn lv-back" data-act="lv-archive">← Все ведомости</button><section class="pane"><p>${esc(e.message)}</p><button class="btn" data-act="lv-revision-retry" data-id="${id}">Обновить расчёт</button><button class="btn" data-act="lv-revision-without" data-id="${id}">Без добавления наемника</button><button class="btn" data-act="nav" data-id="tariffs">Тарифы</button></section>`,live);
    }
  }
  async function loadReport(){await renderReport();}
  async function sendReport(fmt,id){await post(`/api/report/send/${fmt}`,id?{statement_id:Number(id)}:{start:state.reportStart,end:state.reportEnd});notify(window.PWA.mode==='test'?'Документ готов — нажми «Сохранить / открыть»':'Файл отправлен тебе в Telegram');}
  async function downloadFile(url,name){const res=await window.PWA.fetch(url,{headers:{'X-Telegram-Init-Data':tg?.initData||''}});
    if(!res.ok){const j=await res.json();throw new Error(j.detail||'Ошибка создания файла');}
    await window.PWA.download(res);notify('Файл сформирован');
  }
  async function downloadReport(fmt){await downloadFile(`/api/report/export/${fmt}?`+new URLSearchParams({start:state.reportStart,end:state.reportEnd}),`Наряд_${state.reportStart.split('-').reverse().join('.')}_${state.reportEnd.split('-').reverse().join('.')}.${fmt}`);}
  function loaderEditor(id='',name=''){
    ctx.openModal(id?'Изменить имя грузчика':'Добавить грузчика',`<form id="lv-loader-editor" data-id="${esc(id)}"><label class="field">Фамилия и имя<input name="name" value="${esc(name)}" required maxlength="120" autocomplete="off"/></label><div class="form-actions"><button class="btn primary full" type="submit">${id?'Сохранить':'Добавить'}</button></div></form>`);
  }
  async function renderLoaders(live=null){
    const shell=html=>baseShell(html,live);const items=await api('/api/loaders');
    shell(`<div class="lv-heading lv-loaders-heading"><h2 class="page-title">Грузчики</h2></div>
      <section class="pane lv-loaders-list">${state.me.role==='manager'?'<button class="btn primary full" data-act="lv-add-loader">＋ Добавить грузчика</button>':`<form id="loader-form" class="row"><input name="name" placeholder="Фамилия и имя грузчика" required maxlength="120"/><button class="btn primary" type="submit">＋ Добавить</button></form>`}
      <div style="margin-top:14px">${items.map(x=>`<div class="list-item"><div><b>${esc(x.name)}</b><small>${x.active?'Активен':'В архиве'}</small></div><div class="row"><button class="btn small" data-act="rename-loader" data-id="${x.id}" data-name="${esc(x.name)}">✎</button><button class="btn small ${x.active?'danger':'good'}" data-act="toggle-loader" data-id="${x.id}" data-active="${x.active}">${x.active?'В архив':'Вернуть'}</button></div></div>`).join('')||'<p class="sub">Нет сотрудников</p>'}</div></section>`);
  }
  async function renderTariffs(live=null){
    const shell=html=>baseShell(html,live);const items=await api('/api/products'),ts=state.boot.tariffs;
    const contractorRates=state.boot.contractor_rates||[];
    const rows=items.filter(x=>x.active).map(p=>{
      const wagon=ts.find(t=>t.product_id===p.id&&t.transport==='wagon')?.rate||'';
      const tr=ts.find(t=>t.product_id===p.id&&t.transport==='truck');
      const truck=tr?.rate||'',high=tr?.rate_over20||'';
      return `<div class="pane" style="margin-bottom:9px"><div class="row between"><b>${esc(p.name)}</b><button class="btn ghost small" data-act="archive-product" data-id="${p.id}">В архив</button></div>
        <div class="split" style="margin:12px 0"><label class="field">🚂 За один вагон, ₸<input inputmode="decimal" id="rate-w-${p.id}" value="${esc(wagon)}" placeholder="Не установлен" /></label><label class="field">🚚 Машина ≤ 20 т, ₸/т<input inputmode="decimal" id="rate-t-${p.id}" value="${esc(truck)}" placeholder="Не установлен"/></label></div><label class="field">🚚 Машина &gt; 20 т, ₸/т<input inputmode="decimal" id="rate-h-${p.id}" value="${esc(high)}" placeholder="Не установлен"/></label>
        <button class="btn full" data-act="save-rates" data-id="${p.id}">Сохранить тарифы</button></div>`;
    }).join('');
    shell(`${head('Тарифы','Вагоны — за вагон · машины — за тонну')}
      <section class="pane" style="margin-bottom:14px"><form id="product-form" class="row"><input name="name" placeholder="Новый вид продукции" required/><button class="btn primary" type="submit">＋ Добавить</button></form></section>${rows}<section class="pane"><h3>Наемник на тупике</h3><p class="sub">Отдельная оплата за вагон, без деления на бригаду. После настройки тарифов начисляется автоматически при завершении новых погрузок вагонов. Уже завершённые вагоны добавляй через исправление ведомости.</p>${items.filter(x=>!x.deleted).map(p=>`<label class="field">${esc(p.name)} · ₸ за вагон<input inputmode="decimal" id="contractor-rate-${p.id}" value="${esc(contractorRates.find(r=>r.product_id===p.id)?.rate||'')}" placeholder="Не установлен"></label><button class="btn full" data-act="save-contractor-rate" data-id="${p.id}">Сохранить · ${esc(p.name)}</button>`).join('')}<p class="sub">Установи обе ставки до завершения следующего вагона. Изменение тарифов не пересчитывает сохранённые начисления.</p></section><div class="note">Для фур и КамАЗов действуют общие ставки за тонну. Сумма за вагон не зависит от веса и начисляется на всю бригаду. Тариф можно менять в любой момент. Изменения фиксируются в журнале. Пока ставка не установлена, соответствующую погрузку завершить нельзя.</div>`);
  }
  async function saveRates(pid){const w=$(`#rate-w-${pid}`),t=$(`#rate-t-${pid}`);let saved=0;
    const h=$(`#rate-h-${pid}`);
    if((t?.value.trim()||h?.value.trim())&&(!t?.value.trim()||!h?.value.trim()))throw new Error('Укажи обе ставки для машин');
    for(const [transport,input] of [['wagon',w],['truck',t]])if(input?.value.trim()){await post('/api/tariffs',{product_id:pid,transport,rate:input.value,...(transport==='truck'?{rate_over20:h.value}:{})},'PUT');saved++;}
    if(!saved){notify('Введи хотя бы один тариф');return;}
    await reloadBoot();notify('Тарифы сохранены');renderTariffs();
  }
  let sendingSummary=false;
  async function handleClick(act,id,btn){
    if(state.me.role==='manager'&&['lv-load','lv-trace-load','detail'].includes(act)){await ctx.showDetail(Number(id));return true;}
    if(act==='lv-new-load'&&state.me.role==='manager'){
      state.start=state.end=overviewDate;state.transport=id;await reloadBoot();
      if(id==='wagon'){ctx.formLoad();return true;}
      return await ctx.openTruckForm();
    }
    if(act==='lv-trace-back'){await traceBack();return true;}
    if(act==='lv-trace-load'){ctx.dismiss?.();await openTrace({type:'load',id});return true;}
    if(act==='lv-trace-statement'){await openTrace({type:'statement',id});return true;}
    if(act==='lv-person'||act==='lv-person-stats'){
      const day=traceView?.type==='load'&&state.tab==='lev-detail'?traceView.loadDate:null;
      await openTrace({type:'loader',id,start:btn?.dataset?.start||(day?day.slice(0,8)+'01':statsStart),end:btn?.dataset?.end||(day?new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7)),0)).toISOString().slice(0,10):statsEnd),transport:act==='lv-person-stats'?statsTransport:'all'});return true;
    }
    if(act==='lv-person-send'){
      if(btn.disabled)return true;
      btn.disabled=true;
      try{
        await post('/api/report/send/docx',{person_id:Number(btn.dataset.id),start:btn.dataset.start,end:btn.dataset.end,transport:btn.dataset.transport});
        notify(window.PWA.mode==='test'?'Документ готов — нажми «Сохранить / открыть»':'Файл отправлен тебе в Telegram');
      }finally{btn.disabled=false;}
      return true;
    }
    if(act==='lv-person-period'){
      const start=$('#lv-person-start').value,end=$('#lv-person-end').value;
      if(!start||!end||start>end)throw new Error('Проверь даты периода');
      traceView={...traceView,start,end};await renderTrace();return true;
    }

    if(act==='lv-stats-export'){
      if(!statsRendered||btn.disabled)return true;
      btn.disabled=true;
      try{await post('/api/report/send/docx',{stats_section:id,...statsRendered});notify(window.PWA.mode==='test'?'Документ готов — нажми «Сохранить / открыть»':'Файл отправлен тебе в Telegram');}
      finally{btn.disabled=false;}return true;
    }
    if(act==='lv-stats-send'){
      if(sendingSummary)return true;
      const {start,end,transport}=statsRendered||{start:statsStart,end:statsEnd,transport:statsTransport};
      if(!start||!end||start>end)throw new Error('Проверь даты периода');
      sendingSummary=true;btn.disabled=true;
      try{await post('/api/report/send/docx',{loader_summary:true,start,end,transport});notify(window.PWA.mode==='test'?'Ведомость готова — нажми «Сохранить / открыть»':'Ведомость отправлена тебе в Telegram');}
      finally{sendingSummary=false;btn.disabled=false;}
      return true;
    }
    if(act==='lv-step-day'){const date=new Date(overviewDate+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+Number(id));overviewDate=date.toISOString().slice(0,10);await renderOverview();return true;}
    if(act==='lv-load'){await showLoad(id);return true;}
    if(act==='lv-refresh'){await renderOverview();return true;}
    if(act==='lv-today'){overviewDate=today();await renderOverview();return true;}
    if(act==='lv-filter'){overviewFilter=id;await renderOverview();return true;}
    if(act==='lv-stats-refresh'){await renderStats();return true;}
    if(act==='lv-stats-preset'){
      statsEnd=today();const date=new Date(statsEnd+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-6);
      statsStart=id==='today'?statsEnd:id==='week'?date.toISOString().slice(0,10):statsEnd.slice(0,8)+'01';
      await renderStats();return true;
    }

    if(act==='lv-draft'){await post('/api/report/send/docx',{pending:true});notify(window.PWA.mode==='test'?'Документ готов — нажми «Сохранить / открыть»':'Файл отправлен тебе в Telegram');return true;}
    if(act==='lv-open'){state.tab='report';mode='pending';await renderReport();return true;}
    if(act==='lv-archive'){state.tab='report';mode='archive';await renderReport();return true;}
    if(act==='lv-mode'){mode=id;await renderReport();return true;}
    if(act==='lv-statement'){if(btn?.dataset.cancelled==='1')await openRevision(id);else await showStatement(id);return true;}
    if(act==='lv-revision-retry'){await openRevision(id);return true;}
    if(act==='lv-revision-without'){revisionInclude=false;await openRevision(id);return true;}
    if(act==='lv-resubmit'){
      if(busy||!revisionData)return true;
      const d=revisionData;
      if(!confirm('Повторно сдать ведомость № '+id+' на '+money(d.stats.total_cents)+'? Номер и дата сохранятся. Все суммы будут отмечены как оплаченные.'))return true;
      busy=true;btn.disabled=true;
      try{await post('/api/admin/statements/'+id+'/resubmit',{token:d.token,include_contractor:d.include_contractor});notify('Ведомость № '+id+' обновлена');await showStatement(id);}
      catch(e){notify(e.message);await openRevision(id);}
      finally{busy=false;btn.disabled=false;}return true;
    }
    if(act==='lv-export'){await downloadFile('/api/statements/'+id+'/export',`Наряд_№${id}.docx`);return true;}
    if(act==='lv-send'){await sendReport('docx',id);return true;}
    if(act==='lv-submit'){
      if(busy||!current)return true;
      if(!confirm('Сдать ведомость на '+money(current.stats.total_cents)+'? Эти начисления будут отмечены как оплаченные.'))return true;
      busy=true;btn.disabled=true;
      try{const r=await post('/api/statements',{token:current.token});notify('Ведомость № '+r.id+' сдана');await showStatement(r.id);}
      finally{busy=false;btn.disabled=false;}
      return true;
    }

    if(act==='load-report'){await loadReport();return true;}
    if(act==='send-report'){await sendReport(id);return true;}
    if(act==='download'){await downloadReport(id);return true;}
    if(act==='save-contractor-rate'){const input=$('#contractor-rate-'+id);await post('/api/contractor-rates',{product_id:Number(id),rate:input.value},'PUT');await reloadBoot();notify('Тариф наемника сохранён');await renderTariffs();return true;}
    if(act==='save-rates'){await saveRates(Number(id));return true;}
    if(act==='toggle-loader'){
      await post('/api/loaders/'+id,{active:!Number(btn.dataset.active)},'PATCH');
      notify('Список обновлён');await reloadBoot();await renderLoaders();return true;
    }
    if(act==='lv-add-loader'){loaderEditor();return true;}
    if(act==='rename-loader'){
      if(state.me.role==='manager'){loaderEditor(id,btn.dataset.name);return true;}
      const name=prompt('Имя грузчика:',btn.dataset.name);
      if(name&&name.trim()){await post('/api/loaders/'+id,{name:name.trim()},'PATCH');await reloadBoot();await renderLoaders();}
      return true;
    }
    if(act==='archive-product'){
      if(confirm('Отправить продукцию в архив? История погрузок сохранится.')){
        await post('/api/products/'+id+'/archive',{});await reloadBoot();await renderTariffs();
      }
      return true;
    }
    return false;
  }
  async function handleSubmit(form){
    if(form.id==='lv-loader-editor'){
      if(form.dataset.saving==='1'||!form.reportValidity())return true;
      const name=String(new FormData(form).get('name')||'').trim();
      if(!name){notify('Введи имя грузчика');return true;}
      const id=form.dataset.id,button=form.querySelector('button[type="submit"]');
      form.dataset.saving='1';button.disabled=true;
      try{await post('/api/loaders'+(id?'/'+id:''),{name},id?'PATCH':'POST');ctx.dismiss();await reloadBoot();await renderLoaders();notify(id?'Имя сохранено':'Грузчик добавлен');}
      finally{form.dataset.saving='0';button.disabled=false;}
      return true;
    }
    if(form.id==='loader-form'){
      const name=new FormData(form).get('name');await post('/api/loaders',{name});
      await reloadBoot();await renderLoaders();notify('Грузчик добавлен');return true;
    }
    if(form.id==='product-form'){
      const name=new FormData(form).get('name');await post('/api/products',{name});
      await reloadBoot();await renderTariffs();notify('Продукция добавлена');return true;
    }
    return false;
  }
  function handleChange(target){
    if(target.id==='lv-include-contractor'){revisionInclude=target.checked;revisionData=null;const submit=$('[data-act="lv-resubmit"]');if(submit)submit.disabled=true;openRevision(revisionId);return true;}
    if(target.id==='lv-date'){overviewDate=target.value||today();renderOverview();return true;}
    if(target.id==='lv-stats-start'){statsStart=target.value;return true;}
    if(target.id==='lv-stats-end'){statsEnd=target.value;return true;}
    if(target.id==='lv-stats-transport'){statsTransport=target.value;renderStats();return true;}

    if(target.id==='report-start'){state.reportStart=target.value;return true;}
    if(target.id==='report-end'){state.reportEnd=target.value;return true;}
    return false;
  }
  async function refreshLive(live){
    if(state.tab==='lev-detail')return renderTrace(live);
    if(state.tab==='lev-home')return detailId?showLoad(detailId,live):renderOverview(live);
    if(state.tab==='lev-stats')return renderStats(live);
    if(state.tab==='report'&&!busy)return revisionId?openRevision(revisionId,live):statementId?showStatement(statementId,live):renderReport(live);
  }
  function navigationView(){
    const view=structuredClone({mode,statementId,revisionId,revisionInclude,traceView,traceStack});
    const trace = view.traceView;
    view.key=state.tab==='lev-detail'?['trace',trace?.type,trace?.id,view.traceStack.length]:
      state.tab==='report'?(statementId||revisionId?['statement',Number(statementId||revisionId)]:['report',mode]):null;
    return view;
  }
  async function restoreNavigation(v){
    mode=v.mode;statementId=v.statementId;revisionId=v.revisionId;revisionInclude=v.revisionInclude;
    traceView=structuredClone(v.traceView);traceStack=structuredClone(v.traceStack);
    if(state.tab==='lev-detail')return renderTrace();
    if(state.tab==='report')return revisionId?openRevision(revisionId):statementId?showStatement(statementId):renderReport();
    if(state.tab==='lev-stats')return renderStats();
    return renderOverview();
  }
  return {navigationView,restoreNavigation,header,menu,openRevision,renderTrace,refreshLive,renderStats,renderOverview,renderReport,loadReport,sendReport,downloadReport,renderLoaders,renderTariffs,saveRates,handleClick,handleSubmit,handleChange};
};
