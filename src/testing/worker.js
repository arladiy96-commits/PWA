/* Loaded only by a test build. No server URLs, bot token or outbound operations. */
importScripts('./runtime/pyodide.js');
let py, revision = null;
const ready = (async () => {
  py = await loadPyodide({indexURL:new URL('./runtime/',self.location.href).href});
  const manifest = await (await fetch('./runtime-files.json')).json();
  await py.loadPackage(manifest.packages);
  py.FS.mkdirTree('/engine');py.FS.mkdirTree('/data');py.FS.mkdirTree('/usr/local/share/fonts');
  for (const name of ['domain.py','bridge.py','contractor.py','catalog_history.py','trash.py','word_report.py','loader_report.py','document_names.py',...manifest.wheels]) {
    const res=await fetch(new URL(name,self.location.href));if(!res.ok)throw Error('Не удалось загрузить '+name);
    py.FS.writeFile('/engine/'+name,new Uint8Array(await res.arrayBuffer()));
  }
  const font=await fetch(new URL('DejaVuSans.ttf',self.location.href));
  py.FS.writeFile('/usr/local/share/fonts/DejaVuSans.ttf',new Uint8Array(await font.arrayBuffer()));
  await py.runPythonAsync(`import sys, pathlib, zipfile
sys.path.insert(0, '/engine')
for wheel in pathlib.Path('/engine').glob('*.whl'):
    with zipfile.ZipFile(wheel) as z: z.extractall('/engine')
import bridge
`);
  postMessage({ready:true});
})();
let chain=Promise.resolve();
self.onmessage=({data})=>{
  chain=chain.catch(()=>{}).then(async()=>{
    try {
      await ready;
      if(data.snapshot?.revision!==revision || revision===null){
        if(data.snapshot?.database){py.globals.set('saved_database',data.snapshot.database);py.runPython('bridge.restore_database(saved_database)');}
        py.runPython('bridge.initialize()');revision=data.snapshot?.revision??0;
      }
      py.globals.set('request_payload',JSON.stringify(data.request));
      const result=JSON.parse(await py.runPythonAsync('await bridge.dispatch(request_payload)'));
      const database=py.runPython('bridge.export_database()');
      revision=(data.snapshot?.revision||0)+1;
      postMessage({id:data.id,result,snapshot:{database,revision}});
    }catch(error){postMessage({id:data.id,error:String(error.message||error)});}
  });
};
ready.catch(error=>postMessage({fatal:String(error.message||error)}));
