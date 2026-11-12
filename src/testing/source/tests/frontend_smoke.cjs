/* Offline smoke test for the four independently loaded role screens.
   Run: node tests/frontend_smoke.cjs */
const fs=require('fs');
const vm=require('vm');
const path=require('path');
const assert=require('assert');
const ROOT=path.join(__dirname,'..','static');

async function test(role,missing){
  function fakeEl(){
    const classes=new Set();
    return {
      innerHTML:'',textContent:'',scrollTop:0,value:'',dataset:{},style:{setProperty(){},removeProperty(){}},
      classList:{add(...xs){xs.forEach(x=>classes.add(x));},remove(...xs){xs.forEach(x=>classes.delete(x));},toggle(x,on){on?classes.add(x):classes.delete(x);},contains(x){return classes.has(x);}},
      setAttribute(){},getAttribute(){},setSelectionRange(){},addEventListener(){},querySelector(){return fakeEl();}
    };
  }
  const els=new Map();const events={};
  const el=s=>{if(!els.has(s))els.set(s,fakeEl());return els.get(s);};
  const document={
    querySelector:el,documentElement:fakeEl(),
    addEventListener(name,fn){(events[name]??=[]).push(fn)},visibilityState:'visible'
  };
  const window={innerHeight:850,visualViewport:null,addEventListener(){},confirm(){return true},Telegram:{WebApp:{initData:'test-signed-init-data',ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},disableVerticalSwipes(){},requestFullscreen(){},onEvent(){},viewportStableHeight:844}}};
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const loads=[{id:1,transport:'wagon',reference:'12345678',product_id:1,product_name:'Мука',tonnes:'68.5',load_date:day,status:'planned',crew_count:0,buyer:'',total_cents:0}];
  const handle={
    '/api/me':{user:{name:'Тест',role,state:'active'},today:day},
    '/api/overdue-loads':[],
    '/api/bootstrap':{products:[{id:1,name:'Мука',active:1}],loaders:[],tariffs:[]},
    '/api/statements':[],
    '/api/settlement-overview':{pending:{stats:{total_cents:0},loads:[],by_loader:[],details:[]},unfinished:[]},
    '/api/statements/pending':{stats:{total_cents:0},by_loader:[],details:[]},
    '/api/report':{details:[],stats:{wagons:0,trucks:0,tonnes:'0',total_cents:0},by_loader:[]},
    '/api/users':[{tg_id:111,name:'Админ',role:'admin',state:'active',username:''}],
    '/api/audit':[],
    '/api/loaders':[],
    '/api/products':[{id:1,name:'Мука',active:1}]
  };
  const errors=[];
  const fetched=[];
  const context=vm.createContext({
    document,window,URLSearchParams,FormData,Intl,Date,console:{...console,error:(...xs)=>errors.push(xs.join(' '))},
    location:{search:'',reload(){}},setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},
    requestAnimationFrame:fn=>fn(),cancelAnimationFrame(){},
    fetch:async url=>{
      fetched.push(url);
      const key=url.split('?')[0];
      const month=new URLSearchParams(url.split('?')[1]||'').get('month')||day.slice(0,7);
      const obj=key==='/api/loads'?loads:key==='/api/wagon-journal'?{
        month,total:4,loaded:3,remaining:1,progress:0,tonnes_loaded:'200.125',
        days:[{date:month+'-02',total:4,loaded:3,remaining:1,progress:0,tonnes_loaded:'200.125'}]
      }:handle[key];
      if(obj===undefined)throw Error('Unexpected API: '+url);
      return {ok:true,json:async()=>obj};
    }
  });
  for(const name of ['maxim','olesya','lev','admin']){
    if(name!==missing)vm.runInContext(fs.readFileSync(path.join(ROOT,'roles',name+'.js'),'utf8'),context,{filename:name+'.js'});
  }
  vm.runInContext(fs.readFileSync(path.join(ROOT,'app.js'),'utf8'),context,{filename:'app.js'});
  await new Promise(r=>setTimeout(r,60));
  const html=el('#app').innerHTML;
  assert(!html.includes('Ошибка подключения'),html.slice(0,500));
  assert(!html.includes('Подключаемся к серверу'),role+' remained loading');
  assert(html.includes(role==='wagon'?'maxim-view':role==='manager'?'ГрузКонтроль':role==='storekeeper'?'Склад':'Погрузки'),role+' missing screen');
  if(role==='wagon'){
    const nav={dataset:{act:'nav',id:'wagon-history'}};
    await events.click[0]({target:{closest:()=>nav}});
    await new Promise(r=>setTimeout(r,30));
    let output=el('#app').innerHTML;
    assert(output.includes('ФАКТИЧЕСКИ ОТГРУЖЕНО'),'Journal stats missing');
    assert(output.includes('200,125'),'Journal tonnes wrong: '+output.slice(0,900));
    assert(!output.includes('№ 12345678'),'Journal duplicates wagon list');
    assert(fetched.some(x=>x.startsWith('/api/wagon-journal?month=')),'No separate journal API request');
    const calendar={dataset:{act:'journal-calendar-toggle'}};
    await events.click[0]({target:{closest:()=>calendar}});
    assert(el('#app').innerHTML.includes('mj-calendar-grid'),'Calendar missing');
    const chosen={dataset:{act:'journal-select-day',id:day.slice(0,7)+'-02'}};
    await events.click[0]({target:{closest:()=>chosen}});
    assert(el('#app').innerHTML.includes('mj-day-details'),'Chosen day not expanded');
    const next={dataset:{act:'journal-month',id:'next'}};
    await events.click[0]({target:{closest:()=>next}});
    assert(fetched.filter(x=>x.startsWith('/api/wagon-journal?')).length===2,'Month navigation did not reload');
    const open={dataset:{act:'journal-open-day',id:day}};
    await events.click[0]({target:{closest:()=>open}});
    assert(el('#app').innerHTML.includes('maxim-title-row'),'Back to day loads failed');
  }
  if(role==='manager'){
    const click=async(act,id)=>{await events.click[0]({target:{closest:()=>({dataset:{act,id}})}});await new Promise(r=>setTimeout(r,30));};
    await click('lv-open');
    assert(el('#app').innerHTML.includes('К СДАЧЕ В КАССУ'),'Pending screen missing');
    assert(el('#app').innerHTML.includes('data-act="lv-submit" disabled'),'Empty statement must not submit');
    await click('lv-mode','archive');
    assert(el('#app').innerHTML.includes('Сданных ведомостей пока нет'),'Archive screen missing');
    await click('lv-mode','period');
    assert(el('#app').innerHTML.includes('НАЧИСЛЕНО ЗА ПЕРИОД'),'Period report missing');
    await click('nav','tariffs');
    assert(el('#app').innerHTML.includes('rate-h-1'),'Over-20 tariff field missing');
    await click('nav','loaders');
    assert(el('#app').innerHTML.includes('lv-add-loader'),'Loader editor missing');
  }
  if(role==='admin'){
    const target={dataset:{act:'nav',id:'users'}};
    await events.click[0]({target:{closest:()=>target}});
    await new Promise(r=>setTimeout(r,30));
    assert(el('#app').innerHTML.includes('Новые заявки'),'Admin users screen missing: '+el('#app').innerHTML.slice(0,400)+' errors='+errors.join(' | '));
    const quick={dataset:{act:'preview-on'}};
    await events.click[0]({target:{closest:()=>quick}});
    await new Promise(r=>setTimeout(r,30));
    assert(el('#app').dataset.role==='maxim','Preview did not switch to Maxim');
    const exit={dataset:{act:'preview-off'}};
    await events.click[0]({target:{closest:()=>exit}});
    await new Promise(r=>setTimeout(r,30));
    assert(el('#app').dataset.role==='admin','Preview did not return to Admin');
  }
  return errors;
}
(async()=>{
  for(const role of ['wagon','storekeeper','manager','admin']){
    const errors=await test(role);
    assert.deepEqual(errors,[],role+' module factory failed: '+errors.join('\n'));
    console.log('PASS',role);
  }
  const errors=await test('wagon','lev');
  assert(errors.some(e=>e.includes('lev')),'Missing module not detected');
  console.log('PASS independent module failure: Maxim still loads without Lev module');
})().catch(err=>{console.error(err);process.exitCode=1});
