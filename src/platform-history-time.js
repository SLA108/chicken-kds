// Warsaw calendar-day boundaries for collected-order history filtering.
export function warsawMidnightUtc(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new RangeError('Invalid calendar date');
 const target=Date.parse(date+'T00:00:00Z');
 const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 let guess=target;
 for(let i=0;i<3;i++){
  const parts=fmt.formatToParts(new Date(guess)),value=type=>Number(parts.find(p=>p.type===type).value);
  const localAsUtc=Date.UTC(value('year'),value('month')-1,value('day'),value('hour'),value('minute'));
  guess+=target-localAsUtc;
 }
 return new Date(guess).toISOString();
}
export function warsawDayBounds(from,to){
 if(from&&to&&from>to)throw new RangeError('Invalid date range');
 const start=from?warsawMidnightUtc(from):null;
 const end=to?warsawMidnightUtc(new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10)):null;
 return {start,end};
}
