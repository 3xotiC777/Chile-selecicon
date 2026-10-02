// Initial suggestions only: operators can choose the actual field-work calendar.
export function operationalMonthStart(start,week){
  const date=new Date(start+'T00:00:00Z');
  date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7-(week-1)*7);
  return date.toISOString().slice(0,10);
}
export function suggestPeriod(start){
  const [year,month,day]=start.split('-').map(Number);
  const offset=(new Date(Date.UTC(year,month-1,1)).getUTCDay()+6)%7;
  const days=new Date(Date.UTC(year,month,0)).getUTCDate();
  return {month:start.slice(0,7),week:Math.min(5,Math.ceil((day+offset)/7)),weeks:Math.min(5,Math.max(4,Math.ceil((days+offset)/7)))};
}
