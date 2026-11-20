export const SOVI_COMPETITION='SOVI EMBONOR EXHIBICIONES COMPETENCIA';
export const SOVI_ROTATING=['SOVI EMBONOR SSD','SOVI EMBONOR JUGOS','SOVI EMBONOR AGUAS','SOVI EMBONOR ENERGETICAS','SOVI EMBONOR ISOTONICOS','SOVI EMBONOR COOLER','SOVI EMBONOR CHECKOUT'];

export function sharedSoviPlans(workspace,month){
  if(workspace?.month!==month)return [];
  return (workspace.weeklyPlans||[]).filter(plan=>plan.month===month).map(plan=>{
    const studiesByFolio=new Map();
    for(const file of plan.result?.files||[])for(const row of file.rows||[]){
      if(!SOVI_ROTATING.includes(row.study))continue;
      if(!studiesByFolio.has(row.folio))studiesByFolio.set(row.folio,new Set());
      studiesByFolio.get(row.folio).add(row.study);
    }
    const rotating=[...studiesByFolio].filter(([,studies])=>studies.size===SOVI_ROTATING.length).map(([folio])=>folio);
    return {week:plan.week,rotating};
  });
}

export function chooseSoviByFortnight({rows,week,savedPlans=[],completed,inHalf,completedInWeekOne,withOsa}){
  const half=week<=2?1:2,opening=week===1||week===3;
  const savedThisWeek=new Set(),savedThisHalf=new Map(),savedWeekOne=new Set();
  for(const plan of savedPlans){
    for(const folio of plan.rotating){
      if(plan.week===1)savedWeekOne.add(folio);
      if(plan.week===week)savedThisWeek.add(folio);
      else if((plan.week<=2?1:2)===half)savedThisHalf.set(folio,plan.week);
    }
  }

  const decisions=new Map(),auditors=new Map();
  for(const row of rows){
    const {folio,auditor,auditorName}=row;
    if(!auditors.has(auditor))auditors.set(auditor,{auditor,name:auditorName,eligible:0,pending:0,withoutOsa:0,selected:0,candidates:[]});
    const summary=auditors.get(auditor);
    summary.eligible++;
    if(completed(folio)>=2)decisions.set(folio,'Cuota mensual SOVI cumplida');
    else if(inHalf(folio,half)>0)decisions.set(folio,'Medición SOVI terminada en esta quincena');
    else if(savedThisHalf.has(folio))decisions.set(folio,`SOVI ya programado en la semana ${savedThisHalf.get(folio)} de esta quincena`);
    else{
      summary.pending++;
      if(week===5)decisions.set(folio,'Pendiente de la quincena. SOVI se programa en semanas 1 a 4');
      else summary.candidates.push(row);
    }
  }

  const selected=new Set();
  const preferWeekThree=folio=>week===3&&(savedWeekOne.has(folio)||completedInWeekOne(folio));
  for(const summary of auditors.values()){
    summary.candidates.sort((a,b)=>Number(savedThisWeek.has(b.folio))-Number(savedThisWeek.has(a.folio))
      ||Number(preferWeekThree(b.folio))-Number(preferWeekThree(a.folio))
      ||Number(withOsa(b.folio))-Number(withOsa(a.folio))
      ||a.folio.localeCompare(b.folio,'en',{numeric:true}));
    const limit=opening?Math.ceil(summary.eligible/2):summary.candidates.length;
    for(const [index,{folio}] of summary.candidates.entries()){
      if(index<limit){
        selected.add(folio);summary.selected++;
        const together=withOsa(folio);
        if(!together)summary.withoutOsa++;
        decisions.set(folio,`Medición SOVI programada para la quincena ${half}${together?'':' sin carga OSA esta semana'}`);
      }else decisions.set(folio,'Pendiente para la siguiente semana de esta quincena');
    }
  }
  const summaries=[...auditors.values()].map(({candidates,...summary})=>summary);
  return {selected,decisions,auditors:summaries};
}
