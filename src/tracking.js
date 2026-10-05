// Monthly progress and productivity share normalized inputs with the selector.
// A SOVI measurement is eight distinct completed studies within one field week.
import {normalize,id,isoDate,monday,frequency,SelectionError,OSA,REPLICAS,SOVI,FACING,CV,FORTNIGHTLY,MONTHLY,DEFAULT_ALIASES} from './engine.js';
import {resolveOperationalPeriod,suggestPeriod,validateMonthRange} from './period.js';

export const TRACKING_ALIASES={...DEFAULT_ALIASES,
  'OSA VINOS EMBONOR':'OSA VINOS 2',
  'EXHIBICIONES ADICIONALES EMBONOR':'ESTUDIO DE EXHIBICIONES COCA COLA',
  'OSA ABI EMBONOR':'ESTUDIO DE CERVEZAS 2',
  'EXHIBICIONES ABI EMBONOR':'EXHIBICIONES CERVEZAS 2',
  'EQUIPOS DE FRIO EMBONOR':'EQUIPOS DE FRIO BEBESTIBLES 2',
  'CENCOSUD':'CENCOSUD','PRECIOS CENCOSUD':'PRECIOS CENCOSUD','FOTOGRAFIAS CENCOSUD':'FOTOGRAFIAS CENCOSUD','POY':'POY 2026','FERIAS LIBRES':'FERIAS LIBRES'};
export const consolidatedStudy=study=>SOVI.includes(study)?'SOVI EMBONOR':study;
const key=(...parts)=>JSON.stringify(parts);
const plusDays=(day,days)=>new Date(new Date(day+'T00:00:00Z').getTime()+days*86400000).toISOString().slice(0,10);
const sorted=(a,b)=>String(a).localeCompare(String(b),'es',{numeric:true});
const percent=(done,target)=>target?Math.round(1000*done/target)/10:0;
const sum=(rows,name)=>rows.reduce((total,row)=>total+(Number(row[name])||0),0);
const clientFor=(study,fallback='')=>{
  if([OSA,...REPLICAS,...SOVI,FACING,'SOVI EMBONOR'].includes(study))return 'EMBONOR';
  if(CV.includes(study))return 'CRUZ VERDE';
  if(study.includes('COLGATE'))return 'COLGATE';
  if(study.includes('CENCOSUD')||study==='FERIAS LIBRES')return 'CENCOSUD';
  if(study==='POY')return 'POY';
  return normalize(fallback)||'OTROS';
};
const statusGroup=status=>normalize(status)==='TERMINADO'?'completed':/^RECHAZ/.test(normalize(status))?'rejected':['VACIO','VACIA','VACIOS','VACIAS',''].includes(normalize(status))?'empty':'other';

// Persist only the active operational month. Undated rows stay available for
// unresolved-state and data-quality checks; they never create a dated visit.
export function reportForPeriod(report,period){
  let range;
  if(period?.monthRange){try{range=validateMonthRange(period.month,period.monthRange);}catch(error){throw new SelectionError(error.message);}}
  const start=range?.start||period?.operationalStart;
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&isoDate(value)===value;
  if(!validDate(start))throw new SelectionError('El período del export necesita un inicio operativo válido.');
  const end=range?.end||(period.operationalEnd??([4,5].includes(period.weeks)?plusDays(start,period.weeks*7-1):null));
  if(!validDate(end)||end<start)throw new SelectionError('El período del export necesita un fin operativo válido, posterior o igual al inicio.');
  if(!Array.isArray(report))throw new SelectionError('El export debe ser una lista de encuestas.');
  return report.filter(row=>{const day=isoDate(row.day);return !day||day>=start&&day<=end;});
}

function timestamp(value){
  if(value instanceof Date)return isNaN(value)?null:value.getTime();
  if(typeof value==='number'&&Number.isFinite(value))return Date.UTC(1899,11,30)+value*86400000;
  const text=String(value??'').trim();
  if(!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text))return null;
  const parsed=Date.parse(text.replace(' ','T')+(/[zZ]$|[+-]\d{2}:\d{2}$/.test(text)?'':'Z'));
  return Number.isFinite(parsed)?parsed:null;
}
function clockMinutes(value){
  const m=String(value??'').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/);
  if(!m||Number(m[1])>23||Number(m[2])>59||Number(m[3]||0)>=60)return null;
  return Number(m[1])*60+Number(m[2])+Number(m[3]||0)/60;
}
// Excel durations are fractions of a day. Formatted export durations are HH:MM:SS.
// Zero, negative and implausibly long (over 12 h) values do not enter averages.
export function durationMinutes(row){
  const value=row.duration;
  let minutes=null;
  if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<1)minutes=value*1440;
  else{
    const m=String(value??'').trim().match(/^(\d{1,3}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
    if(m&&Number(m[2])<60&&Number(m[3])<60)minutes=Number(m[1])*60+Number(m[2])+Number(m[3])/60;
  }
  if(minutes!==null&&minutes>0&&minutes<=720)return minutes;
  const start=timestamp(row.timeStart),end=timestamp(row.timeEnd);
  if(start!==null&&end!==null)minutes=(end-start)/60000;
  else{
    const a=clockMinutes(row.timeStart),b=clockMinutes(row.timeEnd);
    minutes=a!==null&&b!==null?(b-a+1440)%1440:null;
  }
  return minutes!==null&&minutes>0&&minutes<=720?minutes:null;
}

function periodFor(planning,options){
  const rawStart=isoDate(options.start||options.dateOverride?.start||planning.studies?.[0]?.start);
  const suggested=rawStart?suggestPeriod(rawStart):null;
  const month=options.month||suggested?.month;
  const week=Number(options.week||suggested?.week||1),weeks=Number(options.weeks||suggested?.weeks||4);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')||![4,5].includes(weeks)||week<1||week>weeks||!Number.isInteger(week))throw new SelectionError('Indica mes, semana y cuatro o cinco semanas para calcular el seguimiento.');
  const monthMonday=monday(month+'-01');
  const start=rawStart||plusDays(monthMonday,(week-1)*7),end=isoDate(options.end||options.dateOverride?.end||planning.studies?.[0]?.end)||plusDays(start,5);
  if(end<start)throw new SelectionError('El inicio del seguimiento debe ser anterior al fin.');
  let boundaries;
  try{boundaries=resolveOperationalPeriod({month,start,end,week,weeks,monthRange:options.monthRange});}catch(error){throw new SelectionError(error.message);}
  const {operationalEnd}=boundaries;
  const asOf=isoDate(options.asOf)||operationalEnd;
  return {month,week,weeks,start,end,...boundaries,asOf:asOf<operationalEnd?asOf:operationalEnd};
}
function targets(study,f,weeks){
  if(study==='SOVI EMBONOR')return {target:2,rule:'fortnightly',frequency:'quincenal',targetLabel:'Una medición completa de 8 estudios por quincena'};
  if(FORTNIGHTLY.includes(study))return {target:2,rule:'fortnightly',frequency:'quincenal',targetLabel:'Una visita por quincena'};
  if([OSA,...REPLICAS].includes(study)){
    if(f==='fixed')return {target:weeks,rule:'weekly',frequency:'fija',targetLabel:`Una visita por semana (${weeks} semanas)`};
    if(f==='fortnightly')return {target:2,rule:'fortnightly',frequency:'quincenal',targetLabel:'Una visita por quincena'};
  }
  if(CV.includes(study)&&[2,3,4].includes(f))return {target:f,rule:f===2?'fortnightly':'monthly',frequency:String(f),targetLabel:f===2?'Una visita por quincena':`${f} visitas al mes`};
  if(study===FACING||MONTHLY.includes(study)||['PRECIOS CENCOSUD','FOTOGRAFIAS CENCOSUD'].includes(study))return {target:1,rule:'monthly',frequency:'mensual',targetLabel:'Una visita al mes'};
  if(['POY','FERIAS LIBRES'].includes(study))return {target:weeks,rule:'weekly',frequency:'semanal',targetLabel:`Carga semanal completa (${weeks} semanas)`};
  return {target:null,rule:'unknown',frequency:f??'sin frecuencia',targetLabel:'Meta sin frecuencia válida'};
}

// Attribute fulfilled quotas to their earliest eligible week, keeping excess
// surveys and incomplete SOVI components out of the progress timeline.
function fulfilledWeeks(completedByWeek,goal,period){
  if(goal.target===null)return [];
  const result=[],halves=new Set();let remaining=goal.target;
  for(const [weekStart,count] of [...completedByWeek].sort((a,b)=>a[0].localeCompare(b[0]))){
    if(remaining<=0)break;
    let fulfilledVisits;
    if(goal.rule==='fortnightly'){
      const half=weekStart<period.secondHalfStart?1:2;
      if(halves.has(half))continue;
      halves.add(half);fulfilledVisits=1;
    }else fulfilledVisits=goal.rule==='weekly'?1:Math.min(remaining,count);
    if(fulfilledVisits>0){result.push({weekStart,fulfilledVisits});remaining-=fulfilledVisits;}
  }
  return result;
}

export function buildTracking({planning,universe=[],report=[],options={}}){
  const period=periodFor(planning,options),aliases={...TRACKING_ALIASES,...options.aliases},lookup=new Map(),warnings=[...(planning.warnings||[])];
  // The one CENCOSUD planning column creates two independently measured goals.
  // Its CSV study code stays in the selector and is never invented here.
  if(normalize(aliases.CENCOSUD)==='PRECIOS CENCOSUD')aliases.CENCOSUD='CENCOSUD';
  for(const [study,alias] of Object.entries(aliases)){
    for(const name of [study,...(Array.isArray(alias)?alias:[alias])]){
      const normalized=normalize(name);if(!normalized)continue;
      if(lookup.has(normalized)&&lookup.get(normalized)!==study)throw new SelectionError(`El nombre del export «${name}» se asignó a dos estudios.`);
      lookup.set(normalized,study);
    }
  }
  const freqMap=new Map();
  for(const row of universe){const k=key(normalize(row.client),id(row.folio)),f=frequency(row.frequency);if(freqMap.has(k)&&freqMap.get(k)!==f)throw new SelectionError(`El universo tiene frecuencias contradictorias para ${row.folio} (${row.client}).`);freqMap.set(k,f);}
  const master=new Map(),namesToAuditors=new Map();
  const sourceRows=(planning.rows||[]).flatMap(row=>normalize(row.study)==='CENCOSUD'?['PRECIOS CENCOSUD','FOTOGRAFIAS CENCOSUD'].map(study=>({...row,study,studyId:null,sourceStudy:'CENCOSUD',sourceStudyId:row.studyId})):row);
  for(const source of sourceRows){
    const folio=id(source.folio),study=normalize(source.study);if(!folio||!study)continue;
    const override=id(options.auditorOverrides?.[folio]);
    const row={...source,folio,study,auditor:override||id(source.auditor)||'SIN AUDITOR',auditorName:String(source.auditorName||source.auditor||'Sin auditor').trim()};
    const k=key(study,folio);if(!master.has(k))master.set(k,row);
    const name=normalize(row.auditorName);if(name&&name!=='SIN AUDITOR'){
      if(!namesToAuditors.has(name))namesToAuditors.set(name,new Set());namesToAuditors.get(name).add(row.auditor);
    }
  }
  const excluded=new Set((options.excludedFolios||[]).map(id));
  const assignments=options.assignments||[];const planned=new Map();
  for(const row of assignments){for(const study of normalize(row.study)==='CENCOSUD'?['PRECIOS CENCOSUD','FOTOGRAFIAS CENCOSUD']:[consolidatedStudy(normalize(row.study))]){const k=key(study,id(row.folio));if(!planned.has(k))planned.set(k,row);}}
  const quality={rows:report.length,duplicates:0,invalidDates:0,invalidCompletedDates:0,undatedEmpty:0,undatedRejected:0,outsidePeriod:0,unknownStudies:0,unplannedPoints:0,invalidDurations:0,missingFrequencies:0,ineligibleSovi:0,incompleteSovi:0,unknownStudyNames:[]};
  const aggregates=new Map(),soviWeeks=new Map(),dailyMap=new Map(),seen=new Set(),unknownNames=new Set();
  const metricFor=(study,folio)=>{const k=key(study,folio);if(!aggregates.has(k))aggregates.set(k,{valid:0,empty:0,rejected:0,other:0,undatedEmpty:0,undatedRejected:0,attempts:0,firstHalf:0,secondHalf:0,weeks:new Set(),completedByWeek:new Map(),lastVisit:null,currentWeekValid:0});return aggregates.get(k);};
  let lastReportDay=null;
  for(const row of report){
    const canonical=lookup.get(normalize(row.study)),study=consolidatedStudy(canonical||normalize(row.study)),folio=id(row.folio),group=statusGroup(row.status);
    const day=isoDate(row.day);
    if(!day){
      quality.invalidDates++;
      if(group==='completed'){quality.invalidCompletedDates++;continue;}
      // VACIO commonly represents a dispatched survey that was never started.
      // Keep its unresolved status visible, without inventing a field-work day.
      const undatedKey=key(canonical||study,folio,id(row.visit)||key('sin-fecha',normalize(row.status)));
      if(seen.has(undatedKey)){quality.duplicates++;continue;}seen.add(undatedKey);
      if(folio&&study){
        if(!canonical){quality.unknownStudies++;unknownNames.add(study);}
        if(!canonical||!master.has(key(canonical,folio)))quality.unplannedPoints++;
        const m=metricFor(study,folio);m[group]++;if(group==='empty'){m.undatedEmpty++;quality.undatedEmpty++;}if(group==='rejected'){m.undatedRejected++;quality.undatedRejected++;}
      }
      continue;
    }
    if(day<period.operationalStart||day>period.asOf){quality.outsidePeriod++;continue;}
    const duplicateKey=key(canonical||study,folio,id(row.visit)||key(day,String(row.timeStart??''),String(row.timeEnd??''),normalize(row.auditorName||row.auditor),normalize(row.status)));
    if(seen.has(duplicateKey)){quality.duplicates++;continue;}seen.add(duplicateKey);
    if(!canonical){quality.unknownStudies++;unknownNames.add(normalize(row.study));}
    const source=canonical?master.get(key(canonical,folio)):null;
    if(!source)quality.unplannedPoints++;
    // DIA in SQL can be the dispatch date of an unstarted survey. Keep VACIO
    // visible at the point, without inventing a worked day or productivity.
    if(row.scheduledOnly===true&&group==='empty'){
      metricFor(study,folio).empty++;continue;
    }
    const actualName=String(row.auditorName||row.auditor||source?.auditorName||'Sin auditor').trim(),matched=namesToAuditors.get(normalize(actualName));
    const numericActual=id(row.auditor??row.auditorName);
    const actualCode=id(row.auditorCode)||(/^\d+$/.test(numericActual)?numericActual:matched?.size===1?[...matched][0]:normalize(actualName)===normalize(source?.auditorName)?source?.auditor:null)||`nombre:${normalize(actualName)}`;
    const client=clientFor(canonical||study,row.client),minutes=durationMinutes(row),dKey=key(day,actualCode,client,study);
    if(minutes===null)quality.invalidDurations++;
    if(!dailyMap.has(dKey))dailyMap.set(dKey,{day,auditor:actualCode,auditorName:actualName,coordinator:String(row.coordinator||''),client,study,surveys:0,completedSurveys:0,empty:0,rejected:0,other:0,minutes:0,timedSurveys:0});
    const d=dailyMap.get(dKey);d.surveys++;if(group==='completed')d.completedSurveys++;else d[group]++;
    if(minutes!==null){d.minutes+=minutes;d.timedSurveys++;}
    const metric=metricFor(study,folio);metric.attempts++;if(!metric.lastVisit||day>metric.lastVisit)metric.lastVisit=day;
    if(group==='completed'){
      metric.valid++;metric.weeks.add(monday(day));metric[day<period.secondHalfStart?'firstHalf':'secondHalf']++;
      const weekStart=monday(day);metric.completedByWeek.set(weekStart,(metric.completedByWeek.get(weekStart)||0)+1);
      if(day>=period.start&&day<=period.end)metric.currentWeekValid++;
      if(SOVI.includes(canonical)){
        if(!soviWeeks.has(folio))soviWeeks.set(folio,new Map());const byWeek=soviWeeks.get(folio),wk=monday(day);if(!byWeek.has(wk))byWeek.set(wk,new Set());byWeek.get(wk).add(canonical);
      }
    }else metric[group]++;
    if(!lastReportDay||day>lastReportDay)lastReportDay=day;
  }
  quality.unknownStudyNames=[...unknownNames].sort(sorted);
  const points=[],pointKeys=new Set();
  for(const row of master.values()){
    if(excluded.has(row.folio))continue;
    const study=consolidatedStudy(row.study),pKey=key(study,row.folio);if(pointKeys.has(pKey))continue;pointKeys.add(pKey);
    if(study==='SOVI EMBONOR'&&!SOVI.every(s=>master.has(key(s,row.folio)))){quality.ineligibleSovi++;continue;}
    const client=clientFor(row.study,row.client),f=freqMap.get(key(CV.includes(row.study)?'CRUZ VERDE':'EMBONOR',row.folio))??frequency(row.frequency);
    const goal=targets(study,f,period.weeks),metric=aggregates.get(pKey)||{valid:0,empty:0,rejected:0,other:0,attempts:0,firstHalf:0,secondHalf:0,weeks:new Set(),completedByWeek:new Map(),lastVisit:null,currentWeekValid:0};
    let validVisits=metric.valid,visitsFirstHalf=metric.firstHalf,visitsSecondHalf=metric.secondHalf,weeklyVisits=metric.weeks.size,currentWeekCompleted=metric.currentWeekValid>0,incompleteWeeks=0;
    let completedByWeek=metric.completedByWeek;
    const partialSovi=[];
    if(study==='SOVI EMBONOR'){
      validVisits=0;visitsFirstHalf=0;visitsSecondHalf=0;weeklyVisits=0;currentWeekCompleted=false;
      completedByWeek=new Map();
      for(const [wk,completed] of soviWeeks.get(row.folio)||[]){
        if(completed.size===8){validVisits++;weeklyVisits++;completedByWeek.set(wk,1);if(wk<period.secondHalfStart)visitsFirstHalf++;else visitsSecondHalf++;if(wk===monday(period.start))currentWeekCompleted=true;}
        else {incompleteWeeks++;partialSovi.push({weekStart:wk,completedStudies:completed.size,missingStudies:SOVI.filter(s=>!completed.has(s))});}
      }
      if(incompleteWeeks)quality.incompleteSovi++;
    }
    if(goal.target===null)quality.missingFrequencies++;
    const fulfilledVisits=goal.target===null?0:goal.rule==='fortnightly'?Math.min(1,visitsFirstHalf)+Math.min(1,visitsSecondHalf):goal.rule==='weekly'?Math.min(goal.target,weeklyVisits):Math.min(goal.target,validVisits);
    const fulfilledByWeek=fulfilledWeeks(completedByWeek,goal,period);
    const remaining=goal.target===null?null:Math.max(0,goal.target-fulfilledVisits),complete=goal.target!==null&&remaining===0,plan=planned.get(pKey);
    const status=complete?'complete':fulfilledVisits>0?'partial':metric.rejected>0?'rejected':metric.empty>0?'empty':'pending';
    points.push({folio:row.folio,client,study,studyId:study==='SOVI EMBONOR'?null:row.studyId||null,auditor:row.auditor,auditorName:row.auditorName,coordinator:row.coordinator||'',location:row.location||row.address||'',address:row.address||'',region:row.region||'',commune:row.commune||'',chain:row.chain||'',...goal,validVisits,fulfilledVisits,fulfilledByWeek,remaining,progress:percent(fulfilledVisits,goal.target),visitsFirstHalf,visitsSecondHalf,weeklyVisits,empty:metric.empty,rejected:metric.rejected,other:metric.other,undatedEmpty:metric.undatedEmpty||0,undatedRejected:metric.undatedRejected||0,attempts:metric.attempts,lastVisit:metric.lastVisit,plannedCurrentWeek:!!plan,plannedWeekStart:plan?.start||null,plannedWeekEnd:plan?.end||null,currentWeekCompleted,plannedPending:!!plan&&!currentWeekCompleted,incompleteWeeks,partialSovi,complete,status,excessVisits:Math.max(0,validVisits-fulfilledVisits)});
  }
  points.sort((a,b)=>sorted(a.client,b.client)||sorted(a.study,b.study)||sorted(a.auditorName,b.auditorName)||sorted(a.folio,b.folio));
  const daily=[...dailyMap.values()].map(d=>({...d,minutes:Math.round(d.minutes*10000)/10000})).sort((a,b)=>sorted(a.day,b.day)||sorted(a.auditor,b.auditor)||sorted(a.study,b.study));
  if(quality.missingFrequencies)warnings.push(`${quality.missingFrequencies} puntos y estudios no tienen frecuencia válida. Se muestran para corregirlos y quedan fuera de la meta y del porcentaje de avance.`);
  if(quality.incompleteSovi)warnings.push(`${quality.incompleteSovi} puntos tienen semanas SOVI con menos de ocho estudios TERMINADO. Esas semanas no cuentan como medición completa.`);
  if(quality.ineligibleSovi)warnings.push(`${quality.ineligibleSovi} puntos no están habilitados en los ocho SOVI y se excluyen de la meta SOVI.`);
  if(quality.invalidDates)warnings.push(`${quality.invalidDates} filas del export no tienen DIA válido. Los estados vacíos o rechazados se muestran como pendientes del export; no se les inventa un día ni se incluyen en productividad. Los ${quality.invalidCompletedDates} TERMINADO sin fecha no cuentan como visita válida.`);
  if(quality.unknownStudies)warnings.push(`${quality.unknownStudies} registros pertenecen a estudios sin meta configurada: ${quality.unknownStudyNames.join(', ')}. Los registros con fecha se incluyen en productividad; no se inventa una meta mensual.`);
  if(quality.unplannedPoints)warnings.push(`${quality.unplannedPoints} registros del export no corresponden a un punto habilitado de ese estudio en el último RETAIL. No se agregan al universo de metas; los registros con fecha sí se conservan en productividad.`);
  if((planning.rows||[]).some(r=>normalize(r.study)==='CENCOSUD'))warnings.push('CENCOSUD muestra PRECIOS CENCOSUD y FOTOGRAFIAS CENCOSUD como dos estudios mensuales independientes sobre los puntos habilitados de CENCOSUD en RETAIL.');
  if([...master.values()].some(r=>['POY','FERIAS LIBRES'].includes(r.study)))warnings.push('POY y FERIAS LIBRES usan una meta de carga semanal completa; cada semana terminada cuenta una vez.');
  return {period:{...period,lastReportDay},...summarizeTracking(points,daily),points,daily,quality,warnings};
}

function pointSummary(points){
  const eligible=points.filter(p=>p.target!==null&&p.target!==undefined),target=sum(eligible,'target'),fulfilledVisits=sum(eligible,'fulfilledVisits');
  return {points:points.length,uniquePoints:new Set(points.map(p=>p.folio)).size,completedPoints:eligible.filter(p=>p.complete).length,pendingPoints:eligible.filter(p=>!p.complete).length,unknownTargetPoints:points.length-eligible.length,target,validVisits:sum(points,'validVisits'),fulfilledVisits,remaining:target-fulfilledVisits,progress:percent(fulfilledVisits,target),empty:sum(points,'empty'),rejected:sum(points,'rejected'),other:sum(points,'other'),attempts:sum(points,'attempts'),plannedPoints:points.filter(p=>p.plannedCurrentWeek).length,plannedPending:points.filter(p=>p.plannedPending).length,excessVisits:sum(points,'excessVisits')};
}
function productivity(rows){
  const surveys=sum(rows,'surveys'),completedSurveys=sum(rows,'completedSurveys'),fieldDays=new Set(rows.filter(r=>r.surveys>0).map(r=>r.day)).size,minutes=sum(rows,'minutes'),timedSurveys=sum(rows,'timedSurveys');
  return {surveys,completedSurveys,fieldDays,surveysPerDay:fieldDays?Math.round(surveys/fieldDays*100)/100:0,completedSurveysPerDay:fieldDays?Math.round(completedSurveys/fieldDays*100)/100:0,minutes,timedSurveys,averageMinutes:timedSurveys?Math.round(minutes/timedSurveys*100)/100:null,completionRate:percent(completedSurveys,surveys),surveyEmpty:sum(rows,'empty'),surveyRejected:sum(rows,'rejected'),surveyOther:sum(rows,'other')};
}
// Recalculate on filtered rows; day counts and duration averages must be weighted.
export function summarizeTracking(points=[],daily=[]){
  const studyMap=new Map(),auditorMap=new Map();
  for(const p of points){const sk=key(p.client,p.study);if(!studyMap.has(sk))studyMap.set(sk,{client:p.client,study:p.study,points:[],daily:[]});studyMap.get(sk).points.push(p);if(!auditorMap.has(p.auditor))auditorMap.set(p.auditor,{auditor:p.auditor,auditorName:p.auditorName,points:[],daily:[]});auditorMap.get(p.auditor).points.push(p);}
  for(const d of daily){const sk=key(d.client,d.study);if(!studyMap.has(sk))studyMap.set(sk,{client:d.client,study:d.study,points:[],daily:[]});studyMap.get(sk).daily.push(d);if(!auditorMap.has(d.auditor))auditorMap.set(d.auditor,{auditor:d.auditor,auditorName:d.auditorName,points:[],daily:[]});auditorMap.get(d.auditor).daily.push(d);}
  const studies=[...studyMap.values()].map(g=>({client:g.client,study:g.study,...pointSummary(g.points),...productivity(g.daily),hasTarget:g.points.some(p=>p.target!=null),complete:g.points.length>0&&g.points.every(p=>p.complete)})).sort((a,b)=>sorted(a.client,b.client)||sorted(a.study,b.study));
  const auditors=[...auditorMap.values()].map(g=>({auditor:g.auditor,auditorName:g.auditorName,coordinator:g.daily.find(d=>d.coordinator)?.coordinator||g.points.find(p=>p.coordinator)?.coordinator||'',...pointSummary(g.points),...productivity(g.daily)})).sort((a,b)=>sorted(a.auditorName,b.auditorName));
  return {summary:{...pointSummary(points),...productivity(daily),studies:studies.filter(s=>s.hasTarget).length,completedStudies:studies.filter(s=>s.hasTarget&&s.complete).length,auditors:auditors.length},studies,auditors};
}

function csvCell(value){const raw=String(value??'');const safe=/^[=+@-]/.test(raw)?'\''+raw:raw;return /[;"\r\n]/.test(safe)?'"'+safe.replace(/"/g,'""')+'"':safe;}
const csv=rows=>'\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n';
export function trackingCsv(points){return csv([['CLIENTE','ESTUDIO','FOLIO','COD_AUDITOR','AUDITOR','REGION','COMUNA','DIRECCION','META_MENSUAL','VISITAS_TERMINADAS','MEDICIONES_CUMPLIDAS','PENDIENTES','AVANCE_PORCENTAJE','VISITAS_QUINCENA_1','VISITAS_QUINCENA_2','VACIAS','RECHAZADAS','OTRAS','ULTIMA_VISITA','PROGRAMADO_SEMANA','PROGRAMACION_PENDIENTE','ESTADO'],...points.map(p=>[p.client,p.study,p.folio,p.auditor,p.auditorName,p.region,p.commune,p.address||p.location,p.target,p.validVisits,p.fulfilledVisits,p.remaining,p.progress,p.visitsFirstHalf,p.visitsSecondHalf,p.empty,p.rejected,p.other,p.lastVisit,p.plannedCurrentWeek?'SI':'NO',p.plannedPending?'SI':'NO',p.complete?'CUMPLIDO':p.target==null?'SIN META':'PENDIENTE'])]);}
export function productivityCsv(auditors){return csv([['COD_AUDITOR','AUDITOR','COORDINADOR','PUNTOS','PUNTOS_CUMPLIDOS','AVANCE_PORCENTAJE','ENCUESTAS','ENCUESTAS_TERMINADAS','DIAS_CON_ENCUESTAS','ENCUESTAS_POR_DIA','TERMINADAS_POR_DIA','MINUTOS_PROMEDIO','ENCUESTAS_CON_DURACION_VALIDA','VACIAS','RECHAZADAS'],...auditors.map(a=>[a.auditor,a.auditorName,a.coordinator,a.points,a.completedPoints,a.progress,a.surveys,a.completedSurveys,a.fieldDays,a.surveysPerDay,a.completedSurveysPerDay,a.averageMinutes,a.timedSurveys,a.surveyEmpty,a.surveyRejected])]);}
