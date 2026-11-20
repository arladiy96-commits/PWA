// Illustrative records for the desktop preview. Monetary values are in tiyn.
export const names = ['Иванов А.', 'Петров С.', 'Сидоров В.', 'Ким Д.', 'Орлов М.'];
export const number = n => n.toLocaleString('ru-RU', {maximumFractionDigits:2});
export const money = cents => number(cents / 100) + ' ₸';
export function day(offset=0) {
  const d = new Date();
  d.setDate(d.getDate()+offset);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
export function sample() {
  const loads=[];
  for (const offset of [-12,-9,-6,-4,-2,-1,0]) {
    const count=offset===0?9:4;
    for(let i=0;i<count;i++) {
      const wagon=i%3===0, id=loads.length+1;
      const crew=[names[id%5],names[(id+1)%5]];
      const done=offset===0 ? i<4 : offset!==-1 || i!==3;
      loads.push({id,date:day(offset),type:wagon?'Вагон':i%3===1?'Фура':'КамАЗ',
        ref:wagon?String(60148260+id):'', buyer:['Астык','Береке','АгроТрейд','Дан'][id%4],
        product:id%4===0?'Отруби':'Мука',weight:wagon?68.5:i%3===1?22:15,
        crew:offset===0 && i===7?[]:crew,done,
        fund:wagon?3000000:i%3===1?1320000:900000, contractor:wagon?300000:0,
        statement:done && offset < -1 ? day(offset):null});
    }
  }
  return loads;
}
export function shares(row) {
  if (!row.done || !row.crew.length) return [];
  const base=Math.floor(row.fund/row.crew.length);
  return row.crew.map((name,i)=>[name,base+(i<row.fund%row.crew.length?1:0)]);
}
export function ledger(rows) {
  const result=new Map();
  for(const row of rows.filter(x=>x.done)){
    for(const [name,sum] of shares(row)) result.set(name,(result.get(name)||0)+sum);
  }
  const contractor=rows.reduce((v,r)=>v+(r.done?r.contractor:0),0);
  if(contractor) result.set('Наемник на тупике',contractor);
  return result;
}
