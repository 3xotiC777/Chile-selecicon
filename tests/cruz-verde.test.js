import test from 'node:test';
import assert from 'node:assert/strict';
import {select,CV,DEFAULT_ALIASES,buildHistory} from '../src/engine.js';
import {buildTracking} from '../src/tracking.js';

const starts=['2026-09-28','2026-10-05','2026-10-12','2026-10-19','2026-10-26'];
const ends=['2026-10-03','2026-10-10','2026-10-17','2026-10-24','2026-10-31'];
const ids=['001','002','003','004','005','006'];
let sequence=0;
const visit=(study,folio,day,status='TERMINADO')=>({study:DEFAULT_ALIASES[study],folio,day,status,visit:String(++sequence)});
function fixture(week,weeks=5){
  const studies=CV.map((name,i)=>({name,studyId:String(100+i),start:starts[week-1],end:ends[week-1]}));
  return {planning:{studies,rows:studies.flatMap(s=>ids.map((folio,i)=>({...s,study:s.name,folio,auditor:i<3?'101':'102',auditorName:i<3?'Ana':'Bruno'})))},
    universe:ids.map(folio=>({folio,client:'CRUZ VERDE',frequency:2})),report:[],hasReport:week>1,
    options:{month:'2026-10',week,weeks,holidays:0,monthRange:{start:starts[0],end:ends[weeks-1]}}};
}
const selected=(result,study)=>result.files.find(file=>file.name===study+'.csv').rows.map(row=>row.folio);

test('CV week 1 loads every enabled folio for both studies and every auditor without a holiday reduction',()=>{
  for(const weeks of [4,5])for(const holidays of [0,1,2]){
    const input=fixture(1,weeks);input.options.holidays=holidays;
    const result=select(input);
    for(const study of CV)assert.deepEqual(selected(result,study),ids);
    assert.equal(result.metrics.points,6);assert.equal(result.metrics.rows,12);
    assert(result.decisions.every(row=>row.selected&&row.reason.includes('carga completa')));
  }
});

test('CV week 2 recovers only missing first visits, independently by study and ignoring failed attempts',()=>{
  const input=fixture(2);
  input.report=[visit(CV[0],'001',starts[0]),visit(CV[0],'002',starts[0],'RECHAZO'),visit(CV[0],'003',starts[0],'VACIO'),visit(CV[1],'002',starts[0])];
  const result=select(input);
  assert.deepEqual(selected(result,CV[0]),ids.filter(id=>id!=='001'));
  assert.deepEqual(selected(result,CV[1]),ids.filter(id=>id!=='002'));
  assert.match(result.decisions.find(row=>row.study===CV[0]&&row.folio==='001').reason,/segunda carga desde semana 3/);
});

test('CV week 3 loads the full cohort needing a second monthly visit without splitting odd routes',()=>{
  const input=fixture(3);input.report=CV.flatMap(study=>ids.map(folio=>visit(study,folio,starts[0])));
  input.report.push(visit(CV[0],'001',starts[1]));
  const result=select(input);
  assert.deepEqual(selected(result,CV[0]),ids.filter(id=>id!=='001'));
  assert.deepEqual(selected(result,CV[1]),ids);
  assert(result.decisions.filter(row=>row.selected).every(row=>row.reason.includes('Segunda visita mensual')));
});

test('CV week 4 recovers every missing monthly visit even when the first success occurred in week 3',()=>{
  for(const weeks of [4,5]){
    const input=fixture(4,weeks);
    input.report=[visit(CV[0],'001',starts[0]),visit(CV[0],'001',starts[2]),visit(CV[0],'002',starts[0]),visit(CV[0],'003',starts[2]),visit(CV[0],'004',starts[0]),visit(CV[0],'004',starts[1]),visit(CV[0],'005',starts[2],'RECHAZADO')];
    const result=select(input);
    assert.deepEqual(selected(result,CV[0]),['002','003','005','006']);
    assert.deepEqual(selected(result,CV[1]),ids);
    for(const folio of ['001','004'])assert.match(result.decisions.find(row=>row.study===CV[0]&&row.folio===folio).reason,/Cuota mensual cumplida/);
  }
});

test('CV week 5 only recovers monthly shortages and does not start a third round',()=>{
  const input=fixture(5);
  input.report=CV.flatMap(study=>[visit(study,'001',starts[0]),visit(study,'001',starts[2]),visit(study,'002',starts[2]),visit(study,'002',starts[3]),visit(study,'003',starts[3])]);
  const result=select(input);
  for(const study of CV)assert.deepEqual(selected(result,study),['003','004','005','006']);
});

test('successful CV months follow full cohort then pending then full cohort then pending and finish at two',()=>{
  for(const weeks of [4,5]){
    const input=fixture(1,weeks),schedule=[];
    for(let week=1;week<=weeks;week++){
      input.options.week=week;input.hasReport=week>1;
      for(const row of [...input.planning.studies,...input.planning.rows])Object.assign(row,{start:starts[week-1],end:ends[week-1]});
      const result=select(input);schedule.push(result);
      input.report.push(...result.files.flatMap(file=>file.rows).map(row=>visit(row.study,row.folio,starts[week-1])));
    }
    for(const study of CV)assert.deepEqual(schedule.map(result=>selected(result,study).length),[6,0,6,0,...(weeks===5?[0]:[])]);
    const tracking=buildTracking(input);assert(tracking.points.every(point=>point.target===2&&point.fulfilledVisits===2&&point.remaining===0&&point.complete));
    const history=buildHistory(input.report,{...input.options,start:ends[weeks-1],end:ends[weeks-1],aliases:DEFAULT_ALIASES});
    for(const study of CV)for(const folio of ids)assert.equal(history.count(study,folio),2);
  }
});

test('CV duplicate visit IDs and loading-week or out-of-period records do not close the first visit',()=>{
  const input=fixture(2),first=visit(CV[0],'001',starts[0]);
  input.report=[first,first,visit(CV[0],'002',starts[1]),visit(CV[0],'003','2026-09-27')];
  const result=select(input);assert.deepEqual(selected(result,CV[0]),ids.filter(id=>id!=='001'));assert.equal(result.history.duplicates,1);
});

test('CV frequency 3 and 4 retain their configured monthly targets',()=>{
  const input=fixture(2);input.universe[0].frequency=3;input.universe[1].frequency=4;
  for(const study of CV)input.report.push(visit(study,'001',starts[0]),visit(study,'002',starts[0]));
  const result=select(input);for(const study of CV)assert(selected(result,study).includes('001')&&selected(result,study).includes('002'));
});
