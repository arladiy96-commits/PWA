// Desktop demo tariff amounts are entered in tenge and snapshotted in tiyn.
export const initialRates = [
  {product:'Мука', wagon:30000, small:600, large:550, contractor:3000},
  {product:'Отруби', wagon:26000, small:520, large:480, contractor:2500}
];
export function price(rates, product, type, weight) {
  const rate=rates.find(r=>r.product===product);
  const wagon=type==='Вагон';
  const unit=wagon?rate.wagon:weight<20?rate.small:rate.large;
  return {fund:Math.round(unit*(wagon?1:weight)*100), contractor:wagon?Math.round(rate.contractor*100):0, unit};
}
export function grouped(rows, dimension){
  const groups=new Map();
  for(const r of rows){
    const key=dimension==='crew'?[...r.crew].sort().join(', '):r[dimension];
    if(!groups.has(key))groups.set(key,{key,rows:[],tonnes:0,cost:0});
    const g=groups.get(key);
    g.rows.push(r);g.tonnes+=r.weight;g.cost+=r.fund+r.contractor;
  }
  return [...groups.values()].sort((a,b)=>b.cost-a.cost||a.key.localeCompare(b.key,'ru'));
}
export function exportRows(filename,headers,rows){
  const cell=value=>{
    let s=String(value??'');
    if(/^[\s]*[=+@-]/.test(s))s="'"+s;
    return '"'+s.replaceAll('"','""')+'"';
  };
  const body=[headers,...rows].map(row=>row.map(cell).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff',body],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=filename+'.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
