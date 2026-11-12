// Browser/Android Back shares the same stack as the app's screens and sheets.
// Only UI callbacks live here: no database snapshots and no replay of writes.
export function createNavigation(){
 const session=crypto.randomUUID();
 let entries=[],index=-1,restoring=false,pending=false,deferred=null;
 const marker=i=>({pwaNavigation:session,index:i});
 const rememberScroll=()=>{if(entries[index])entries[index].scroll=document.querySelector('#page-scroll')?.scrollTop||0;};
 function push(entry){
  rememberScroll();entries.splice(index+1);entries.push(entry);index++;
  if(index===0)history.replaceState(marker(index),'');else history.pushState(marker(index),'');
 }
 function screen(key,restore){
  if(restoring)return;
  if(pending){deferred=()=>screen(key,restore);return;}
  const entry={key,restore};
  if(index<0)push(entry);
  else if(entries[index].key===key&&!entries[index].leave)entries[index]={...entries[index],...entry};
  else push(entry);
 }
 function layer(key,leave){
  if(restoring)return;
  if(pending){deferred=()=>layer(key,leave);return;}
  if(entries[index]?.key===key)return;
  push({key,leave});
 }
 function back(){if(index<=0||restoring||pending)return false;pending=true;history.back();return true;}
 function close(key){
  if(entries[index]?.key!==key||restoring||pending)return;
  // Already closed by its X/save button; a queued pop must not close a new form.
  entries[index].leave=()=>{};back();
 }
 let chain=Promise.resolve();
 addEventListener('popstate',event=>{
  const target=event.state?.pwaNavigation===session?event.state.index:null;
  if(target===null)return; // No artificial root entry: Back at home can exit.
  chain=chain.then(async()=>{
   restoring=true;
   try{
    const previous=index;
    if(target<index)for(let i=index;i>target;i--)await entries[i]?.leave?.();
    index=target;
    const entry=entries[index];
    // A dismissed sheet cannot be replayed by Forward (it might have saved data).
    if(entry?.leave&&target>previous){
     let root=index;while(root>0&&entries[root]?.leave)root--;
     entries[index]={...entries[root]};
    }
    const current=entries[index];
    const onlyLayers=target<previous&&entries.slice(target+1,previous+1).every(e=>e.leave);
    if(current?.restore&&!onlyLayers){await current.restore();const page=document.querySelector('#page-scroll');if(page)page.scrollTop=current.scroll||0;}
   }catch(error){console.error('Navigation:',error);}
   finally{restoring=false;pending=false;const next=deferred;deferred=null;next?.();}
  });
 });
 return {screen,layer,close,back};
}
