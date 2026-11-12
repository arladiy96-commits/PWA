const DB='gruzcontrol-pwa-test-v1';
let database;
function openDB(){return database??=new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function read(){const db=await openDB();return new Promise((resolve,reject)=>{const t=db.transaction('state');const r=t.objectStore('state').get('snapshot');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function write(value){const db=await openDB();return new Promise((resolve,reject)=>{const t=db.transaction('state','readwrite');t.objectStore('state').put(value,'snapshot');t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('Сохранение отменено'));});}
export async function createTestAdapter(role){
  if(!navigator.locks)throw Error('Для безопасного локального хранения обнови браузер: требуется поддержка Web Locks.');
  const worker=new Worker(new URL('../testing/worker.js',import.meta.url));
  let counter=0;const pending=new Map();
  let readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  worker.onmessage=({data})=>{if(data.ready)return readyResolve();if(data.fatal)return readyReject(Error(data.fatal));const p=pending.get(data.id);if(p){pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data);}};
  worker.onerror=e=>{readyReject(Error(e.message));for(const p of pending.values())p.reject(Error(e.message));pending.clear();};
  await ready;
  return {
    async fetch(path,opts={}){
      return navigator.locks.request(DB,async()=>{
        const snapshot=await read();const id=++counter;
        const data=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,snapshot,request:{path,role,method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null}});});
        // A successful UI response is never returned before durable persistence.
        await write(data.snapshot);
        const r=data.result;
        if((opts.method||'GET')!=='GET'&&r.status<400)window.dispatchEvent(new Event('pwa-change'));
        return new Response(r.binary?Uint8Array.from(atob(r.binary),c=>c.charCodeAt(0)):JSON.stringify(r.body),{status:r.status,headers:r.headers||{'Content-Type':'application/json'}});
      });
    }
  };
}
