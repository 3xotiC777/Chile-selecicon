import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTracking,durationMinutes,summarizeTracking,trackingCsv,productivityCsv,reportForPeriod} from '../src/tracking.js';
import {OSA,REPLICAS,SOVI,FACING} from '../src/engine.js';

const options={month:'2026-10',week:2,weeks:5,start:'2026-10-05',end:'2026-10-10'};
const planning=rows=>({studies:[...new Set(rows.map(r=>r.study))].map(name=>({name,start:options.start,end:options.end})),rows:rows.map(r=>({auditor:'100',auditorName:'Ana',start:options.start,end:options.end,studyId:'1',...r}))});
const u=(folio,frequency='FIJA',client='EMBONOR')=>({folio,frequency,client});
let sequence=0;
const visit=(folio,study,day='2026-09-28',status='TERMINADO',extra={})=>({folio,study,day,status,visit:String(++sequence),auditorName:'Ana',duration:'00:10:00',...extra});
const point=(result,study,folio='1')=>result.points.find(p=>p.study===study&&p.folio===folio);

test('stored reports contain only the inclusive active operational month, including its calendar boundaries',()=>{
  const rows=['2026-09-27','2026-09-28','2026-10-15','2026-11-01','2026-11-02'].map(day=>visit('1',FACING,day));
  const period={operationalStart:'2026-09-28',operationalEnd:'2026-11-01'};
  assert.deepEqual(reportForPeriod(rows,period).map(r=>r.day),['2026-09-28','2026-10-15','2026-11-01']);
  assert.deepEqual(reportForPeriod(rows,{operationalStart:'2026-09-28',weeks:5}),reportForPeriod(rows,period));assert.equal(rows.length,5);
  assert.throws(()=>reportForPeriod(rows,{operationalStart:'2026-09-31',operationalEnd:'2026-11-01'}),/inicio operativo/);
  assert.throws(()=>reportForPeriod(rows,{operationalStart:'2026-09-28',operationalEnd:'2026-09-27'}),/fin operativo/);
});
test('undated empty and rejected surveys plus invalid completed dates remain available for quality checks',()=>{
  const rows=[visit('1',FACING,'','VACIO'),visit('2',FACING,undefined,'RECHAZO',{day:null}),visit('3',FACING,'invalid','TERMINADO')];
  const filtered=reportForPeriod(rows,{operationalStart:'2026-09-28',operationalEnd:'2026-11-01'});
  assert.deepEqual(filtered,rows);assert.equal(filtered[0],rows[0]);
  const r=buildTracking({planning:planning(rows.map(row=>({folio:row.folio,study:FACING}))),report:filtered,options});assert.equal(r.quality.undatedEmpty,1);assert.equal(r.quality.undatedRejected,1);assert.equal(r.quality.invalidCompletedDates,1);assert.equal(r.summary.completedSurveys,0);
});

test('operational October includes September 28 and excludes previous September week',()=>{
  const r=buildTracking({planning:planning([{folio:'1',study:OSA}]),universe:[u('1')],report:[visit('1',OSA,'2026-09-28'),visit('1',OSA,'2026-09-21')] ,options});
  assert.equal(r.period.operationalStart,'2026-09-28');assert.equal(r.period.secondHalfStart,'2026-10-12');assert.equal(point(r,OSA).validVisits,1);assert.equal(r.quality.outsidePeriod,1);
});
test('confirmed monthly tracking uses inclusive range extremes and caps as-of at the end',()=>{
  const monthRange={start:'2026-09-28',end:'2026-10-31'};
  const report=['2026-09-27','2026-09-28','2026-10-31','2026-11-01'].map(day=>visit('1',FACING,day));
  const r=buildTracking({planning:planning([{folio:'1',study:FACING}]),report,options:{...options,monthRange,asOf:'2026-11-10'}});
  assert.deepEqual(r.period.monthRange,monthRange);assert.equal(r.period.operationalStart,monthRange.start);assert.equal(r.period.operationalEnd,monthRange.end);assert.equal(r.period.asOf,'2026-10-31');
  assert.equal(point(r,FACING).validVisits,2);assert.equal(r.quality.outsidePeriod,2);assert.equal(r.summary.completedSurveys,2);
  const earlier=buildTracking({planning:planning([{folio:'1',study:FACING}]),report,options:{...options,monthRange,asOf:'2026-10-10'}});
  assert.equal(point(earlier,FACING).validVisits,1);assert.equal(earlier.period.asOf,'2026-10-10');
});
test('an edited monthly range changes tracking counts and preserves Monday-based halves',()=>{
  const monthRange={start:'2026-10-01',end:'2026-10-31'};
  const r=buildTracking({planning:planning([{folio:'1',study:OSA}]),universe:[u('1','QUINCENALES')],report:['2026-09-28','2026-10-01','2026-10-11','2026-10-12'].map(day=>visit('1',OSA,day)),options:{...options,monthRange}});
  const p=point(r,OSA);assert.equal(p.validVisits,3);assert.equal(p.visitsFirstHalf,2);assert.equal(p.visitsSecondHalf,1);assert.equal(p.fulfilledVisits,2);
  assert.equal(r.period.secondHalfStart,'2026-10-12');assert.equal(r.quality.outsidePeriod,1);
});
test('tracking blocks a weekly load outside its confirmed month range',()=>{
  assert.throws(()=>buildTracking({planning:planning([{folio:'1',study:FACING}]),options:{...options,monthRange:{start:'2026-10-06',end:'2026-10-31'}}}),/fuera del rango operativo confirmado/);
});
test('report retention gives the confirmed month range priority over legacy derived boundaries',()=>{
  const report=['2026-09-27','2026-09-28','2026-10-31','2026-11-01'].map(day=>visit('1',FACING,day));
  const period={month:'2026-10',monthRange:{start:'2026-09-28',end:'2026-10-31'},operationalStart:'2026-10-01',operationalEnd:'2026-11-01',weeks:5};
  assert.deepEqual(reportForPeriod(report,period).map(row=>row.day),['2026-09-28','2026-10-31']);
  assert.throws(()=>reportForPeriod(report,{...period,monthRange:{start:'2026-09-31',end:'2026-10-31'}}),/fechas válidas/);
});
test('SOVI components excluded by the month range cannot complete a measurement',()=>{
  const report=SOVI.map((study,i)=>visit('1',study,i<4?'2026-09-29':'2026-10-01'));
  const r=buildTracking({planning:planning(SOVI.map(study=>({folio:'1',study}))),report,options:{...options,monthRange:{start:'2026-10-01',end:'2026-10-31'}}});
  assert.equal(point(r,'SOVI EMBONOR').validVisits,0);assert.equal(point(r,'SOVI EMBONOR').partialSovi[0].completedStudies,4);assert.equal(r.quality.outsidePeriod,4);
});
test('fixed OSA needs separate completed weeks, not repeated surveys in one week',()=>{
  const r=buildTracking({planning:planning([{folio:'1',study:OSA}]),universe:[u('1')],report:[visit('1',OSA,'2026-09-28'),visit('1',OSA,'2026-09-29'),visit('1',OSA,'2026-10-05')],options});
  const p=point(r,OSA);assert.equal(p.target,5);assert.equal(p.validVisits,3);assert.equal(p.fulfilledVisits,2);assert.equal(p.remaining,3);assert.equal(p.progress,40);assert.equal(p.excessVisits,1);
});
test('quincenal cannot be fulfilled by two first-half visits',()=>{
  const r=buildTracking({planning:planning([{folio:'1',study:OSA}]),universe:[u('1','QUINCENALES')],report:[visit('1',OSA,'2026-09-28'),visit('1',OSA,'2026-10-05')],options});
  const p=point(r,OSA);assert.equal(p.validVisits,2);assert.equal(p.fulfilledVisits,1);assert.equal(p.visitsFirstHalf,2);assert.equal(p.remaining,1);assert.equal(p.complete,false);
});
test('quincenal completes one in each operational half and caps overcompletion',()=>{
  const r=buildTracking({planning:planning([{folio:'1',study:OSA}]),universe:[u('1','QUINCENALES')],report:[visit('1',OSA,'2026-10-05'),visit('1',OSA,'2026-10-12'),visit('1',OSA,'2026-10-19')],options});
  const p=point(r,OSA);assert.equal(p.fulfilledVisits,2);assert.equal(p.progress,100);assert.equal(p.complete,true);assert.equal(p.excessVisits,1);
});
test('OSA replicas use their own completed studies and report aliases',()=>{
  const rows=[{folio:'1',study:OSA},...REPLICAS.map(study=>({folio:'1',study}))];
  const r=buildTracking({planning:planning(rows),universe:[u('1')],report:[visit('1','OSA VINOS 2'),visit('1','ESTUDIO DE EXHIBICIONES COCA COLA')],options});
  assert.equal(point(r,OSA).validVisits,0);assert.equal(point(r,'OSA VINOS EMBONOR').validVisits,1);assert.equal(point(r,'EXHIBICIONES ADICIONALES EMBONOR').validVisits,1);assert.equal(point(r,'OSA ABI EMBONOR').validVisits,0);
});
test('SOVI consolidates eight TERMINADO on different days in same week',()=>{
  const rows=SOVI.map(study=>({folio:'1',study})),report=SOVI.map((study,i)=>visit('1',study,i<4?'2026-09-28':'2026-10-03'));
  const r=buildTracking({planning:planning(rows),universe:[u('1')],report,options});assert.equal(r.points.length,1);const p=point(r,'SOVI EMBONOR');assert.equal(p.validVisits,1);assert.equal(p.fulfilledVisits,1);assert.equal(p.attempts,8);assert.equal(r.summary.completedSurveys,8);
});
test('SOVI never combines components across weeks and flags partial measurements',()=>{
  const report=SOVI.map((study,i)=>visit('1',study,i<4?'2026-09-28':'2026-10-05'));
  const r=buildTracking({planning:planning(SOVI.map(study=>({folio:'1',study}))),universe:[u('1')],report,options});const p=point(r,'SOVI EMBONOR');assert.equal(p.validVisits,0);assert.equal(p.incompleteWeeks,2);assert.equal(p.partialSovi[0].completedStudies,4);assert.equal(r.quality.incompleteSovi,1);
});
test('seven SOVI studies plus a repeated study does not complete eight',()=>{
  const report=SOVI.slice(0,7).map(s=>visit('1',s));report.push(visit('1',SOVI[0]));
  const r=buildTracking({planning:planning(SOVI.map(study=>({folio:'1',study}))),universe:[u('1')],report,options});assert.equal(point(r,'SOVI EMBONOR').validVisits,0);assert.equal(point(r,'SOVI EMBONOR').partialSovi[0].missingStudies[0],SOVI[7]);
});
test('SOVI requires all eight flags in the planning denominator',()=>{
  const r=buildTracking({planning:planning(SOVI.slice(0,7).map(study=>({folio:'1',study}))),universe:[u('1')],report:SOVI.map(s=>visit('1',s)),options});assert.equal(r.points.length,0);assert.equal(r.quality.ineligibleSovi,1);assert.equal(r.summary.completedSurveys,8);
});
test('SOVI complete twice in first half still needs the second half',()=>{
  const report=['2026-09-28','2026-10-05'].flatMap(day=>SOVI.map(s=>visit('1',s,day)));
  const r=buildTracking({planning:planning(SOVI.map(study=>({folio:'1',study}))),universe:[u('1')],report,options});assert.equal(point(r,'SOVI EMBONOR').fulfilledVisits,1);assert.equal(point(r,'SOVI EMBONOR').remaining,1);
});
test('Facing monthly completed survey counts; rejected and empty stay pending',()=>{
  const r=buildTracking({planning:planning(['1','2'].map(folio=>({folio,study:FACING}))),report:[visit('1','FACING CERVEZAS 2'),visit('2','FACING CERVEZAS 2',undefined,'RECHAZO'),visit('2','FACING CERVEZAS 2',undefined,'VACIO')],options});
  assert.equal(point(r,FACING,'1').complete,true);const p=point(r,FACING,'2');assert.equal(p.remaining,1);assert.equal(p.empty,1);assert.equal(p.rejected,1);assert.equal(p.attempts,2);
});
test('Cruz Verde frequency 2 follows halves, frequencies 3 and 4 count monthly quotas',()=>{
  const rows=['1','2','3'].map(folio=>({folio,study:'QUIEBRES CRUZ VERDE'}));
  const report=['1','2','3'].flatMap(f=>[visit(f,'QUIEBRES CRUZ VERDE'),visit(f,'QUIEBRES CRUZ VERDE','2026-10-01')]);
  const r=buildTracking({planning:planning(rows),universe:[u('1',2,'CRUZ VERDE'),u('2',3,'CRUZ VERDE'),u('3',4,'CRUZ VERDE')],report,options});assert.equal(point(r,'QUIEBRES CRUZ VERDE','1').fulfilledVisits,1);assert.equal(point(r,'QUIEBRES CRUZ VERDE','2').remaining,1);assert.equal(point(r,'QUIEBRES CRUZ VERDE','3').remaining,2);
});
test('CENCOSUD prices and photographs are independent monthly goals for same enabled points',()=>{
  const r=buildTracking({planning:planning([{folio:'1',study:'CENCOSUD'}]),report:[visit('1','PRECIOS CENCOSUD'),visit('1','PRECIOS CENCOSUD')],options:{...options,assignments:[{folio:'1',study:'CENCOSUD',start:options.start,end:options.end}]}});
  assert.equal(r.points.length,2);assert.equal(point(r,'PRECIOS CENCOSUD').complete,true);assert.equal(point(r,'FOTOGRAFIAS CENCOSUD').remaining,1);assert.equal(r.summary.progress,50);assert.equal(r.summary.plannedPoints,2);
});
test('current planning and current week execution distinguish monthly fulfillment from dispatch',()=>{
  const rows=[{folio:'1',study:FACING},{folio:'2',study:FACING}],report=[visit('1',FACING),visit('2',FACING,'2026-10-06')];
  const r=buildTracking({planning:planning(rows),report,options:{...options,assignments:rows.map(row=>({...row,start:options.start,end:options.end}))}});assert.equal(point(r,FACING,'1').complete,true);assert.equal(point(r,FACING,'1').plannedPending,true);assert.equal(point(r,FACING,'2').plannedPending,false);
});
test('duplicated visit IDs do not inflate progress, productivity or durations',()=>{
  const v=visit('1',FACING),r=buildTracking({planning:planning([{folio:'1',study:FACING}]),report:[v,v],options});assert.equal(r.quality.duplicates,1);assert.equal(r.summary.surveys,1);assert.equal(point(r,FACING).validVisits,1);assert.equal(r.auditors[0].averageMinutes,10);
});
test('unknown studies contribute productivity but do not invent targets or matching visits',()=>{
  const r=buildTracking({planning:planning([{folio:'1',study:FACING}]),report:[visit('1','UNCONFIGURED STUDY',undefined,'TERMINADO',{client:'COLGATE'})],options});assert.equal(r.summary.target,1);assert.equal(r.summary.progress,0);assert.equal(r.summary.surveys,1);assert.equal(r.quality.unknownStudies,1);assert.equal(r.studies.find(s=>s.study==='UNCONFIGURED STUDY').hasTarget,false);
});
test('missing required frequencies are visible and excluded from percentage denominator',()=>{
  const r=buildTracking({planning:planning([{folio:'1',study:OSA},{folio:'2',study:FACING}]),report:[visit('2',FACING)],options});assert.equal(point(r,OSA).target,null);assert.equal(r.quality.missingFrequencies,1);assert.equal(r.summary.target,1);assert.equal(r.summary.progress,100);assert.equal(r.summary.unknownTargetPoints,1);
});
test('actual auditor receives productivity even when the planned owner is another auditor',()=>{
  const rows=[{folio:'1',study:FACING,auditor:'100',auditorName:'Ana'},{folio:'2',study:FACING,auditor:'200',auditorName:'Luis'}];
  const r=buildTracking({planning:planning(rows),report:[visit('1',FACING,undefined,'TERMINADO',{auditorName:'Luis'})],options});assert.equal(point(r,FACING).auditor,'100');assert.equal(r.auditors.find(a=>a.auditor==='100').surveys,0);assert.equal(r.auditors.find(a=>a.auditor==='200').surveys,1);
});
test('numeric auditor values in the export remain auditor codes instead of becoming names',()=>{
  const r=buildTracking({planning:planning([{folio:'1',study:FACING}]),report:[visit('1',FACING,undefined,'TERMINADO',{auditorName:200})],options});assert.equal(r.daily[0].auditor,'200');assert.equal(r.auditors.find(a=>a.auditor==='200').surveys,1);
});
test('productivity averages unique field days and uses a weighted duration average',()=>{
  const daily=[{day:'2026-10-01',auditor:'1',auditorName:'Ana',client:'A',study:'X',surveys:2,completedSurveys:1,minutes:30,timedSurveys:2},{day:'2026-10-01',auditor:'1',auditorName:'Ana',client:'A',study:'Y',surveys:1,completedSurveys:1,minutes:30,timedSurveys:1},{day:'2026-10-02',auditor:'1',auditorName:'Ana',client:'A',study:'X',surveys:1,completedSurveys:1,minutes:0,timedSurveys:0}];
  const s=summarizeTracking([],daily);assert.equal(s.auditors[0].fieldDays,2);assert.equal(s.auditors[0].surveysPerDay,2);assert.equal(s.auditors[0].completedSurveysPerDay,1.5);assert.equal(s.auditors[0].averageMinutes,20);assert.equal(s.summary.averageMinutes,20);
});
test('duration parser accepts formatted and Excel durations and timestamp fallback',()=>{
  assert.equal(durationMinutes({duration:'00:05:30'}),5.5);assert.ok(Math.abs(durationMinutes({duration:5/1440})-5)<1e-8);assert.equal(durationMinutes({duration:'bad',timeStart:'2026-10-03 12:00:00',timeEnd:'2026-10-03 12:20:00'}),20);assert.equal(durationMinutes({timeStart:'23:55:00',timeEnd:'00:05:00'}),10);assert.equal(durationMinutes({duration:'00:00:00'}),null);assert.equal(durationMinutes({duration:'24:00:00'}),null);assert.equal(durationMinutes({duration:'-00:10:00'}),null);
});
test('invalid days and invalid durations are reported without turning them into successful progress',()=>{
  const r=buildTracking({planning:planning([{folio:'1',study:FACING}]),report:[visit('1',FACING,'bad'),visit('1',FACING,undefined,'VACIO',{duration:'bad'})],options});assert.equal(r.quality.invalidDates,1);assert.equal(r.quality.invalidDurations,1);assert.equal(r.summary.surveys,1);assert.equal(r.summary.averageMinutes,null);assert.equal(point(r,FACING).validVisits,0);
});
test('undated VACIO remains visible as a pending export item without inventing a visit or field day',()=>{
  const r=buildTracking({planning:planning([{folio:'1',study:FACING}]),report:[visit('1',FACING,'','VACIO',{duration:''})],options});
  assert.equal(point(r,FACING).empty,1);assert.equal(point(r,FACING).undatedEmpty,1);assert.equal(point(r,FACING).attempts,0);assert.equal(point(r,FACING).validVisits,0);assert.equal(r.summary.surveys,0);assert.equal(r.summary.fieldDays,0);assert.equal(r.quality.undatedEmpty,1);
});
test('progress exports include active plan, failed surveys and safe Excel cells',()=>{
  const r=buildTracking({planning:planning([{folio:'1',study:FACING,auditorName:'=2+2'}]),report:[],options});const csv=trackingCsv(r.points);assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/META_MENSUAL/);assert.match(csv,/PROGRAMACION_PENDIENTE/);assert.match(csv,/'=2\+2/);assert.match(productivityCsv(r.auditors),/MINUTOS_PROMEDIO/);
});
