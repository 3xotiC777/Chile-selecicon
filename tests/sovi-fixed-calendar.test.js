import test from 'node:test';
import assert from 'node:assert/strict';
import {select,OSA,REPLICAS,SOVI,SOVI_ROTATING,SOVI_COMPETITION,FACING,csvRows} from '../src/engine.js';
import {buildTracking} from '../src/tracking.js';
import {summarizeWeeklyProgress} from '../src/weekly-progress.js';
import {progressSheets,weeklyStateLabel} from '../src/tracking-export.js';
import {compactSelection,savedPlanningIndex} from '../src/saved-planning.js';
import {selectionSaveInput} from '../src/selection-save-input.js';
import {sharedSoviSchedule} from '../src/sovi-schedule.js';

const starts=['2026-09-28','2026-10-05','2026-10-12','2026-10-19','2026-10-26'];
const ends=['2026-10-03','2026-10-10','2026-10-17','2026-10-24','2026-10-31'];
let visitId=0;
const visit=(row,day,status='TERMINADO')=>({visit:String(++visitId),folio:row.folio,study:row.study,day,status});
function fixture(count=100){
 const names=[OSA,...REPLICAS,...SOVI,FACING],studies=names.map((name,i)=>({name,studyId:String(i+100),start:starts[0],end:ends[0]}));
 const rows=studies.flatMap(s=>Array.from({length:count},(_,i)=>({...s,study:s.name,folio:String(i+1),auditor:'101',auditorName:'Ana'})));
 return{planning:{studies,rows},universe:Array.from({length:count},(_,i)=>({folio:String(i+1),client:'EMBONOR',frequency:'FIJA'})),report:[],hasReport:false,options:{month:'2026-10',week:1,weeks:5,holidays:0,monthRange:{start:starts[0],end:ends[4]}}};
}
function week(input,number){input.options.week=number;input.hasReport=number>1;for(const row of [...input.planning.rows,...input.planning.studies])Object.assign(row,{start:starts[number-1],end:ends[number-1]});}
const folios=(result,study)=>new Set(result.files.flatMap(f=>f.rows).filter(r=>r.study===study).map(r=>r.folio));

test('100 SOVI folios follow 50/50/50/50 and Competition 100/0/100/0 regardless of completed, missing or partial visits',()=>{
 for(const mode of ['completed','none','partial','rejected']){
  const input=fixture(),results=[],counts=new Map();
  for(let number=1;number<=5;number++){
   week(input,number);const result=select(input);results.push(result);input.options.soviSchedule=result.soviSchedule;
   assert.equal(folios(result,SOVI_COMPETITION).size,number===1||number===3?100:0);
   for(const study of SOVI_ROTATING)assert.equal(folios(result,study).size,number===5?0:50);
   for(const study of SOVI)for(const folio of folios(result,study)){assert(folios(result,OSA).has(folio));const key=study+'|'+folio;counts.set(key,(counts.get(key)||0)+1);}
   const file=result.files.find(f=>f.name==='SOVI EMBONOR.csv');
   assert.equal(file.rows.length,number===5?0:(number%2?450:350));
   assert.equal(new Set(file.rows.map(r=>r.folio+'|'+r.studyId)).size,file.rows.length);
   if(file.rows.length)assert(csvRows(file.rows).trim().split('\r\n').every(line=>line.split(';').length===6));
   for(const row of result.files.flatMap(f=>f.rows)){
    if(SOVI.includes(row.study)){
     if(mode==='none'||mode==='partial'&&row.study===SOVI.at(-1))continue;
     input.report.push(visit(row,starts[number-1],mode==='rejected'?'RECHAZO':'TERMINADO'));
    }else input.report.push(visit(row,starts[number-1]));
   }
  }
  for(const study of SOVI_ROTATING){
   assert.deepEqual(folios(results[0],study),folios(results[2],study));assert.deepEqual(folios(results[1],study),folios(results[3],study));
   assert.equal(new Set([...folios(results[0],study),...folios(results[1],study)]).size,100);
   assert([...folios(results[0],study)].every(f=>!folios(results[1],study).has(f)));
  }
  assert.equal(counts.size,800);assert([...counts.values()].every(count=>count===2));
 }
});

test('SOVI does not move blocked folios or bypass OSA even in the declared final week',()=>{
 const input=fixture(4);week(input,4);input.options.weeks=4;
 input.universe.forEach(row=>row.frequency='QUINCENALES');
 input.report=input.planning.rows.filter(r=>r.study===OSA).flatMap(row=>[visit(row,starts[0]),visit(row,starts[2])]);
 const result=select(input);for(const study of SOVI)assert.equal(folios(result,study).size,0);
 assert(result.warnings.some(w=>w.includes('bloqueados')));
 assert.equal(Object.keys(result.soviSchedule.groups).length,4);
 assert(result.decisions.filter(d=>SOVI_ROTATING.includes(d.study)&&result.soviSchedule.groups[d.folio]===2).every(d=>d.reason.includes('no seleccionado en OSA')));
});

test('a four-week closing loads only group B even when group A has no completed visits',()=>{
 const input=fixture(10);week(input,4);input.options.weeks=4;
 const result=select(input);assert.equal(folios(result,SOVI_COMPETITION).size,0);
 for(const study of SOVI_ROTATING)assert.deepEqual([...folios(result,study)],['6','7','8','9','10']);
 assert.equal(result.metrics.soviRows,35);
});

test('saved groups survive a new report and changed RETAIL order across administrators',()=>{
 const input=fixture(9),first=select(input),draft={...input,result:first,workspaceRevision:3,metadata:{}};
 const payload=selectionSaveInput(draft,{month:'2026-10',planning:input.planning,universe:input.universe,report:[],revision:3});
 assert.deepEqual(payload.metadata.soviSchedule,first.soviSchedule);assert.equal(payload.metadata.options.soviSchedule,undefined);
 const workspace={month:'2026-10',metadata:{...payload.metadata},weeklyPlans:[{result:compactSelection(first)}]};
 input.options.soviSchedule=sharedSoviSchedule(workspace,'2026-10');input.planning.rows.reverse();week(input,3);
 input.report=input.planning.rows.filter(r=>SOVI.includes(r.study)).flatMap(row=>[visit(row,starts[0]),visit(row,starts[1])]);
 const third=select(input);assert.deepEqual(third.soviSchedule,first.soviSchedule);
 for(const study of SOVI)assert.deepEqual(folios(third,study),folios(first,study));
});

test('Competition and seven-study measurements have separate progress, weekly graphs and saved planning membership',()=>{
 const input=fixture(2);week(input,4);
 input.report=input.planning.rows.filter(r=>SOVI.includes(r.study)).flatMap(row=>(row.study===SOVI_COMPETITION?[starts[0],starts[2]]:[starts[1],starts[3]]).map(day=>visit(row,day)));
 const tracking=buildTracking(input),points=tracking.points.filter(p=>p.study==='SOVI EMBONOR'||p.study===SOVI_COMPETITION);
 assert.equal(points.length,4);assert(points.every(p=>p.complete&&p.fulfilledVisits===2&&p.target===2));
 for(const study of ['SOVI EMBONOR',SOVI_COMPETITION]){
  const filtered=points.filter(p=>p.study===study),series=summarizeWeeklyProgress(filtered,tracking.period);
  assert.equal(series.target,4);assert.deepEqual(series.weeks.map(w=>w.fulfilledVisits),study===SOVI_COMPETITION?[2,0,2,0,0]:[0,2,0,2,0]);
  const model=progressSheets(filtered,tracking.period)[0];assert.equal(model.rows.length,2);
 }
 const saved={files:[{rows:[{folio:'1',study:SOVI_COMPETITION},{folio:'2',study:SOVI_ROTATING[0]}]}]};
 const lookup=savedPlanningIndex(saved);
 assert.equal(lookup('1',SOVI_COMPETITION).plannedCurrentWeek,true);assert.equal(lookup('1','SOVI EMBONOR').plannedCurrentWeek,false);
 assert.equal(lookup('2','SOVI EMBONOR').plannedCurrentWeek,true);assert.equal(lookup('2',SOVI_COMPETITION).plannedCurrentWeek,false);
});

test('seven completed components do not need Competition, and six plus Competition remain partial',()=>{
 const input=fixture(2);
 input.report=[...input.planning.rows.filter(r=>r.folio==='1'&&SOVI_ROTATING.includes(r.study)).map(row=>visit(row,starts[0])),...input.planning.rows.filter(r=>r.folio==='2'&&SOVI.includes(r.study)&&r.study!==SOVI.at(-1)).map(row=>visit(row,starts[0]))];
 const tracking=buildTracking(input),point=(folio,study)=>tracking.points.find(p=>p.folio===folio&&p.study===study);
 assert.equal(point('1','SOVI EMBONOR').fulfilledVisits,1);assert.equal(point('1',SOVI_COMPETITION).fulfilledVisits,0);
 assert.equal(point('2','SOVI EMBONOR').fulfilledVisits,0);assert.equal(point('2',SOVI_COMPETITION).fulfilledVisits,1);
 assert.equal(weeklyStateLabel(point('2','SOVI EMBONOR').weekStates[0]),'PARCIAL SOVI (6/7)');
});
