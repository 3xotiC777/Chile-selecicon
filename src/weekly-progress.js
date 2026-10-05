import {isoDate,monday} from './engine.js';
import {validateMonthRange} from './period.js';

const plusDays=(day,days)=>new Date(new Date(day+'T00:00:00Z').getTime()+days*86400000).toISOString().slice(0,10);
const numeric=value=>Number.isFinite(Number(value))?Number(value):0;
const percentage=(done,target)=>target?Math.round(1000*done/target)/10:0;

/** Summarize only measured contributions, never reconstructing them from lastVisit. */
export function summarizeWeeklyProgress(points=[],period={}){
  if(!Array.isArray(points))throw new TypeError('El avance semanal necesita una lista de puntos.');
  const eligible=points.filter(point=>point.target!=null&&Number.isFinite(Number(point.target)));
  const target=eligible.reduce((total,point)=>total+numeric(point.target),0);
  const fulfilledVisits=eligible.reduce((total,point)=>total+numeric(point.fulfilledVisits),0);
  const range=period.monthRange?validateMonthRange(period.month,period.monthRange):null;
  const start=range?.start||isoDate(period.operationalStart);
  const end=range?.end||isoDate(period.operationalEnd)||(start&&[4,5].includes(period.weeks)?plusDays(start,period.weeks*7-1):null);
  if(!start||!end||end<start)return {target,fulfilledVisits,weeks:[],hasWeeklyData:false};

  const weeks=[],byMonday=new Map(),lastReportDay=isoDate(period.lastReportDay);
  for(let weekStart=monday(start);weekStart<=end;weekStart=plusDays(weekStart,7)){
    const weekEnd=plusDays(weekStart,6),clippedStart=weekStart<start?start:weekStart,clippedEnd=weekEnd>end?end:weekEnd;
    const week={week:weeks.length+1,start:clippedStart,end:clippedEnd,fulfilledVisits:0,cumulativeVisits:0,progress:0,cumulativeProgress:0,hasRecords:!!lastReportDay&&clippedStart<=lastReportDay};
    weeks.push(week);byMonday.set(weekStart,week);
  }
  // Old snapshots cannot provide a faithful timeline. Keep the monthly totals
  // available and let the interface request a refresh instead of guessing.
  const hasWeeklyData=points.length>0&&points.every(point=>Array.isArray(point.fulfilledByWeek)
    &&point.fulfilledByWeek.every(entry=>entry&&typeof entry==='object'&&isoDate(entry.weekStart)===entry.weekStart&&monday(entry.weekStart)===entry.weekStart&&Number.isInteger(entry.fulfilledVisits)&&entry.fulfilledVisits>=0&&byMonday.has(entry.weekStart))
    &&point.fulfilledByWeek.reduce((total,entry)=>total+entry.fulfilledVisits,0)===numeric(point.fulfilledVisits));
  if(hasWeeklyData){
    for(const point of eligible)for(const entry of point.fulfilledByWeek)byMonday.get(entry.weekStart).fulfilledVisits+=entry.fulfilledVisits;
  }
  let cumulativeVisits=0;
  for(const week of weeks){
    cumulativeVisits+=week.fulfilledVisits;week.cumulativeVisits=cumulativeVisits;
    week.progress=percentage(week.fulfilledVisits,target);week.cumulativeProgress=percentage(cumulativeVisits,target);
  }
  return {target,fulfilledVisits,weeks,hasWeeklyData};
}
