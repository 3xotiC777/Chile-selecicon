// Pure selection rules. Dates are ISO calendar strings; identifiers remain strings.
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toUpperCase();
export const id = value => String(value ?? '').trim().replace(/\.0+$/, '');
export const OSA = 'OSA BEBESTIBLES';
export const REPLICAS = ['OSA VINOS EMBONOR','EXHIBICIONES ADICIONALES EMBONOR','OSA ABI EMBONOR','EXHIBICIONES ABI EMBONOR','EQUIPOS DE FRIO EMBONOR'];
export const SOVI = ['SOVI EMBONOR EXHIBICIONES COMPETENCIA','SOVI EMBONOR SSD','SOVI EMBONOR JUGOS','SOVI EMBONOR AGUAS','SOVI EMBONOR ENERGETICAS','SOVI EMBONOR ISOTONICOS','SOVI EMBONOR COOLER','SOVI EMBONOR CHECKOUT'];
export const FACING = 'FACING ABI EMBONOR';
export const CV = ['QUIEBRES CRUZ VERDE','CRUZ VERDE PROFUNDIDAD'];
export const MONTHLY = ['PRECIOS COLGATE','EXHIBICIONES COLGATE','COLGATE PROMOCIONES FARMACIAS'];
export const DEFAULT_ALIASES = {
  [OSA]: 'OSA BEBESTIBLES 2',
  [FACING]: 'FACING CERVEZAS 2',
  'QUIEBRES CRUZ VERDE':'QUIEBRES CRUZ VERDE',
  'CRUZ VERDE PROFUNDIDAD':'CV TEST',
  'PRECIOS COLGATE':'PRECIOS COLGATE',
  'EXHIBICIONES COLGATE':'EXHIBICIONES COLGATE',
  'COLGATE PROMOCIONES FARMACIAS':'COLGATE PROMOCIONES FARMACIAS',
  'SOVI EMBONOR EXHIBICIONES COMPETENCIA':'SOVI EXHIBICIONES COMPETENCIA',
  'SOVI EMBONOR SSD':'SOVI GONDOLA SSD 2',
  'SOVI EMBONOR JUGOS':'SOVI GONDOLA JUGOS 2',
  'SOVI EMBONOR AGUAS':'SOVI AGUAS 2',
  'SOVI EMBONOR ENERGETICAS':'SOVI ENERGETICAS 2',
  'SOVI EMBONOR ISOTONICOS':'SOVI ISOTONICOS 2',
  'SOVI EMBONOR COOLER':'SOVI COOLER 2',
  'SOVI EMBONOR CHECKOUT':'SOVI CHECKOUT 2',
};
export class SelectionError extends Error {
  constructor(message, details=[]) { super(message); this.name='SelectionError'; this.details=details; }
}
const fail = (message,details) => {throw new SelectionError(message,details);};
export function isoDate(value) {
  if(value instanceof Date && !isNaN(value)) return value.toISOString().slice(0,10);
  if(typeof value==='number' && Number.isFinite(value)) return new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);
  const s=String(value??'').trim();
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/);
  if(!m){const d=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:$|[ T])/);if(d)m=[d[0],d[3],d[2].padStart(2,'0'),d[1].padStart(2,'0')];}
  if(!m) return null;
  const result=`${m[1]}-${m[2]}-${m[3]}`;
  const date=new Date(result+'T00:00:00Z');
  return !isNaN(date)&&date.toISOString().slice(0,10)===result?result:null;
}
export function monday(date) {
  const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);
}
const csvDate=date=>date.split('-').reverse().join('/');
const compareId=(a,b)=>a.localeCompare(b,'en',{numeric:true});
export function frequency(value) {
  const s=normalize(value);
  if(s==='FIJA'||s==='FIJAS')return 'fixed';
  if(['QUINCENAL','QUINCENALES','QUINSENAL','QUINSENALES'].includes(s))return 'fortnightly';
  if(['2','3','4'].includes(s))return Number(s);
  return null;
}
export function buildHistory(report, {month, start, aliases}) {
  const lookup=new Map();
  for(const [study,alias] of Object.entries(aliases)){
    const key=normalize(alias);
    if(!key) fail(`Falta el nombre del export para ${study}.`);
    if(lookup.has(key))fail(`El nombre del export «${alias}» se asignó a dos estudios.`);
    lookup.set(key,study);
  }
  const totals=new Map(), soviWeeks=new Map(), seen=new Set(), seenNames=new Set();
  const stats={rows:report.length,valid:0,ignoredStatus:0,ignoredPeriod:0,duplicates:0,unrelated:0};
  const problems=[];
  for(const r of report){
    seenNames.add(normalize(r.study));
    if(normalize(r.status)!=='TERMINADO'){stats.ignoredStatus++;continue;}
    const day=isoDate(r.day);
    if(!day){problems.push(`Visita ${r.visit||'(sin ID)'}, folio ${r.folio}: TERMINADO sin DIA válido.`);continue;}
    if(!day.startsWith(month)||day>=start){stats.ignoredPeriod++;continue;}
    const study=lookup.get(normalize(r.study));
    if(!study){stats.unrelated++;continue;}
    if(!r.folio){problems.push(`Visita ${r.visit||'(sin ID)'}: falta FOLIO.`);continue;}
    const key=JSON.stringify([study,r.folio,r.visit||day]);
    if(seen.has(key)){stats.duplicates++;continue;}
    seen.add(key);stats.valid++;
    const totalKey=JSON.stringify([study,r.folio]);totals.set(totalKey,(totals.get(totalKey)||0)+1);
    if(SOVI.includes(study)){
      const wk=monday(day);
      // Count completed past weeks; never merge components from different weeks.
      if(wk>=monday(start))continue;
      if(!soviWeeks.has(r.folio))soviWeeks.set(r.folio,new Map());
      const folioWeeks=soviWeeks.get(r.folio);
      if(!folioWeeks.has(wk))folioWeeks.set(wk,new Set());
      folioWeeks.get(wk).add(study);
    }
  }
  if(problems.length)fail('El export tiene visitas TERMINADO sin datos necesarios.',problems);
  const sovi=new Map(), incomplete=new Map();
  for(const [folio,weeks] of soviWeeks){
    let complete=0,partial=0;
    for(const names of weeks.values()) names.size===8?complete++:partial++;
    sovi.set(folio,complete);if(partial)incomplete.set(folio,partial);
  }
  return {stats,seenNames,incomplete,count:(study,folio)=>totals.get(JSON.stringify([study,folio]))||0,soviCount:folio=>sovi.get(folio)||0};
}
export function select({planning,universe,report=[],hasReport=false,options}) {
  const excluded=new Set((options.excludedFolios||[]).map(id));
  const excludedRows=planning.rows.filter(r=>excluded.has(r.folio));
  const corrections=[];
  planning={...planning,rows:planning.rows.filter(r=>!excluded.has(r.folio)).map(row=>{
    const corrected=id(options.auditorOverrides?.[row.folio]);
    if(corrected&&corrected!==row.auditor){corrections.push(`Folio ${row.folio}: código de auditor ${row.auditor} → ${corrected}.`);return {...row,auditor:corrected};}
    return row;
  })};
  const {month,week,weeks,holidays}=options;
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('Selecciona un mes válido.');
  if(![4,5].includes(weeks)||!Number.isInteger(week)||week<1||week>weeks)fail('La semana seleccionada debe estar dentro de las 4 o 5 semanas del mes.');
  if(![0,1,2].includes(holidays))fail('Indica 0, 1 o 2 feriados.');
  if(week>1&&!hasReport)fail('Desde la semana 2 necesitas el export de visitas.');
  if(!planning.rows.length)fail('La hoja RETAIL no tiene puntos habilitados.');
  const studies=new Map(planning.studies.map(s=>[s.name,s]));
  const known=new Set([OSA,...REPLICAS,...SOVI,FACING,...CV,...MONTHLY,'POY','FERIAS LIBRES']);
  const unknown=[...studies.keys()].filter(s=>!known.has(s));
  if(unknown.length)fail('Hay estudios sin una regla de selección definida.',unknown);
  const starts=[...new Set(planning.studies.map(s=>s.start))],ends=[...new Set(planning.studies.map(s=>s.end))];
  if(starts.length!==1||ends.length!==1)fail('Los estudios deben compartir el mismo período semanal en RETAIL.',planning.studies.map(s=>`${s.name}: ${s.start} a ${s.end}`));
  const start=starts[0],end=ends[0];
  if(!isoDate(start)||!isoDate(end)||end<start)fail('Revisa las fechas de inicio y fin en RETAIL.');
  if(start.slice(0,7)!==month&&end.slice(0,7)!==month)fail(`El mes elegido (${month}) no coincide con la planeación (${start} a ${end}).`);
  const aliases={...DEFAULT_ALIASES,...options.aliases};
  const history=buildHistory(report,{month,start,aliases});
  const warnings=[...(planning.warnings||[])];
  warnings.push(...new Set(corrections));
  if(excludedRows.length)warnings.push(`Exclusión manual de ${new Set(excludedRows.map(r=>r.folio)).size} folios en todos los estudios: ${[...new Set(excludedRows.map(r=>r.folio))].join(', ')}.`);
  const byStudy=new Map(planning.studies.map(s=>[s.name,new Map()]));
  const duplicates=[];
  for(const row of planning.rows){
    const map=byStudy.get(row.study);
    if(!/^\d+$/.test(row.folio)||!/^\d+$/.test(row.auditor)||Number(row.auditor)===0)fail('Hay un folio o código de auditor inválido en la planeación.',[`Fila ${row.sourceRow}, folio ${row.folio}, auditor «${row.auditor}» (${row.auditorName}). Corrige el planning o usa «Correcciones de auditor» con el formato FOLIO=CODIGO.`]);
    if(map.has(row.folio)){duplicates.push(`${row.study}: folio ${row.folio}, filas ${map.get(row.folio).sourceRow} y ${row.sourceRow}`);continue;}
    map.set(row.folio,row);
  }
  if(duplicates.length)fail('Hay folios duplicados dentro de un estudio de RETAIL.',duplicates);
  const rows=s=>[...(byStudy.get(s)?.values()||[])];
  const frequencies=new Map(), frequencyProblems=[];
  for(const r of universe){
    const key=JSON.stringify([normalize(r.client),r.folio]),f=frequency(r.frequency);
    if(frequencies.has(key)&&frequencies.get(key)!==f)frequencyProblems.push(`Universo: ${r.client}, folio ${r.folio}, frecuencias contradictorias.`);
    frequencies.set(key,f);
  }
  const freq=row=>frequencies.get(JSON.stringify([CV.includes(row.study)?'CRUZ VERDE':'EMBONOR',row.folio]));
  for(const row of planning.rows){
    if([OSA,...SOVI,FACING,...CV].includes(row.study)){
      const f=freq(row),valid=CV.includes(row.study)?[2,3,4].includes(f):['fixed','fortnightly'].includes(f);
      if(!valid)frequencyProblems.push(`${row.study}: folio ${row.folio}, frecuencia ausente o no válida en UNIVERSO CHILE.`);
    }
  }
  if(frequencyProblems.length)fail('Corrige las frecuencias antes de generar el ZIP.',[...new Set(frequencyProblems)]);
  const relevant=Object.keys(aliases).filter(s=>studies.has(s));
  if(hasReport){
    const absent=relevant.filter(s=>!history.seenNames.has(normalize(aliases[s])));
    if(absent.length)warnings.push(`Sin registros en el export para: ${absent.map(s=>`${s} (${aliases[s]})`).join(', ')}. Se cuentan 0 visitas; comprueba que el export esté completo.`);
    if(history.stats.valid===0)warnings.push('El export no aporta visitas válidas para el mes y fechas de esta selección. Comprueba el período antes de cargar el ZIP.');
  }
  if(history.incomplete.size)warnings.push(`${history.incomplete.size} folios tienen semanas SOVI incompletas: menos de 8 estudios distintos TERMINADO. Esas semanas no cuentan como visita SOVI.`);
  const assignments=new Map(planning.studies.map(s=>[s.name,new Set()])),decisions=[];
  const assign=(study,folio)=>assignments.get(study)?.add(folio);
  const decide=(row,selected,visits,reason)=>{if(selected)assign(row.study,row.folio);decisions.push({...row,frequency:freq(row)??'mensual / completa',visits,selected,reason});};
  const rank=count=>(a,b)=>count(a.folio)-count(b.folio)||compareId(a.folio,b.folio);
  const osaRows=rows(OSA),fixed=osaRows.filter(r=>freq(r)==='fixed');
  const fixedTarget=Math.round(fixed.length*(1-.17*holidays));
  const fixedChosen=new Set([...fixed].sort(rank(f=>history.count(OSA,f))).slice(0,fixedTarget).map(r=>r.folio));
  const fortnightTarget=week<=2?1:2;
  for(const r of osaRows){
    const v=history.count(OSA,r.folio),isFixed=freq(r)==='fixed';
    const yes=isFixed?fixedChosen.has(r.folio):v<fortnightTarget;
    decide(r,yes,v,isFixed?(yes?'Fija semanal; prioridad por menor número de visitas':'Ajuste por feriado; fuera de la muestra de fijas'):(yes?`Quincenal pendiente: ${v}/${fortnightTarget}`:`Cuota quincenal alcanzada: ${v}/${fortnightTarget}`));
  }
  const osa=assignments.get(OSA)||new Set();
  if(!studies.has(OSA)&&[...REPLICAS,...SOVI,FACING].some(s=>studies.has(s)))fail('Falta OSA BEBESTIBLES, necesario para seleccionar Embonor.');
  for(const s of REPLICAS){
    if(!studies.has(s)&&osa.size)fail(`Falta el estudio ${s} para replicar la selección OSA.`);
    const missing=[...osa].filter(f=>!byStudy.get(s)?.has(f));
    if(missing.length)fail(`No se puede replicar OSA en ${s}: hay puntos no habilitados.`,missing.map(f=>`Folio ${f}`));
    for(const r of rows(s)){
      if(osa.has(r.folio)&&r.auditor!==byStudy.get(OSA).get(r.folio).auditor)fail(`Auditor inconsistente para el folio ${r.folio} en ${s}.`);
      decide(r,osa.has(r.folio),null,osa.has(r.folio)?'Replica la selección OSA':'No seleccionado en OSA');
    }
  }
  const soviPresent=SOVI.filter(s=>studies.has(s));
  if(soviPresent.length&&soviPresent.length!==8)fail('Para generar SOVI EMBONOR deben existir los ocho estudios.',SOVI.filter(s=>!studies.has(s)));
  const soviEligible=osaRows.filter(r=>osa.has(r.folio)&&SOVI.every(s=>byStudy.get(s)?.has(r.folio)));
  if(soviPresent.length){
    const missing=osaRows.filter(r=>osa.has(r.folio)&&!SOVI.every(s=>byStudy.get(s)?.has(r.folio)));
    if(missing.length)warnings.push(`${missing.length} puntos seleccionados en OSA no son elegibles para SOVI porque no están habilitados en los ocho estudios. Se mantienen en OSA y pueden recibir Facing.`);
  }
  const sovi=new Set(),soviAuditors=[];
  for(const r of soviEligible)if(freq(r)==='fortnightly'&&history.soviCount(r.folio)<fortnightTarget)sovi.add(r.folio);
  const auditors=new Map();
  for(const r of soviEligible.filter(r=>freq(r)==='fixed')){
    if(!auditors.has(r.auditor))auditors.set(r.auditor,[]);auditors.get(r.auditor).push(r);
  }
  for(const [auditor,list] of auditors){
    const target=Math.ceil(list.length/2);
    list.sort(rank(history.soviCount)).slice(0,target).forEach(r=>sovi.add(r.folio));
    soviAuditors.push({auditor,name:list[0].auditorName,eligible:list.length,selected:target});
  }
  for(const s of SOVI)for(const r of rows(s)){
    if(sovi.has(r.folio)&&r.auditor!==byStudy.get(OSA).get(r.folio).auditor)fail(`Auditor inconsistente para el folio ${r.folio} en ${s}.`);
    const all=SOVI.every(n=>byStudy.get(n)?.has(r.folio)),yes=sovi.has(r.folio);
    decide(r,yes,history.soviCount(r.folio),!osa.has(r.folio)?'No seleccionado en OSA':!all?'No habilitado en los ocho SOVI':yes?'SOVI: prioridad por visitas completas; mismo folio en 8 estudios':freq(r)==='fixed'?'Fuera de la mitad de fijas del auditor':'Cuota quincenal SOVI alcanzada');
  }
  const last=week===weeks;let facingExceptions=0,facingUnreachable=0;
  for(const r of rows(FACING)){
    const visits=history.count(FACING,r.folio),exception=last&&sovi.has(r.folio)&&visits===0&&osa.has(r.folio);
    const yes=visits===0&&osa.has(r.folio)&&(!sovi.has(r.folio)||last);
    if(exception)facingExceptions++;
    if(last&&visits===0&&!osa.has(r.folio))facingUnreachable++;
    decide(r,yes,visits,visits>0?'Visita mensual Facing completada':!osa.has(r.folio)?'No seleccionado en OSA':exception?'Cierre de mes: excepción de coincidencia con SOVI':sovi.has(r.folio)?'Ya seleccionado en SOVI':'Facing pendiente, con OSA y sin SOVI');
  }
  if(facingExceptions)warnings.push(`Cierre de mes: ${facingExceptions} puntos Facing coinciden con SOVI para completar su visita mensual.`);
  if(facingUnreachable)warnings.push(`Cierre de mes: ${facingUnreachable} puntos Facing siguen pendientes y no están en OSA. No pueden asignarse sin OSA; revisa la planeación y la capacidad de fijas.`);
  for(const s of CV)for(const r of rows(s)){
    const v=history.count(s,r.folio),target=freq(r),yes=v<target;
    decide(r,yes,v,yes?`Frecuencia mensual pendiente: ${v}/${target}`:`Frecuencia mensual cumplida: ${v}/${target}`);
  }
  for(const s of MONTHLY)for(const r of rows(s)){
    const v=history.count(s,r.folio);decide(r,v===0,v,v===0?'Visita mensual pendiente':'Visita mensual completada');
  }
  for(const s of ['POY','FERIAS LIBRES'])for(const r of rows(s))decide(r,true,null,'Carga completa');
  const files=[];
  for(const s of planning.studies){
    if(SOVI.includes(s.name))continue;
    files.push({name:s.name+'.csv',rows:rows(s.name).filter(r=>assignments.get(s.name).has(r.folio))});
  }
  if(soviPresent.length)files.push({name:'SOVI EMBONOR.csv',rows:SOVI.flatMap(s=>rows(s).filter(r=>sovi.has(r.folio)))});
  const selectedRows=files.flatMap(f=>f.rows);
  return {files,decisions,warnings,history:history.stats,soviAuditors,period:{month,week,weeks,holidays,start,end},metrics:{points:new Set(selectedRows.map(r=>r.folio)).size,rows:selectedRows.length,files:files.length,auditors:new Set(selectedRows.map(r=>r.auditor)).size,osa:osa.size,sovi:sovi.size,facingExceptions,fixedTotal:fixed.length,fixedTarget}};
}
function csvCell(value){const s=String(value??'');return /[;"\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
export function csvRows(rows){return rows.map(r=>[r.folio,r.auditor,r.studyId,csvDate(r.start),csvDate(r.start),csvDate(r.end)].map(csvCell).join(';')).join('\r\n')+(rows.length?'\r\n':'');}
export function reviewCsv(decisions){return '\uFEFF'+[['FOLIO','AUDITOR','ESTUDIO','FRECUENCIA','VISITAS_VALIDAS','SELECCIONADO','MOTIVO'],...decisions.map(r=>[r.folio,r.auditorName,r.study,r.frequency,r.visits,r.selected?'SI':'NO',r.reason])].map(r=>r.map(csvCell).join(';')).join('\r\n');}
