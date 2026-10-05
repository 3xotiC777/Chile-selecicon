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

function validDay(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function monthBounds(month){
  if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new RangeError('Selecciona un mes válido para su rango operativo.');
  const first=month+'-01',last=new Date(first+'T00:00:00Z');
  last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
  return {first,last:last.toISOString().slice(0,10)};
}
function plusDays(day,days){
  const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

/** The proposed range needs operator confirmation before becoming authoritative. */
export function suggestMonthRange(month){
  const {first,last}=monthBounds(month);
  return {start:operationalMonthStart(first,1),end:last};
}

/** Validate real inclusive dates, the chosen month and, optionally, its weekly load. */
export function validateMonthRange(month,range,weeklyPeriod){
  const {first,last}=monthBounds(month);
  if(!range||typeof range!=='object'||Array.isArray(range)||!validDay(range.start)||!validDay(range.end)||range.end<range.start)throw new RangeError('Indica fechas válidas para el rango operativo del mes: inicio y fin, con fin igual o posterior al inicio.');
  if(range.start>last||range.end<first)throw new RangeError(`El rango operativo (${range.start} a ${range.end}) debe incluir al menos un día del mes elegido (${month}).`);
  if(weeklyPeriod){
    const {start,end=start}=weeklyPeriod;
    if(!validDay(start)||!validDay(end)||end<start)throw new RangeError('Las fechas de carga semanal deben ser válidas antes de comprobar el rango operativo.');
    if(start<range.start||end>range.end)throw new RangeError(`La carga semanal (${start} a ${end}) está fuera del rango operativo confirmado (${range.start} a ${range.end}). Edita el rango del mes o las fechas de carga.`);
  }
  return {start:range.start,end:range.end};
}

/** Legacy periods keep their week-derived boundaries until a range is confirmed. */
export function resolveOperationalPeriod({month,start,end,week,weeks,monthRange}){
  const range=monthRange==null?null:validateMonthRange(month,monthRange,{start,end:end||start});
  const operationalStart=range?.start||operationalMonthStart(start,week);
  const operationalEnd=range?.end||plusDays(operationalStart,weeks*7-1);
  const secondHalfStart=plusDays(operationalMonthStart(operationalStart,1),14);
  return {operationalStart,operationalEnd,secondHalfStart,...(range?{monthRange:range}:{})};
}
