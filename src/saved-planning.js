import {id,normalize,SOVI} from './engine.js';

const key=(folio,study)=>JSON.stringify([id(folio),normalize(study)]);
const studiesFor=study=>{
  const name=normalize(study);
  return name==='CENCOSUD'?['PRECIOS CENCOSUD','FOTOGRAFIAS CENCOSUD']:SOVI.includes(name)?['SOVI EMBONOR']:[name];
};

/** Most recently saved, including a corrected earlier week. Never mutates the list. */
export function latestSavedPlan(plans=[]){
  const stamp=plan=>Date.parse(plan.updatedAt)||0;
  return plans.slice().sort((a,b)=>stamp(b)-stamp(a)||b.week-a.week)[0]||null;
}

export function compactSelection(result){
  // Monthly RETAIL already stores addresses and other descriptive fields. Saved
  // ZIPs need only the CSV fields plus the study name used by the dashboard.
  const columns=['folio','auditor','study','studyId','start','end'];
  const files=result.files.map(file=>({...file,rows:file.rows.map(row=>Object.fromEntries(columns.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])))}));
  const selection={files,period:result.period,metrics:result.metrics,warnings:result.warnings,workload:result.workload,soviAuditors:result.soviAuditors};
  if(Array.isArray(result.decisions))selection.decisions=result.decisions.map(({folio,study,selected,reason})=>({folio,study,selected,reason}));
  return selection;
}

export function planningWeekLabel(period){
  if(!Number.isInteger(period?.week)||period.week<1||period.week>5||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period?.month||''))return 'Semana no registrada';
  const month=new Intl.DateTimeFormat('es-CL',{month:'long',timeZone:'UTC'}).format(new Date(period.month+'-01T00:00:00Z'));
  return `Semana ${period.week} de ${month}`;
}

/** Saved CSV membership is authoritative. Reasons belong to that same snapshot,
 * and must not be reconstructed with a newer visit report or newer rules. */
export function savedPlanningIndex(selection){
  const available=!!selection,planned=new Set(),reasons=new Map();
  for(const file of selection?.files||[])for(const row of file.rows||[]){
    for(const study of studiesFor(row.study))planned.add(key(row.folio,study));
  }
  for(const decision of selection?.decisions||[]){
    if(decision.selected!==false||!decision.reason)continue;
    for(const study of studiesFor(decision.study)){
      const k=key(decision.folio,study);if(!reasons.has(k))reasons.set(k,new Set());
      reasons.get(k).add(String(decision.reason));
    }
  }
  return (folio,study)=>{
    const k=key(folio,study),yes=planned.has(k);
    return {planningAvailable:available,plannedCurrentWeek:yes,planningWeek:available?planningWeekLabel(selection.period):'Sin planeación',notPlannedReason:!available?'No hay una planeación guardada.':yes?'':[...(reasons.get(k)||[])].join(' / ')||'Motivo no guardado en esta planeación.'};
  };
}

export function planningStatusLabel(point){
  if(point.planningAvailable===false)return 'Sin planeación';
  return point.plannedCurrentWeek?'Sí':'No';
}
