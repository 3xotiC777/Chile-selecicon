const compareId=(a,b)=>a.localeCompare(b,'en',{numeric:true});

// A folio is one field location, even when it generates several study rows.
export function pointLoads(rows){
  const loads=new Map();
  for(const row of rows){
    if(!loads.has(row.auditor))loads.set(row.auditor,new Set());
    loads.get(row.auditor).add(row.folio);
  }
  return loads;
}

// Visit deficit remains the first priority. Among equally urgent candidates,
// fill the least loaded existing route, without changing any auditor code.
export function chooseBalanced(rows,target,count,committedRows=[]){
  const loads=pointLoads(committedRows),chosen=new Set(),allocated=new Map();
  const pending=[...rows];
  const load=row=>loads.get(row.auditor)?.size||0;
  while(chosen.size<target&&pending.length){
    pending.sort((a,b)=>count(a.folio)-count(b.folio)
      ||load(a)-load(b)
      ||(allocated.get(a.auditor)||0)-(allocated.get(b.auditor)||0)
      ||compareId(a.auditor,b.auditor)||compareId(a.folio,b.folio));
    const row=pending.shift();
    chosen.add(row.folio);
    if(!loads.has(row.auditor))loads.set(row.auditor,new Set());
    loads.get(row.auditor).add(row.folio);
    allocated.set(row.auditor,(allocated.get(row.auditor)||0)+1);
  }
  return chosen;
}

export function summarizeWorkload(planningRows,selectedRows){
  const groups=new Map();
  for(const row of planningRows){
    if(!groups.has(row.auditor))groups.set(row.auditor,{auditor:row.auditor,name:row.auditorName,base:new Set(),points:new Set(),assignments:0,osa:new Set(),sovi:new Set(),facing:new Set(),cruzVerde:new Set()});
    groups.get(row.auditor).base.add(row.folio);
  }
  for(const row of selectedRows){
    const group=groups.get(row.auditor);
    group.points.add(row.folio);group.assignments++;
    if(row.study==='OSA BEBESTIBLES')group.osa.add(row.folio);
    if(row.study.startsWith('SOVI '))group.sovi.add(row.folio);
    if(row.study==='FACING ABI EMBONOR')group.facing.add(row.folio);
    if(['QUIEBRES CRUZ VERDE','CRUZ VERDE PROFUNDIDAD'].includes(row.study))group.cruzVerde.add(row.folio);
  }
  return [...groups.values()].map(group=>({...group,...Object.fromEntries(['base','points','osa','sovi','facing','cruzVerde'].map(key=>[key,group[key].size]))}))
    .sort((a,b)=>b.points-a.points||compareId(a.auditor,b.auditor));
}

export function workloadCsv(workload){
  const cell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
  return '\uFEFF'+[['COD_AUDITOR','AUDITOR','PUNTOS_PLANNING','PUNTOS_SELECCIONADOS','ENCUESTAS','OSA','SOVI','FACING','CRUZ_VERDE'],...workload.map(a=>[a.auditor,a.name,a.base,a.points,a.assignments,a.osa,a.sovi,a.facing,a.cruzVerde])].map(row=>row.map(cell).join(';')).join('\r\n');
}
