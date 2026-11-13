export const SOVI_COMPETITION='SOVI EMBONOR EXHIBICIONES COMPETENCIA';
const compare=(a,b)=>String(a).localeCompare(String(b),'en',{numeric:true});

// Persist the monthly folio groups; survey status must never move a folio.
// Keep assignments for temporarily disabled points so returning points retain
// their group. New folios fill the smaller group of their current auditor.
export function buildSoviSchedule({month,rows,saved=null}){
  const groups={};
  if(saved?.month===month){
    if(saved.version!==1||!saved.groups||typeof saved.groups!=='object'||Array.isArray(saved.groups))throw new Error('El calendario SOVI guardado no tiene un formato válido.');
    for(const[folio,group]of Object.entries(saved.groups)){
      if(!/^\d+$/.test(folio)||![1,2].includes(group))throw new Error('El calendario SOVI guardado contiene un grupo inválido.');
      groups[folio]=group;
    }
  }
  const auditors=new Map();
  for(const row of rows){
    if(!auditors.has(row.auditor))auditors.set(row.auditor,new Map());
    auditors.get(row.auditor).set(row.folio,row);
  }
  for(const base of auditors.values()){
    const cohort=[...base.values()].sort((a,b)=>compare(a.folio,b.folio));
    const current=cohort.filter(row=>Object.hasOwn(groups,row.folio));
    const fresh=cohort.filter(row=>!Object.hasOwn(groups,row.folio));
    if(!current.length){fresh.forEach((row,i)=>groups[row.folio]=i<Math.ceil(fresh.length/2)?1:2);continue;}
    const counts={1:current.filter(row=>groups[row.folio]===1).length,2:current.filter(row=>groups[row.folio]===2).length};
    for(const row of fresh){const group=counts[1]<=counts[2]?1:2;groups[row.folio]=group;counts[group]++;}
  }
  return {version:1,month,groups};
}

export const soviGroupForWeek=week=>week===1||week===3?1:week===2||week===4?2:null;
export const competitionWeek=week=>week===1||week===3;

export function sharedSoviSchedule(workspace,month){
  if(workspace?.month!==month)return null;
  return workspace.metadata?.soviSchedule||workspace.weeklyPlans?.map(plan=>plan.result?.soviSchedule).find(schedule=>schedule?.month===month)||null;
}
