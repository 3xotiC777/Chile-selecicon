export const WEEKLY_MONTHLY_TARGET=4;
// Shared by selection, dashboard, graph and Excel. Fortnightly distribution is
// a planning preference: two valid measurements anywhere in the month meet the
// monthly goal. SOVI supplies at most one complete measurement per week.
export function creditedWeeks(completedByWeek,goal){
  if(goal.target==null)return [];
  const entries=[...completedByWeek].sort((a,b)=>a[0].localeCompare(b[0]));
  const result=new Map();let remaining=goal.target;
  for(const [weekStart,count] of entries){
    if(remaining<=0)break;
    if(count<=0)continue;
    const credited=goal.rule==='weekly'?1:Math.min(remaining,count);
    result.set(weekStart,credited);remaining-=credited;
  }
  return [...result].sort((a,b)=>a[0].localeCompare(b[0])).map(([weekStart,fulfilledVisits])=>({weekStart,fulfilledVisits}));
}
