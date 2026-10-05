import test from 'node:test';
import assert from 'node:assert/strict';
import {select,FORTNIGHTLY} from '../src/engine.js';
import {buildTracking} from '../src/tracking.js';
import {summarizeWeeklyProgress} from '../src/weekly-progress.js';

const exhibitions='EXHIBICIONES COLGATE';
const studies=[...FORTNIGHTLY,exhibitions];
const starts=['2026-09-28','2026-10-05','2026-10-12','2026-10-19','2026-10-26'];
const ends=['2026-10-03','2026-10-10','2026-10-17','2026-10-24','2026-10-31'];
const monthRange={start:'2026-09-28',end:'2026-10-31'};
function fixture(week=1){
  const headers=studies.map((name,index)=>({name,studyId:String(900+index),start:starts[week-1],end:ends[week-1]}));
  const rows=headers.flatMap(header=>Array.from({length:9},(_,index)=>({folio:String(index+1),auditor:index<5?'101':'102',auditorName:index<5?'Ana':'Bruno',sourceRow:index+8,study:header.name,...header})));
  return {planning:{studies:headers,rows},universe:[],report:[],hasReport:week>1,options:{month:'2026-10',week,weeks:5,holidays:0,monthRange}};
}
const visit=(study,folio,day,status='TERMINADO',suffix='')=>({study,folio:String(folio),day,status,visit:`${study}-${folio}-${day}-${status}-${suffix}`});
const selected=(result,study)=>result.files.find(file=>file.name===study+'.csv').rows.map(row=>row.folio);
function atWeek(input,week){
  input.options.week=week;input.hasReport=week>1;
  for(const row of [...input.planning.studies,...input.planning.rows])Object.assign(row,{start:starts[week-1],end:ends[week-1]});
}

test('Colgate sends half per auditor without an export in week 1, rounding up odd routes; Exhibiciones stays monthly',()=>{
  const input=fixture(),result=select(input);
  for(const study of FORTNIGHTLY){
    assert.deepEqual(selected(result,study),['1','2','3','6','7']);
    const decisions=result.decisions.filter(row=>row.study===study);
    assert(decisions.every(row=>row.frequency==='quincenal'&&row.visitsFirstHalf===0&&row.visitsSecondHalf===0));
  }
  assert.equal(selected(result,exhibitions).length,9);
});

test('Colgate closes the first half with every pending point, independently per study and regardless of empty or rejected attempts',()=>{
  const input=fixture(2);
  input.report=[visit(FORTNIGHTLY[0],1,'2026-09-28'),visit(FORTNIGHTLY[0],2,'2026-09-29','VACIO'),visit(FORTNIGHTLY[0],3,'2026-10-01','RECHAZADO'),visit(FORTNIGHTLY[1],6,'2026-10-02'),visit(FORTNIGHTLY[0],4,'2026-10-05'),visit(FORTNIGHTLY[0],5,'2026-09-27')];
  const result=select(input);
  assert.deepEqual(selected(result,FORTNIGHTLY[0]),['2','3','4','5','6','7','8','9']);
  assert.deepEqual(selected(result,FORTNIGHTLY[1]),['1','2','3','4','5','7','8','9']);
  assert.equal(selected(result,exhibitions).length,9);
});

test('Colgate rotates the week 3 cohort, completes both halves by week 4 and schedules no third visit in week 5',()=>{
  const input=fixture(),scheduled=[];
  for(let week=1;week<=5;week++){
    atWeek(input,week);const result=select(input);scheduled.push(result);
    for(const file of result.files)input.report.push(...file.rows.map(row=>visit(row.study,row.folio,starts[week-1])));
  }
  for(const study of FORTNIGHTLY){
    assert.deepEqual(selected(scheduled[2],study),['1','4','5','8','9']);
    for(const first of [0,2]){
      const opening=selected(scheduled[first],study),closing=selected(scheduled[first+1],study);
      assert.equal(opening.length,5);assert.equal(closing.length,4);
      assert.equal(new Set([...opening,...closing]).size,9);assert(opening.every(folio=>!closing.includes(folio)));
    }
    assert.deepEqual(selected(scheduled[4],study),[]);
  }
  assert.equal(selected(scheduled[0],exhibitions).length,9);
  for(const result of scheduled.slice(1))assert.deepEqual(selected(result,exhibitions),[]);
  const tracking=buildTracking(input);
  assert(tracking.points.every(point=>point.complete));
  assert.equal(tracking.summary.fulfilledVisits,45);assert.equal(tracking.summary.target,45);
});

test('Colgate week 4 includes failed week 3 visits, and week 5 retries only the remaining second-half visit',()=>{
  const input=fixture(4);
  input.report=FORTNIGHTLY.flatMap(study=>Array.from({length:9},(_,index)=>visit(study,index+1,'2026-09-28')));
  input.report.push(...FORTNIGHTLY.flatMap(study=>['1','4','8'].map(folio=>visit(study,folio,'2026-10-12'))));
  input.report.push(visit(FORTNIGHTLY[0],5,'2026-10-13','VACIO'),visit(FORTNIGHTLY[1],9,'2026-10-13','RECHAZADO'));
  const fourth=select(input);
  for(const study of FORTNIGHTLY){
    assert.deepEqual(selected(fourth,study),['2','3','5','6','7','9']);
    input.report.push(...selected(fourth,study).filter(folio=>folio!=='5').map(folio=>visit(study,folio,'2026-10-19')));
  }
  atWeek(input,5);input.options.holidays=2;
  const fifth=select(input);
  for(const study of FORTNIGHTLY)assert.deepEqual(selected(fifth,study),['5']);
});

test('Colgate tracking and weekly graph require one TERMINADO in each half; repeated first-half surveys do not fulfill the second',()=>{
  const input=fixture(2);
  input.report=studies.flatMap(study=>[visit(study,1,'2026-09-28'),visit(study,1,'2026-10-05'),visit(study,1,'2026-10-12'),visit(study,2,'2026-09-29'),visit(study,3,'2026-10-01','VACIO'),visit(study,3,'2026-10-13','RECHAZADO')]);
  const tracking=buildTracking(input);
  for(const study of FORTNIGHTLY){
    const points=tracking.points.filter(point=>point.study===study);
    const complete=points.find(point=>point.folio==='1'),partial=points.find(point=>point.folio==='2'),failed=points.find(point=>point.folio==='3');
    assert.equal(complete.target,2);assert.equal(complete.frequency,'quincenal');assert.equal(complete.fulfilledVisits,2);assert.equal(complete.visitsFirstHalf,2);assert.equal(complete.visitsSecondHalf,1);
    assert.equal(partial.fulfilledVisits,1);assert.equal(partial.remaining,1);assert.equal(partial.progress,50);assert.equal(partial.complete,false);
    assert.equal(failed.fulfilledVisits,0);assert.equal(failed.remaining,2);assert.equal(failed.empty,1);assert.equal(failed.rejected,1);
    const graph=summarizeWeeklyProgress(points,tracking.period);
    assert.equal(graph.target,18);assert.equal(graph.fulfilledVisits,3);
    assert.deepEqual(graph.weeks.map(week=>week.fulfilledVisits),[2,0,1,0,0]);
  }
  const monthly=tracking.points.filter(point=>point.study===exhibitions);
  assert(monthly.every(point=>point.target===1&&point.frequency==='mensual'));
  assert.equal(monthly.find(point=>point.folio==='2').complete,true);
  const graph=summarizeWeeklyProgress(monthly,tracking.period);
  assert.deepEqual(graph.weeks.map(week=>week.fulfilledVisits),[2,0,0,0,0]);
});

test('Colgate second-half opening prioritizes unvisited points over rotating ties and flags a missed first half',()=>{
  const input=fixture(3);
  input.report=FORTNIGHTLY.flatMap(study=>Array.from({length:9},(_,index)=>index===1?null:visit(study,index+1,'2026-09-28')).filter(Boolean));
  const result=select(input);
  for(const study of FORTNIGHTLY){
    assert(selected(result,study).includes('2'));
    const pending=result.decisions.find(row=>row.study===study&&row.folio==='2');
    assert.equal(pending.visitsFirstHalf,0);assert.equal(pending.visitsSecondHalf,0);
  }
  assert(result.warnings.some(warning=>warning.includes('no completaron la primera quincena')));
});
