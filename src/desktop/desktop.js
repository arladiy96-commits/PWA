import {showLogin} from '../client/login.js';
import {names,number,money,day,sample,shares,ledger} from './demo.js';

const app=document.querySelector('#app'), dialog=document.querySelector('#dialog');
const demoKey='gruzcontrol-desktop-preview-v1', loginKey='gruzcontrol-demo-session';
const titles={journal:'Журнал погрузок',statements:'Ведомости',stats:'Статистика',people:'Табель'};
const view={tab:'journal',date:day(),month:day().slice(0,7),type:'Все',query:'',selected:null,statement:'',person:'',cell:'',statDay:''};
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
  try{loads=JSON.parse(sessionStorage.getItem(demoKey))||sample();}
  catch{message='Не удалось прочитать сохранённый пример.';loads=sample();}
  app.innerHTML=`<header><b class="logo">ГК</b><strong>ГрузКонтроль</strong><span class="sep"></span><span>Рабочий стол</span><div class="spacer"></div><small>Демо · кабинет Льва</small><button data-act="logout">Выйти</button></header>
  <div class="shell"><nav aria-label="Разделы"><small>Рабочее место</small>${Object.entries(titles).map(([key,name])=>button('tab',name,'data-id="'+key+'"')).join('')}<a href="../">Мобильный кабинет ↗</a></nav>
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
const usedTabs=['journal'];
function render(){
  if(!usedTabs.includes(view.tab))usedTabs.push(view.tab);
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.id===view.tab));
  document.querySelector('.tabs').innerHTML=usedTabs.map(k=>button('tab',titles[k],`data-id="${k}" class="${view.tab===k?'active':''}"`)).join('');
  const content={journal,statements,stats,people}[view.tab]();
  document.querySelector('#page').innerHTML=`<div class="heading"><h1>${titles[view.tab]}</h1>${view.tab==='journal'?button('new','＋ Добавить погрузку','class="primary"'):''}</div>${message?'<p role="status">'+safe(message)+'</p>':''}${content}`;
}
function journal(){
  const rows=loads.filter(r=>(r.date===view.date || view.date===day() && r.date<view.date && !r.done)
    &&(view.type==='Все'||(view.type==='Вагоны')===(r.type==='Вагон'))
    &&[label(r),r.buyer,r.product,...r.crew].join(' ').toLowerCase().includes(view.query.toLowerCase()));
  const selected=rows.find(r=>r.id===view.selected) || (view.selected===null?rows.find(r=>!r.done)||rows[0]:null);
  if(selected)view.selected=selected.id;
  const list=rows.map(r=>`<tr class="${r.id===selected?.id?'selected':''}" data-row="${r.id}"><td>${button('row',safe(label(r)),'data-id="'+r.id+'" class="link"')}${r.date<view.date?'<small class="late">С '+dateLabel(r.date)+'</small>':''}</td><td>${safe(r.buyer)}</td><td>${safe(r.product)}</td><td class="num">${number(r.weight)}</td><td title="${safe(r.crew.join(', '))}">${safe(r.crew[0]||'—')}${r.crew.length>1?' +'+(r.crew.length-1):''}</td><td>${badge(r)}</td></tr>`);
  return `<div class="tools"><input id="date" aria-label="Дата журнала" type="date" value="${view.date}"><select id="type" aria-label="Транспорт">${['Все','Вагоны','Машины'].map(x=>option(x,view.type,x==='Все'?'Весь транспорт':x)).join('')}</select><input id="search" type="search" placeholder="Найти вагон, покупателя, грузчика" aria-label="Поиск" value="${safe(view.query)}"></div>
  <div class="split"><article><div class="caption">Погрузки <b>${rows.length}</b></div>${list.length?table(['Транспорт','Покупатель','Продукция','Вес, т','Бригада','Статус'],list):empty('Погрузок по этому запросу нет.')}<div class="totals">По выборке <strong>${number(sum(rows,r=>r.weight))} т</strong></div></article><aside>${selected?inspector(selected):empty('Выбери погрузку в журнале.')}</aside></div>`;
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
        fund:type==='Вагон'?3000000:Math.round(weight*60000),contractor:type==='Вагон'?300000:0};
      saved=persist([...loads,row]);
      if(saved)Object.assign(view,{date:row.date,type:'Все',query:'',selected:row.id});
      break;
    }
  }
  dialog.close();render();
});
app.addEventListener('change',e=>{
  const el=e.target;
  if(!['date','month','type','statement'].includes(el.id)||!el.value&&el.id!=='statement')return;
  view[el.id]=el.value;
  if(el.id==='month'){view.cell='';view.statDay='';}
  if(el.id==='date'||el.id==='type')view.selected=null;
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
gate();
if('serviceWorker' in navigator)navigator.serviceWorker.register('../sw.js').catch(()=>{});
