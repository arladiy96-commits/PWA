const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('assert');
const source=fs.readFileSync(require('path').join(__dirname,'../static/app.js'),'utf8');
const fn=source.slice(source.indexOf('  function attachBuyerSuggestions(){'),source.indexOf('  function openModal(',source.indexOf('  function attachBuyerSuggestions(){')));
(async()=>{
for(const [form,transport] of [['<form id="load-form" data-transport="wagon">','wagon'],['<form id="truck-form">','truck'],['<form id="ad-load-form"><input name="transport" value="wagon">','wagon'],['<form id="load-form" data-transport="truck">','truck']]){
 const w=new JSDOM('<div id="modal">'+form+'<label><input name="buyer"></label></form></div>',{runScripts:'outside-only'}).window;
 const requests=[];w.$=s=>w.document.querySelector(s);w.state={transport:'truck'};w.api=async url=>{requests.push(url);return ['ТОО Покупатель'];};
 w.eval(fn+'\nattachBuyerSuggestions();');await Promise.resolve();
 assert.equal(requests[0],'/api/buyers?transport='+transport);
 const input=w.$('[name="buyer"]');input.value='ТОО';input.dispatchEvent(new w.Event('input'));
 assert.equal(w.$('.buyer-suggestions button').textContent,'ТОО Покупатель');
 w.$('.buyer-suggestions button').click();assert.equal(input.value,'ТОО Покупатель');
}
console.log('PASS buyer suggestions transport routing and selection');
})().catch(e=>{console.error(e);process.exitCode=1});
