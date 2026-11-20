export function previousPeriod(start,end){
  const ms=86400000;
  const first=Date.parse(start+'T00:00:00Z'), last=Date.parse(end+'T00:00:00Z');
  const iso=t=>new Date(t).toISOString().slice(0,10);
  return [iso(first-(last-first+ms)),iso(first-ms)];
}
export function totals(rows){
  return rows.reduce((a,r)=>({count:a.count+1,weight:a.weight+r.weight,fund:a.fund+r.fund,contractor:a.contractor+r.contractor,cost:a.cost+r.fund+r.contractor}),{count:0,weight:0,fund:0,contractor:0,cost:0});
}
export function comparison(rows,start,end,dimension,product,vehicle){
  const [before,until]=previousPeriod(start,end);
  const selected=rows.filter(r=>r.done&&(!product||r.product===product)&&(!vehicle||r.type===vehicle));
  const take=(a,b)=>selected.filter(r=>r.date>=a&&r.date<=b);
  const now=take(start,end), prior=take(before,until);
  const key=r=>dimension==='crew'?[...r.crew].sort().join(', '):r[dimension];
  const groups=[...new Set([...now,...prior].map(key))].map(name=>{
    const current=now.filter(r=>key(r)===name), previous=prior.filter(r=>key(r)===name);
    const a=totals(current), b=totals(previous);
    return {name,current,previous,a,b,delta:a.cost-b.cost};
  }).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
  return {before,until,groups,now:totals(now),prior:totals(prior)};
}
