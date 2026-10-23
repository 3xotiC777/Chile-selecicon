import {compactSelection} from './saved-planning.js';
import {TRACKING_ALIASES,reportForPeriod} from './tracking.js';

// Postgres JSONB can return object keys in a different order. Compare values,
// preserving array order, rather than treating that as a changed monthly base.
export function sameData(a,b){
  if(a===b)return true;
  if(a==null||b==null||typeof a!=='object'||typeof b!=='object')return false;
  if(Array.isArray(a)!==Array.isArray(b))return false;
  if(Array.isArray(a))return a.length===b.length&&a.every((value,i)=>sameData(value,b[i]));
  const keys=Object.keys(a).filter(key=>a[key]!==undefined),other=Object.keys(b).filter(key=>b[key]!==undefined);
  return keys.length===other.length&&keys.every(key=>Object.hasOwn(b,key)&&sameData(a[key],b[key]));
}

export function selectionSaveInput(draft,workspace){
  const selection=compactSelection(draft.result),{month}=selection.period;
  const planning={...draft.planning,rows:draft.planning.rows.filter(row=>!draft.options.excludedFolios?.includes(row.folio)).map(row=>({...row,auditor:draft.options.auditorOverrides?.[row.folio]||row.auditor}))};
  const report=reportForPeriod(draft.report,selection.period);
  const sameMonth=workspace?.month===month;
  const unchangedPlanning=sameMonth&&workspace.planning&&sameData(planning.rows,workspace.planning.rows)&&sameData(planning.studies,workspace.planning.studies);
  return {
    month,selection,revision:draft.workspaceRevision??workspace?.revision??0,
    // null means retain the existing column inside the same atomic RPC.
    planning:unchangedPlanning?null:planning,
    universe:sameMonth&&sameData(draft.universe,workspace.universe)?null:draft.universe,
    report:sameMonth&&sameData(report,workspace.report)?null:report,
    metadata:{...draft.metadata,...(draft.saveRequestId?{saveRequestId:draft.saveRequestId}:{}),options:{...draft.options,...selection.period,aliases:{...TRACKING_ALIASES,...draft.options.aliases}},selectionOrigin:'Guardada por el administrador'},
  };
}
