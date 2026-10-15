import {operationalMonthStart} from './period.js';

export const WEEKLY_MONTHLY_TARGET=4;
export function closingWeekStart(period){
  const first=operationalMonthStart(period.operationalStart,1);
  return new Date(Date.parse(first+'T00:00:00Z')+(period.weeks-1)*7*86400000).toISOString().slice(0,10);
}

// Shared by selection, dashboard, graph and Excel. Closing-week measurements
// can recover a missed fortnight; SOVI supplies at most one per week.
export function creditedWeeks(completedByWeek,goal,period){
  if(goal.target==null)return [];
  const entries=[...completedByWeek].sort((a,b)=>a[0].localeCompare(b[0]));
  const result=new Map(),halves=new Set();let remaining=goal.target;
  for(const [weekStart,count] of entries){
    if(remaining<=0)break;
    if(count<=0)continue;
    let credited;
    if(goal.rule==='fortnightly'){
      const half=weekStart<period.secondHalfStart?1:2;
      if(halves.has(half))continue;
      halves.add(half);credited=1;
    }else credited=goal.rule==='weekly'?1:Math.min(remaining,count);
    result.set(weekStart,credited);remaining-=credited;
  }
  if(goal.rule==='fortnightly'&&remaining>0){
    const closing=closingWeekStart(period);
    for(const [weekStart,count] of entries){
      if(weekStart!==closing)continue;
      const credited=Math.min(remaining,count-(result.get(weekStart)||0));
      if(credited>0){result.set(weekStart,(result.get(weekStart)||0)+credited);remaining-=credited;}
    }
  }
  return [...result].sort((a,b)=>a[0].localeCompare(b[0])).map(([weekStart,fulfilledVisits])=>({weekStart,fulfilledVisits}));
}
