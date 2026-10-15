import test from 'node:test';
import assert from 'node:assert/strict';
import {select,buildHistory,DEFAULT_ALIASES,OSA,REPLICAS,SOVI,FACING,MONTHLY,FORTNIGHTLY,CV,csvRows} from '../src/engine.js';
import {buildTracking} from '../src/tracking.js';
import {summarizeWeeklyProgress} from '../src/weekly-progress.js';
import {progressSheets} from '../src/tracking-export.js';

const starts=['2026-09-28','2026-10-05','2026-10-12','2026-10-19','2026-10-26'];
const ends=['2026-10-03','2026-10-10','2026-10-17','2026-10-24','2026-10-31'];
const weekly=[OSA,...REPLICAS,'POY','FERIAS LIBRES'];
const all=[...weekly,...SOVI,FACING,...FORTNIGHTLY,...MONTHLY,...CV];
let sequence=0;
const visit=(study,folio,day,status='TERMINADO')=>({study:DEFAULT_ALIASES[study]||study,folio,day,status,visit:String(++sequence)});
function fixture(week=5,weeks=5,names=all){
  const studies=names.map((name,index)=>({name,studyId:String(index+1),start:starts[week-1],end:ends[week-1]}));
  const planning={studies,rows:studies.flatMap(s=>['001','002','003'].map((folio,index)=>({...s,study:s.name,folio,auditor:index===0?'101':'102',auditorName:index===0?'Ana':'Bruno'})))};
  return {planning,report:[],hasReport:week>1,universe:['EMBONOR','CRUZ VERDE'].flatMap(client=>['001','002','003'].map(folio=>({client,folio,frequency:client==='EMBONOR'?'FIJA':2}))),options:{month:'2026-10',week,weeks,holidays:0,monthRange:{start:starts[0],end:ends[weeks-1]}}};
}
const folios=(result,study)=>result.files.flatMap(file=>file.rows).filter(row=>row.study===study).map(row=>row.folio);
function addWeeks(input,study,folio,days){input.report.push(...days.map(day=>visit(study,folio,day)));}

test('weekly selection requires four distinct completed weeks; duplicates, failed attempts and the loading week do not close quota',()=>{
  const input=fixture();
  for(const study of weekly){
    addWeeks(input,study,'001',starts.slice(0,4));
    addWeeks(input,study,'002',starts.slice(0,3));
    addWeeks(input,study,'003',[starts[0],'2026-09-29',starts[1],starts[2]]);
    input.report.push(visit(study,'003',starts[3],'RECHAZADO'),visit(study,'003','2026-10-20','VACIO'),visit(study,'003',starts[4]),visit(study,'003','2026-09-27'));
  }
  input.report.push(input.report[0]);
  const result=select(input);
  for(const study of weekly)assert.deepEqual(folios(result,study),['002','003'],study);
  const history=buildHistory(input.report,{...input.options,start:starts[4],end:ends[4],aliases:DEFAULT_ALIASES});
  assert.equal(history.weeklyCount(OSA,'003'),3);assert.equal(history.count(OSA,'003'),4);
  assert.equal(history.weeklyCount(OSA,'001'),4);assert.equal(history.stats.duplicates,1);
  for(const file of result.files){const csv=csvRows(file.rows);if(csv)assert(csv.trim().split('\r\n').every(line=>line.split(';').length===6));}
});

test('a successful five-week month selects weekly points four times and leaves week five empty',()=>{
  const input=fixture(1,5,weekly),scheduled=[];
  for(let week=1;week<=5;week++){
    Object.assign(input.options,{week});input.hasReport=week>1;
    for(const row of [...input.planning.studies,...input.planning.rows])Object.assign(row,{start:starts[week-1],end:ends[week-1]});
    const result=select(input);scheduled.push(result);
    input.report.push(...result.files.flatMap(file=>file.rows).map(row=>visit(row.study,row.folio,starts[week-1])));
  }
  for(const study of weekly){
    assert.deepEqual(scheduled.map(result=>folios(result,study).length),[3,3,3,3,0],study);
  }
  const tracking=buildTracking(input);assert(tracking.points.every(p=>p.complete&&p.target===4&&p.fulfilledVisits===4));
});

test('POY and Ferias count their own completed weeks independently',()=>{
  const input=fixture(5,5,['POY','FERIAS LIBRES']);
  addWeeks(input,'POY','001',starts.slice(0,4));addWeeks(input,'FERIAS LIBRES','001',starts.slice(0,3));
  addWeeks(input,'POY','002',starts.slice(0,3));addWeeks(input,'FERIAS LIBRES','002',starts.slice(0,4));
  const result=select(input);
  assert.deepEqual(folios(result,'POY'),['002','003']);assert.deepEqual(folios(result,'FERIAS LIBRES'),['001','003']);
});

test('the final week loads pending replicas, Facing and all eight SOVI even when OSA is already complete',()=>{
  const input=fixture();
  for(const study of weekly)addWeeks(input,study,'001',starts.slice(0,study===REPLICAS[0]?3:4));
  for(const study of SOVI)addWeeks(input,study,'001',[starts[0]]);
  const result=select(input);
  assert(!folios(result,OSA).includes('001'));
  assert(folios(result,REPLICAS[0]).includes('001'));
  for(const study of REPLICAS.slice(1))assert(!folios(result,study).includes('001'));
  for(const study of SOVI)assert(folios(result,study).includes('001'));
  assert(folios(result,FACING).includes('001'));
  const sovi=result.files.find(file=>file.name==='SOVI EMBONOR.csv');assert.equal(sovi.rows.filter(row=>row.folio==='001').length,8);
  assert.equal(folios(result,'POY').includes('001'),false);
});

test('closing overrides apply in week four of a four-week month, but not in week four of a five-week month',()=>{
  for(const weeks of [4,5]){
    const input=fixture(4,weeks);input.options.holidays=2;
    input.universe.filter(row=>row.client==='EMBONOR'&&row.folio==='001').forEach(row=>row.frequency='QUINCENALES');
    input.report.push(visit(OSA,'001',starts[0]),visit(OSA,'001',starts[2]));
    const result=select(input),closing=weeks===4;
    assert.equal(folios(result,FACING).includes('001'),closing);
    for(const study of [...SOVI,...REPLICAS])assert.equal(folios(result,study).includes('001'),closing,study);
    assert.equal(result.metrics.fixedTarget,closing?2:1);
  }
});

test('closing ignores holiday reductions for every pending fixed point and excludes completed ones',()=>{
  for(const holidays of [0,1,2]){
    const input=fixture();input.options.holidays=holidays;
    for(const study of [OSA,...REPLICAS])addWeeks(input,study,'001',starts.slice(0,4));
    const result=select(input);assert.equal(result.metrics.fixedTarget,2);assert.deepEqual(folios(result,OSA),['002','003']);
  }
});

test('final-week fortnightly recovery is credited consistently in dashboard, graph and Excel, without changing prior weeks',()=>{
  for(const weeks of [4,5]){
    const input=fixture(weeks,weeks),closing=starts[weeks-1];
    input.universe.filter(row=>row.client==='EMBONOR').forEach(row=>row.frequency='QUINCENALES');
    const studies=[OSA,...REPLICAS,...FORTNIGHTLY,...CV];
    for(const study of [...studies,...SOVI])input.report.push(visit(study,'001',starts[2]));
    const before=buildTracking(input);assert(before.points.filter(p=>p.folio==='001'&&p.rule==='fortnightly').every(p=>p.fulfilledVisits===1));
    const result=select(input);
    for(const study of [...studies,...SOVI])assert(folios(result,study).includes('001'),study);
    input.report.push(...result.files.flatMap(file=>file.rows).filter(row=>row.folio==='001').map(row=>visit(row.study,row.folio,closing)));
    const after=buildTracking(input),points=after.points.filter(p=>p.folio==='001'&&p.rule==='fortnightly');
    assert(points.every(p=>p.complete&&p.fulfilledVisits===2&&p.visitsFirstHalf===0&&p.recoveredInClosing===1));
    const timeline=summarizeWeeklyProgress(points,after.period);assert.equal(timeline.weeks.at(-1).fulfilledVisits,points.length);assert.equal(timeline.weeks.at(-1).cumulativeProgress,100);
    for(const model of progressSheets(points,after.period)){
      const done=model.columns.findIndex(([key])=>key==='fulfilledVisits');assert(model.rows.every(row=>row[done]===2));
    }
    input.options.dateOverride={start:closing.slice(0,8)+String(Number(closing.slice(8))+1).padStart(2,'0'),end:ends[weeks-1]};
    const again=select(input);for(const study of [...studies,...SOVI])assert(!folios(again,study).includes('001'));
  }
});

test('closing cannot invent a missing SOVI component, count failed surveys or restore manually excluded folios',()=>{
  const input=fixture();
  input.planning.rows=input.planning.rows.filter(r=>!(r.study===SOVI[7]&&r.folio==='001'));
  input.options.excludedFolios=['002'];input.options.auditorOverrides={'003':'428'};
  input.report.push(...SOVI.slice(0,7).map(study=>visit(study,'001',starts[0])));
  const result=select(input);
  for(const study of SOVI)assert(!folios(result,study).includes('001'));
  assert(result.files.flatMap(f=>f.rows).every(r=>r.folio!=='002'));
  assert(result.files.flatMap(f=>f.rows).filter(r=>r.folio==='003').every(r=>r.auditor==='428'));
});

test('a closing month can export enabled pending dependents even when OSA has no column in that planning',()=>{
  const input=fixture(5,5,[...REPLICAS,...SOVI,FACING]);
  const result=select(input);for(const study of [...REPLICAS,...SOVI,FACING])assert.equal(folios(result,study).length,3);
  input.options.week=4;assert.throws(()=>select(input),/Falta OSA BEBESTIBLES/);
});

test('already fulfilled studies all remain absent from closing CSVs, including fortnightly and monthly ones',()=>{
  const input=fixture();
  for(const folio of ['001','002','003']){
    for(const study of weekly)addWeeks(input,study,folio,starts.slice(0,4));
    for(const study of [...SOVI,...FORTNIGHTLY,...CV])addWeeks(input,study,folio,[starts[0],starts[2]]);
    for(const study of [FACING,...MONTHLY])input.report.push(visit(study,folio,starts[0]));
  }
  const result=select(input);assert(result.files.every(file=>file.rows.length===0));
});

test('canonical and customized export names count weekly visits without requiring a filename convention',()=>{
  const input=fixture(5,5,['POY']);input.options.aliases={POY:'POY PERSONALIZADO'};
  for(const day of starts.slice(0,4))input.report.push({...visit('POY','001',day),study:'POY'});
  for(const day of starts.slice(0,4))input.report.push({...visit('POY','002',day),study:'POY PERSONALIZADO'});
  assert.deepEqual(folios(select(input),'POY'),['003']);
});

test('closing does not treat two first-half surveys as a completed monthly distribution',()=>{
  const input=fixture();input.universe.filter(row=>row.client==='EMBONOR').forEach(row=>row.frequency='QUINCENALES');
  for(const study of [OSA,...REPLICAS,...SOVI,...FORTNIGHTLY,...CV])addWeeks(input,study,'001',starts.slice(0,2));
  const result=select(input);
  for(const study of [OSA,...REPLICAS,...SOVI,...FORTNIGHTLY,...CV])assert(folios(result,study).includes('001'),study);
  input.report.push(...result.files.flatMap(file=>file.rows).filter(r=>r.folio==='001').map(r=>visit(r.study,r.folio,starts[4])));
  const tracking=buildTracking(input);
  assert(tracking.points.filter(p=>p.folio==='001'&&p.rule==='fortnightly').every(p=>p.complete&&p.fulfilledVisits===2));
});

test('one closing SOVI measurement stays one even with duplicated component surveys',()=>{
  const input=fixture();
  for(const study of SOVI){input.report.push(visit(study,'001',starts[4]));input.report.push(visit(study,'001','2026-10-27'));}
  const tracking=buildTracking(input),point=tracking.points.find(p=>p.folio==='001'&&p.study==='SOVI EMBONOR');
  assert.equal(point.validVisits,1);assert.equal(point.fulfilledVisits,1);assert.equal(point.remaining,1);assert.equal(point.recoveredInClosing,0);
});
