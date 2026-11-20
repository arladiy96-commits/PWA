import {showLogin} from '../client/login.js';
import {names,number,money,day,sample,shares,ledger} from './demo.js';

const app=document.querySelector('#app'), dialog=document.querySelector('#dialog');
const demoKey='gruzcontrol-desktop-preview-v1', loginKey='gruzcontrol-demo-session';
import {initialRates,price,grouped,exportRows} from './office.js';
const rateKey='gruzcontrol-desktop-rates-v1';
let rates=initialRates;
import {comparison,totals} from './analysis.js';
const titles={dayCheck:'Сверка дня',compare:'Сравнение периодов',overview:'Обзор смены', reports:'Анализ погрузок',tariffs:'Тарифы',journal:'Журнал погрузок',statements:'Ведомости',stats:'Статистика',people:'Табель'};
const view={cashDate:day(),payee:'',aStart:day(-6),aEnd:day(),prod:'',vehicle:'',axis:'buyer',segment:'',side:'current',tab:'overview',queue:'overdue',statusFilter:'Все',from:day(-29),to:day(),dimension:'buyer',group:'',reportType:'Все',date:day(),month:day().slice(0,7),type:'Все',query:'',selected:null,statement:'',person:'',cell:'',statDay:''};
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sum=(rows,f)=>rows.reduce((v,r)=>v+f(r),0);
const label=r=>r.type+(r.ref?' № '+r.ref:'');
const status=r=>r.done?'Загружен':r.crew.length?'В работе':'Без бригады';
const dateLabel=d=>new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
const button=(action,title,extra='')=>`<button type="button" data-act="${action}" ${extra}>${title}</button>`;
const badge=r=>`<span class="badge ${r.done?'done':r.crew.length?'work':'wait'}">${status(r)}</span>`;
const empty=msg=>`<p class="empty">${msg}</p>`;
const option=(v,selected,title=v)=>`<option value="${safe(v)}" ${v===selected?'selected':''}>${safe(title)}</option>`;
const table=(heads,rows)=>`<div class="scroll"><table><thead><tr>${heads.map(h=>'<th>'+h+'</th>').join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const line=(a,b)=>`<div class="line"><span>${safe(a)}</span><strong>${safe(b)}</strong></div>`;
let loads=[], message='';
function persist(next){
  try{sessionStorage.setItem(demoKey,JSON.stringify(next));loads=next;return true;}
  catch{message='Не удалось сохранить изменения в этой вкладке.';return false;}
}
function update(id,changes){return persist(loads.map(r=>r.id===id?{...r,...changes}:r));}
function openDialog(html){
  dialog.innerHTML=html;
  if(!dialog.open)dialog.showModal();
}
function openDesk(){
  try{rates=JSON.parse(sessionStorage.getItem(rateKey))||initialRates;}catch{rates=initialRates;}
  try{loads=JSON.parse(sessionStorage.getItem(demoKey))||sample();}
  catch{message='Не удалось прочитать сохранённый пример.';loads=sample();}
  app.innerHTML=`<header><b class="logo">ГК</b><strong>ГрузКонтроль</strong><span class="sep"></span><span>Рабочий стол</span><div class="spacer"></div><small>Демо · кабинет Льва</small><button data-act="logout">Выйти</button></header>
  <div class="shell"><nav aria-label="Разделы">${[['Смена','overview','journal','dayCheck','statements'],['Аналитика','compare','reports','stats','people'],['Настройки','tariffs']].map(([group,...keys])=>'<small>'+group+'</small>'+keys.map(key=>button('tab',titles[key],'data-id="'+key+'"')).join('')).join('')}<a href="../">Мобильный кабинет ↗</a></nav>
  <div class="workspace"><div class="tabs"></div><section id="page"></section><footer><span>Демоданные этой вкладки</span><span>Ctrl + K · Поиск в журнале</span></footer></div></div>`;
  render();
}
function gate(){
  if(['manager','admin'].includes(localStorage.getItem(loginKey)))return openDesk();
  if(localStorage.getItem(loginKey)){app.innerHTML='<div class="gate"><h1>Рабочий стол Льва</h1><p>Для этой роли доступен мобильный кабинет.</p><a href="../">Открыть кабинет</a></div>';return;}
  showLogin(app,{demo:{accounts:[{label:'Лев',login:'lev'}],password:'demo'},signIn({login,password}){
    if(login.toLowerCase()!=='lev'||password!=='demo')return 401;
    localStorage.setItem(loginKey,'manager');openDesk();
  }});
}
const usedTabs=['overview'];
function render(){
  if(!usedTabs.includes(view.tab))usedTabs.push(view.tab);
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.id===view.tab));
  document.querySelector('.tabs').innerHTML=usedTabs.map(k=>button('tab',titles[k],`data-id="${k}" class="${view.tab===k?'active':''}"`)).join('');
  const content={dayCheck,compare,overview,journal,statements,stats,people,reports,tariffs}[view.tab]();
  document.querySelector('#page').innerHTML=`<div class="heading"><h1>${titles[view.tab]}</h1>${view.tab==='journal'?button('new','＋ Добавить погрузку','class="primary"'):''}</div>${message?'<p role="status">'+safe(message)+'</p>':''}${content}`;
}
function journal(){
  const rows=loads.filter(r=>(r.date===view.date || view.date===day() && r.date<view.date && !r.done)
    &&(view.type==='Все'||(view.type==='Вагоны')===(r.type==='Вагон'))
    &&(view.statusFilter==='Все'||status(r)===view.statusFilter)
    &&[label(r),r.buyer,r.product,...r.crew].join(' ').toLowerCase().includes(view.query.toLowerCase()));
  const selected=rows.find(r=>r.id===view.selected) || (view.selected===null?rows.find(r=>!r.done)||rows[0]:null);
  if(selected)view.selected=selected.id;
  const list=rows.map(r=>`<tr class="${r.id===selected?.id?'selected':''}" data-row="${r.id}"><td>${button('row',safe(label(r)),'data-id="'+r.id+'" class="link"')}${r.date<view.date?'<small class="late">С '+dateLabel(r.date)+'</small>':''}</td><td>${safe(r.buyer)}</td><td>${safe(r.product)}</td><td class="num">${number(r.weight)}</td><td title="${safe(r.crew.join(', '))}">${safe(r.crew[0]||'—')}${r.crew.length>1?' +'+(r.crew.length-1):''}</td><td>${badge(r)}</td></tr>`);
  return `<div class="tools"><input id="date" aria-label="Дата журнала" type="date" value="${view.date}"><select id="type" aria-label="Транспорт">${['Все','Вагоны','Машины'].map(x=>option(x,view.type,x==='Все'?'Весь транспорт':x)).join('')}</select><select id="statusFilter" aria-label="Статус погрузки">${['Все','Без бригады','В работе','Загружен'].map(x=>option(x,view.statusFilter,x==='Все'?'Все статусы':x)).join('')}</select><input id="search" type="search" placeholder="Найти вагон, покупателя, грузчика" aria-label="Поиск" value="${safe(view.query)}"></div>
  <div class="split"><article><div class="caption">Погрузки <b>${rows.length}</b></div>${list.length?table(['Транспорт','Покупатель','Продукция','Вес, т','Бригада','Статус'],list):empty('Погрузок по этому запросу нет.')}<div class="totals">По выборке <strong>${number(sum(rows,r=>r.weight))} т</strong></div></article><aside>${selected?inspector(selected):empty('Выбери погрузку в журнале.')}</aside></div>
  <article class="journal-summary"><div class="caption">Итоги по транспорту · текущая выборка</div>${table(['Транспорт','Погрузок','Завершено','Загружено, т','Начислено'],['Вагон','Фура','КамАЗ'].map(type=>{
    const all=rows.filter(r=>r.type===type), done=all.filter(r=>r.done);
    return '<tr><td>'+type+'</td><td>'+all.length+'</td><td>'+done.length+'</td><td>'+number(sum(done,r=>r.weight))+'</td><td>'+money(sum(done,r=>r.fund+r.contractor))+'</td></tr>';
  }))}</article>`;
}
function openRow(id){
  const r=loads.find(item=>item.id===Number(id));
  if(r)Object.assign(view,{tab:'journal',date:r.date,type:'Все',query:'',selected:r.id});
}
function drillRow(r){
  return button('open-row',safe(label(r)),`data-id="${r.id}" class="link"`);
}
function overview(){
  const today=day(), current=loads.filter(r=>r.date===today);
  const overdue=loads.filter(r=>!r.done&&r.date<today);
  const waiting=loads.filter(r=>!r.done&&!r.crew.length&&r.date<=today);
  const active=current.filter(r=>!r.done&&r.crew.length);
  const pending=loads.filter(r=>r.done&&!r.statement);
  const groups={overdue,waiting,active};
  const queue=groups[view.queue];
  const cards=[[current.length+overdue.length,'Сегодня и незавершённые','journal'],[number(sum(current.filter(r=>r.done),r=>r.weight))+' т','Загружено сегодня','finished'],[money(sum(pending,r=>r.fund+r.contractor)),'К сдаче за все дни','statements']];
  const teams=grouped(current.filter(r=>r.crew.length),'crew');
  return `<div class="summary">${cards.map(([v,t,a])=>button('metric','<span>'+t+'</span><strong>'+v+'</strong>',`data-id="${a}"`)).join('')}</div>
  <div class="board"><article><div class="caption">Контроль погрузок</div><div class="segments">${[['overdue','С прошлых дней'],['waiting','Без бригады'],['active','В работе сегодня']].map(([id,n])=>button('queue',n+' · '+groups[id].length,`data-id="${id}" aria-pressed="${view.queue===id}"`)).join('')}</div>${queue.length?table(['Дата','Погрузка','Покупатель','Вес, т'],queue.map(r=>`<tr><td>${dateLabel(r.date)}</td><td>${drillRow(r)}</td><td>${safe(r.buyer)}</td><td>${number(r.weight)}</td></tr>`)):empty('Таких погрузок сейчас нет.')}</article>
  <article><div class="caption">Бригады сегодня</div>${teams.length?table(['Состав','В работе','Загружено'],teams.map(g=>`<tr><td>${safe(g.key)}</td><td>${g.rows.filter(r=>!r.done).length}</td><td>${g.rows.filter(r=>r.done).length}</td></tr>`)):empty('Бригады ещё не назначены.')}</article></div>
  <div class="desk-links">${button('tab','Сверить начисления за день →','data-id="dayCheck"')}${button('tab','Сравнить затраты за периоды →','data-id="compare"')}</div><article><div class="caption">Начисления к ближайшей сдаче ${button('tab','Открыть ведомость →','data-id="statements"')}</div><div class="balances">${[...ledger(pending)].map(([n,v])=>line(n,money(v))).join('')||empty('Всё сдано.')}</div></article>`;
}
function reportRows(){
  return loads.filter(r=>r.done&&r.date>=view.from&&r.date<=view.to&&(view.reportType==='Все'||(r.type==='Вагон')===(view.reportType==='Вагоны')));
}
function reports(){
  const groups=grouped(reportRows(),view.dimension);
  const g=groups.find(x=>x.key===view.group)||groups[0];
  const selected=g?.rows||[];
  return `<div class="tools"><label>С <input id="from" type="date" value="${view.from}"></label><label>По <input id="to" type="date" value="${view.to}"></label><select id="reportType" aria-label="Транспорт отчёта">${['Все','Вагоны','Машины'].map(x=>option(x,view.reportType)).join('')}</select><select id="dimension" aria-label="Группировать">${[['buyer','По покупателям'],['crew','По составу бригады'],['product','По продукции'],['type','По транспорту']].map(([v,n])=>option(v,view.dimension,n)).join('')}</select>${button('export','Скачать CSV',groups.length?'':'disabled')}${button('print','Печать')}</div>
  <article><div class="caption">Завершённые погрузки · ${dateLabel(view.from)} — ${dateLabel(view.to)}</div>${table(['Группа','Погрузок','Тонн','Начислено','Затраты на тонну'],groups.map(x=>`<tr class="${x===g?'selected':''}"><td>${button('group',safe(x.key),'class="link" data-name="'+safe(x.key)+'"')}</td><td>${x.rows.length}</td><td>${number(x.tonnes)}</td><td>${money(x.cost)}</td><td>${money(Math.round(x.cost/x.tonnes))}</td></tr>`))}${g?'':empty('За период нет завершённых погрузок.')}</article>
  ${g?`<article><div class="caption">Расшифровка · ${safe(g.key)}</div>${table(['Дата','Погрузка','Покупатель','Бригада','Наемник на тупике','Состояние расчёта'],selected.map(r=>`<tr><td>${dateLabel(r.date)}</td><td>${drillRow(r)}</td><td>${safe(r.buyer)}</td><td>${money(r.fund)}</td><td>${money(r.contractor)}</td><td>${r.statement?'Сдано':'К сдаче'}</td></tr>`))}</article>`:''}`;
}
function tariffs(){
  return `<article><div class="caption">Ставки для новых демопогрузок</div>${table(['Продукция','Вагон, ₸','Машина до 20 т, ₸/т','От 20 т, ₸/т','Наемник, ₸/вагон',''],rates.map((r,i)=>`<tr><td>${r.product}</td>${['wagon','small','large','contractor'].map(k=>'<td>'+number(r[k])+'</td>').join('')}<td>${button('rate','Изменить','data-id="'+i+'"')}</td></tr>`))}</article>
  <article><div class="caption">Проверить расчёт</div><form id="estimate"><label>Продукция<select name="product"><option>Мука</option><option>Отруби</option></select></label><label>Транспорт<select name="type"><option>Вагон</option><option>Фура</option><option>КамАЗ</option></select></label><label>Вес, т<input name="weight" type="number" min=".01" max="1000" step=".01" value="68.5" required></label><label>Человек<input name="count" type="number" min="1" max="100" step="1" value="3" required></label><button class="primary">Рассчитать</button></form><div id="estimate-result" aria-live="polite"></div></article>`;
}

function dayCheck(){
  const rows=loads.filter(r=>r.date===view.cashDate);
  const done=rows.filter(r=>r.done), paid=done.filter(r=>r.statement), pending=done.filter(r=>!r.statement);
  const accounts=ledger(done), paidAccounts=ledger(paid), pendingAccounts=ledger(pending);
  const chosen=accounts.has(view.payee)?view.payee:'';
  const detail=chosen?done.filter(r=>ledger([r]).has(chosen)):done;
  return `<div class="tools"><label>Дата погрузки <input type="date" id="cashDate" value="${view.cashDate}"></label>${button('print','Печать сверки')}</div><div class="metrics">${line('Начислено',money(totals(done).cost))}${line('В сданных ведомостях',money(totals(paid).cost))}${line('Ещё к сдаче',money(totals(pending).cost))}</div><div class="reconcile"><article><div class="caption">Расчёты по людям</div>${table(['Получатель','Начислено','Сдано','К сдаче'],[...accounts].map(([n,v])=>`<tr class="${chosen===n?'selected':''}"><td>${button('payee',safe(n),'class="link" data-name="'+safe(n)+'"')}</td><td>${money(v)}</td><td>${money(paidAccounts.get(n)||0)}</td><td>${money(pendingAccounts.get(n)||0)}</td></tr>`))}${done.length?'':empty('За выбранный день начислений нет.')}</article><article><div class="caption">${chosen?safe(chosen):'Все начисления за день'} ${chosen?button('payee','Все','data-name=""'):''}</div>${table(['Погрузка','Сумма','Ведомость'],detail.map(r=>`<tr><td>${drillRow(r)}</td><td>${money(chosen?ledger([r]).get(chosen):r.fund+r.contractor)}</td><td>${button('document',safe(r.statement||'К сдаче'),'class="link" data-name="'+safe(r.statement||'')+'"')}</td></tr>`))}</article></div>
  <article class="journal-summary"><div class="caption">Ещё без начислений · ${rows.length-done.length}</div>${rows.length===done.length?empty('Все погрузки дня завершены.'):table(['Погрузка','Покупатель','Вес, т','Статус'],rows.filter(r=>!r.done).map(r=>`<tr><td>${drillRow(r)}</td><td>${safe(r.buyer)}</td><td>${number(r.weight)}</td><td>${badge(r)}</td></tr>`))}</article>`;
}
function compare(){
  const d=comparison(loads,view.aStart,view.aEnd,view.axis,view.prod,view.vehicle);
  const g=d.groups.find(x=>x.name===view.segment)||d.groups[0];
  const signed=v=>(v>0?'+':'')+money(v);
  const rate=t=>t.weight?money(Math.round(t.cost/t.weight)):'—';
  const side=view.side==='previous'?'previous':'current';
  const periods=['Текущий','Предыдущий'];
  return `<div class="tools"><label>С <input type="date" id="aStart" value="${view.aStart}"></label><label>По <input type="date" id="aEnd" value="${view.aEnd}"></label><select aria-label="Продукция" id="prod">${['','Мука','Отруби'].map(v=>option(v,view.prod,v||'Вся продукция')).join('')}</select><select aria-label="Транспорт" id="vehicle">${['','Вагон','Фура','КамАЗ'].map(v=>option(v,view.vehicle,v||'Весь транспорт')).join('')}</select><select id="axis" aria-label="Разрез сравнения">${[['buyer','По покупателям'],['type','По транспорту'],['product','По продукции'],['crew','По бригадам']].map(([v,n])=>option(v,view.axis,n)).join('')}</select></div>
  <article><div class="caption">Сравнение с ${dateLabel(d.before)} — ${dateLabel(d.until)}</div>${table(['Период','Погрузок','Тонн','Фонд бригад','Наемник','Всего','За тонну'],[d.now,d.prior].map((t,i)=>`<tr><td>${periods[i]}</td><td>${t.count}</td><td>${number(t.weight)}</td><td>${money(t.fund)}</td><td>${money(t.contractor)}</td><td><b>${money(t.cost)}</b></td><td>${rate(t)}</td></tr>`))}</article>
  <div class="analysis-grid"><article><div class="caption">Изменение затрат <b>${signed(d.now.cost-d.prior.cost)}</b></div>${table(['Группа','Предыдущий','Текущий','Разница'],d.groups.map(x=>`<tr class="${g===x?'selected':''}"><td>${button('segment',safe(x.name),'class="link" data-name="'+safe(x.name)+'"')}</td><td>${money(x.b.cost)}</td><td>${money(x.a.cost)}</td><td>${signed(x.delta)}</td></tr>`))}${g?'':empty('За оба периода подходящих погрузок нет.')}</article><article><div class="caption">${safe(g?.name||'Погрузки группы')}</div><div class="segments">${['current','previous'].map((v,i)=>button('side',periods[i],'data-id="'+v+'" aria-pressed="'+(side===v)+'"')).join('')}</div>${g?.[side].length?table(['Дата','Погрузка','Тонн','Затраты'],g[side].map(r=>`<tr><td>${dateLabel(r.date)}</td><td>${drillRow(r)}</td><td>${number(r.weight)}</td><td>${money(r.fund+r.contractor)}</td></tr>`)):empty('В этом периоде погрузок группы нет.')}</article></div>`;
}

function inspector(r){
  return `<div class="caption">Карточка погрузки ${button('close','×','aria-label="Закрыть карточку"')}</div><h2>${safe(label(r))}</h2>${badge(r)}${line('Дата',dateLabel(r.date))}${line('Покупатель',r.buyer)}${line('Продукция',r.product)}${line('Тоннаж',number(r.weight)+' т')}<h3>Бригада</h3>${r.crew.map(n=>line(n,r.done?money(new Map(shares(r)).get(n)):'')).join('')||empty('Пока не назначена.')}
  ${r.done?line('Фонд бригады',money(r.fund))+(r.contractor?line('Наемник на тупике',money(r.contractor)):''):button('crew','Изменить бригаду')+button('finish','Завершить погрузку',`class="primary" ${r.crew.length?'':'disabled'}`)}`;
}
function statements(){
  const ids=[...new Set(loads.map(r=>r.statement).filter(Boolean))].reverse();
  const rows=loads.filter(r=>r.done&&(r.statement||'')===view.statement);
  const amounts=ledger(rows), total=sum([...amounts.values()],v=>v);
  return `<div class="tools"><select id="statement" aria-label="Ведомость">${option('',view.statement,'К сдаче')}${ids.map(id=>option(id,view.statement,'Сдана · '+id)).join('')}</select></div><div class="split"><article><div class="caption">Состав ведомости <b>${rows.length}</b></div>${table(['Дата','Погрузка','Покупатель','Фонд бригады'],rows.map(r=>`<tr class="${view.person&&(r.crew.includes(view.person)||view.person==='Наемник на тупике'&&r.contractor)?'selected':''}"><td>${dateLabel(r.date)}</td><td>${safe(label(r))}</td><td>${safe(r.buyer)}</td><td>${money(r.fund)}</td></tr>`))}${rows.length?'':empty('Все начисления сданы.')}</article><aside><div class="caption">Начисления</div>${[...amounts].map(([n,v])=>button('person',safe(n)+'<b>'+money(v)+'</b>',`class="pay ${view.person===n?'active':''}" data-name="${safe(n)}"`)).join('')}${line('Итого',money(total))}${!view.statement&&rows.length?button('submit','Сдать ведомость','class="primary"'):''}</aside></div>`;
}
function monthTools(){return `<div class="tools"><label>Месяц <input type="month" id="month" value="${view.month}"></label></div>`;}
function stats(){
  const rows=loads.filter(r=>r.date.startsWith(view.month)&&r.done);
  const days=[...new Set(rows.map(r=>r.date))].sort();
  const volume=d=>sum(rows.filter(r=>r.date===d),r=>r.weight);
  const peak=Math.max(1,...days.map(volume));
  const selected=rows.filter(r=>!view.statDay||r.date===view.statDay);
  return monthTools()+`<div class="metrics">${line('Отгружено',number(sum(rows,r=>r.weight))+' т')}${line('Погрузок',rows.length)}${line('Начислено',money(sum(rows,r=>r.fund+r.contractor)))}</div><div class="split"><article><div class="caption">Тоннаж по дням</div><div class="chart">${days.map(d=>button('day',`<strong>${number(volume(d))}</strong><i style="height:${Math.round(volume(d)/peak*100)}px"></i><small>${dateLabel(d)}</small>`,`class="bar ${view.statDay===d?'active':''}" data-date="${d}"`)).join('')||empty('Нет завершённых погрузок.')}</div><div class="caption">По продукции · ${view.statDay?dateLabel(view.statDay):'за месяц'}</div>${table(['Продукция','Погрузок','Тонн','Начислено'],['Мука','Отруби'].map(p=>{const part=selected.filter(r=>r.product===p);return '<tr><td>'+p+'</td><td>'+part.length+'</td><td>'+number(sum(part,r=>r.weight))+'</td><td>'+money(sum(part,r=>r.fund+r.contractor))+'</td></tr>'}))}</article><aside><div class="caption">Начисления · ${view.statDay?dateLabel(view.statDay):'за месяц'}</div>${[...ledger(selected)].map(([n,v])=>line(n,money(v))).join('')||empty('Начислений нет.')}</aside></div>`;
}
function people(){
  const rows=loads.filter(r=>r.done&&r.date.startsWith(view.month));
  const days=[...new Set(rows.map(r=>r.date))].sort();
  const values=new Map(days.map(d=>[d,ledger(rows.filter(r=>r.date===d))]));
  const data=names.map(n=>`<tr><td>${n}</td>${days.map(d=>`<td>${button('cell',money(values.get(d).get(n)||0),`data-name="${n}" data-date="${d}" class="link ${view.cell===d&&view.person===n?'active':''}"`)}</td>`).join('')}<td><strong>${money(sum(days,d=>values.get(d).get(n)||0))}</strong></td></tr>`);
  return monthTools()+`<article>${table(['Грузчик',...days.map(dateLabel),'За месяц'],data)}</article><article><div class="caption">${view.cell?safe(view.person)+' · '+dateLabel(view.cell):'Работы за день'}</div>${view.cell?rows.filter(r=>r.date===view.cell&&r.crew.includes(view.person)).map(r=>line(label(r)+' · '+r.buyer,money(new Map(shares(r)).get(view.person)))).join('')||empty('Погрузок нет.'):empty('Выбери сумму в ячейке табеля.')}</article>`;
}
const checks=crew=>names.map(n=>`<label class="check"><input type="checkbox" name="crew" value="${n}" ${crew.includes(n)?'checked':''}>${n}</label>`).join('');
function form(action,title,fields,ok){
  openDialog(`<form data-action="${action}"><h2>${title}</h2>${fields}<div class="actions">${button('cancel','Отмена')}<button class="primary">${ok}</button></div></form>`);
}
document.addEventListener('click',event=>{
  const b=event.target.closest('[data-act]'), tr=event.target.closest('[data-row]');
  if(!b&&!tr)return;
  const r=loads.find(x=>x.id===view.selected);
  message='';
  switch(b?.dataset.act||'row'){
    case 'payee':view.payee=view.payee===b.dataset.name?'':b.dataset.name;break;
    case 'document':view.tab='statements';view.statement=b.dataset.name;view.person='';break;
    case 'segment':view.segment=b.dataset.name;break;
    case 'side':view.side=b.dataset.id;break;
    case 'metric':
      if(b.dataset.id==='statements'){view.tab='statements';view.statement='';}
      else Object.assign(view,{tab:'journal',date:day(),query:'',type:'Все',statusFilter:b.dataset.id==='finished'?'Загружен':'Все',selected:null});
      break;
    case 'queue':view.queue=b.dataset.id;break;
    case 'open-row':view.statusFilter='Все';openRow(b.dataset.id);break;
    case 'group':view.group=b.dataset.name;break;
    case 'print':window.print();return;
    case 'export':{
      const rows=reportRows();
      const groups=grouped(rows,view.dimension);
      exportRows('Анализ погрузок '+view.from+' — '+view.to,['Группа','Дата','Погрузка','Покупатель','Продукция','Тонн','Фонд, ₸','Наемник, ₸','Всего, ₸'],groups.flatMap(g=>g.rows.map(r=>[g.key,r.date,label(r),r.buyer,r.product,number(r.weight),number(r.fund/100),number(r.contractor/100),number((r.fund+r.contractor)/100)])));
      return;
    }
    case 'rate':{
      const idx=Number(b.dataset.id), rate=rates[idx];
      form('rate','Тарифы · '+rate.product,'<input name="idx" type="hidden" value="'+idx+'"><div class="fields">'+[['wagon','За вагон, ₸'],['small','До 20 т, ₸/т'],['large','От 20 т, ₸/т'],['contractor','Наемник, ₸/вагон']].map(([key,title])=>'<label>'+title+'<input type="number" name="'+key+'" min="0" max="10000000" step=".01" required value="'+rate[key]+'"></label>').join('')+'</div>','Сохранить');
      return;
    }
    case 'tab':view.tab=b.dataset.id;break;
    case 'row':view.selected=Number(b?.dataset.id||tr.dataset.row);break;
    case 'close':view.selected=-1;break;
    case 'logout':localStorage.removeItem(loginKey);location.reload();return;
    case 'person':view.person=view.person===b.dataset.name?'':b.dataset.name;view.cell='';break;
    case 'cell':view.person=b.dataset.name;view.cell=b.dataset.date;break;
    case 'day':view.statDay=view.statDay===b.dataset.date?'':b.dataset.date;break;
    case 'crew':form('crew','Бригада · '+safe(label(r)),checks(r.crew),'Сохранить');return;
    case 'finish':form('finish','Завершить погрузку?',line('Погрузка',label(r))+line('Бригада',r.crew.join(', ')),'Завершить');return;
    case 'submit':form('submit','Сдать ведомость?',line('Итого',money(sum([...ledger(loads.filter(r=>!r.statement)).values()],v=>v))),'Сдать');return;
    case 'new':form('new','Новая погрузка',`<div class="fields"><label>Транспорт<select name="type"><option>Вагон</option><option>Фура</option><option>КамАЗ</option></select></label><label id="reference">Номер вагона<input name="ref" maxlength="30" required></label><label>Покупатель<input name="buyer" maxlength="150" required></label><label>Продукция<select name="product"><option>Мука</option><option>Отруби</option></select></label><label>Вес, т<input name="weight" inputmode="decimal" pattern="[0-9]+([.,][0-9]+)?" required></label><label>Дата<input name="date" type="date" value="${view.date}" required></label></div><h3>Бригада</h3>${checks([])}`,'Добавить');return;
    case 'cancel':dialog.close();return;
    default:return;
  }
  render();
});
dialog.addEventListener('change',e=>{
  if(e.target.name==='type'){
    const wagon=e.target.value==='Вагон';
    dialog.querySelector('#reference').hidden=!wagon;
    dialog.querySelector('[name=ref]').required=wagon;
  }
});
dialog.addEventListener('submit',e=>{
  e.preventDefault();
  const f=e.target, data=new FormData(f), crew=data.getAll('crew');
  let saved=false;
  switch(f.dataset.action){
    case 'rate':{
      const idx=Number(data.get('idx')), next=rates.map(r=>({...r}));
      for(const k of ['wagon','small','large','contractor'])next[idx][k]=Number(data.get(k));
      try{sessionStorage.setItem(rateKey,JSON.stringify(next));rates=next;message='Тариф сохранён для новых погрузок.';}
      catch{message='Не удалось сохранить тариф.';}
      break;
    }
    case 'crew':saved=update(view.selected,{crew});break;
    case 'finish':saved=update(view.selected,{done:true});break;
    case 'submit':{
      let i=1;const prefix=day()+' · № ';
      while(loads.some(r=>r.statement===prefix+i))i++;
      const id=prefix+i;
      saved=persist(loads.map(r=>r.done&&!r.statement?{...r,statement:id}:r));
      if(saved)view.statement=id;
      break;
    }
    case 'new':{
      const type=data.get('type'),weight=Number(data.get('weight').replace(',','.'));
      const buyer=data.get('buyer').trim(),ref=type==='Вагон'?data.get('ref').trim():'';
      if(!buyer||type==='Вагон'&&!ref||!Number.isFinite(weight)||weight<=0||weight>1000){
        const field=f.elements[!buyer?'buyer':type==='Вагон'&&!ref?'ref':'weight'];
        field.setCustomValidity('Проверь значение');field.reportValidity();field.setCustomValidity('');return;
      }
      const row={id:Math.max(0,...loads.map(r=>r.id))+1,type,weight,ref,buyer,product:data.get('product'),crew,date:data.get('date'),done:false,statement:null,
        ...price(rates,data.get('product'),type,weight)};
      saved=persist([...loads,row]);
      if(saved)Object.assign(view,{date:row.date,type:'Все',query:'',statusFilter:'Все',selected:row.id});
      break;
    }
  }
  dialog.close();render();
});
app.addEventListener('change',e=>{
  const el=e.target;
  if(!['date','month','type','statement','from','to','dimension','reportType','statusFilter','cashDate','aStart','aEnd','prod','vehicle','axis'].includes(el.id)||!el.value&&!['statement','prod','vehicle'].includes(el.id))return;
  if(el.id==='from'&&el.value>view.to)view.to=el.value;
  if(el.id==='to'&&el.value<view.from)view.from=el.value;
  if(el.id==='aStart'&&el.value>view.aEnd)view.aEnd=el.value;
  if(el.id==='aEnd'&&el.value<view.aStart)view.aStart=el.value;
  view[el.id]=el.value;
  if(el.id==='month'){view.cell='';view.statDay='';}
  if(el.id==='date'||el.id==='type'||el.id==='statusFilter')view.selected=null;
  render();
});
app.addEventListener('input',e=>{
  if(e.target.id!=='search')return;
  const caret=e.target.selectionStart;
  view.query=e.target.value;view.selected=null;render();
  const input=document.getElementById('search');input.focus();input.setSelectionRange(caret,caret);
});
document.addEventListener('keydown',e=>{
  if(dialog.open||!document.querySelector('.workspace'))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
    e.preventDefault();view.tab='journal';render();document.getElementById('search').select();
  }else if(e.key==='Escape'&&view.tab==='journal'){view.selected=-1;render();}
});
app.addEventListener('submit',e=>{
  if(e.target.id!=='estimate')return;
  e.preventDefault();
  const f=new FormData(e.target), count=Number(f.get('count'));
  const {fund,contractor}=price(rates,f.get('product'),f.get('type'),Number(f.get('weight')));
  document.querySelector('#estimate-result').innerHTML=line('Фонд бригады',money(fund))+line('На человека в среднем',money(Math.round(fund/count)))+line('Наемник на тупике',money(contractor))+line('Итого',money(fund+contractor));
});
gate();
if('serviceWorker' in navigator)navigator.serviceWorker.register('../sw.js').catch(()=>{});
