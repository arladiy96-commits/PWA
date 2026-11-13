// CSS also dismisses the layer if module loading fails. Never wait for a network request.
const launch=document.getElementById('pwa-launch');
if(launch){
  const remove=()=>launch.remove();
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)remove();
  launch.addEventListener('animationend',event=>{if(event.target===launch)remove();});
  window.setTimeout(remove,3400);
  window.addEventListener('pageshow',event=>{if(event.persisted)remove();});
}
