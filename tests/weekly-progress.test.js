import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTracking} from '../src/tracking.js';
import {summarizeWeeklyProgress} from '../src/weekly-progress.js';
import {OSA,FACING,SOVI} from '../src/engine.js';

const options={month:'2026-10',week:2,weeks:5,start:'2026-10-05',end:'2026-10-10',monthRange:{start:'2026-09-28',end:'2026-10-31'}};
const planning=rows=>({studies:[...new Set(rows.map(row=>row.study))].map(name=>({name,start:options.start,end:options.end})),rows:rows.map(row=>({auditor:'1',auditorName:'Ana',...row}))});
let visitId=0;
const visit=(folio,study,day,status='TERMINADO',extra={})=>({folio,study,day,status,visit:String(++visitId),auditor:'1',...extra});
const tracking=(rows,report,universe=[],overrides={})=>buildTracking({planning:planning(rows),report,universe,options:{...options,...overrides}});
const timelineSum=point=>point.fulfilledByWeek.reduce((sum,entry)=>sum+entry.fulfilledVisits,0);

test('weekly fixed quotas count each week once, removing duplicates and same-week excess',()=>{
  const duplicate=visit('1',OSA,'2026-09-28');
  const result=tracking([{folio:'1',study:OSA}],[visit('1',OSA,'2026-10-05'),duplicate,duplicate,visit('1',OSA,'2026-09-29')],[{client:'EMBONOR',folio:'1',frequency:'FIJA'}]);
  const point=result.points[0];assert.equal(point.validVisits,3);assert.equal(point.fulfilledVisits,2);
  assert.deepEqual(point.fulfilledByWeek,[{weekStart:'2026-09-28',fulfilledVisits:1},{weekStart:'2026-10-05',fulfilledVisits:1}]);
  assert.equal(timelineSum(point),point.fulfilledVisits);assert.equal(result.quality.duplicates,1);
});
test('quincenal contributions choose the first completed week of each half, irrespective of export row order',()=>{
  const report=['2026-10-19','2026-10-05','2026-10-12','2026-09-28'].map(day=>visit('1',OSA,day));
  const result=tracking([{folio:'1',study:OSA}],report,[{client:'EMBONOR',folio:'1',frequency:'QUINCENALES'}]);
  const point=result.points[0];assert.equal(point.validVisits,4);assert.equal(point.fulfilledVisits,2);
  assert.deepEqual(point.fulfilledByWeek,[{weekStart:'2026-09-28',fulfilledVisits:1},{weekStart:'2026-10-12',fulfilledVisits:1}]);
  assert.equal(timelineSum(point),point.fulfilledVisits);
});
test('monthly quotas retain earliest completed visits and cap excess in a later week',()=>{
  const cv='QUIEBRES CRUZ VERDE';
  const result=tracking([{folio:'1',study:cv},{folio:'2',study:FACING}],[visit('1',cv,'2026-10-05'),visit('1',cv,'2026-09-29'),visit('1',cv,'2026-09-28'),visit('1',cv,'2026-10-12'),visit('2',FACING,'2026-10-05'),visit('2',FACING,'2026-09-28')],[{client:'CRUZ VERDE',folio:'1',frequency:3}]);
  const point=result.points.find(point=>point.folio==='1');assert.deepEqual(point.fulfilledByWeek,[{weekStart:'2026-09-28',fulfilledVisits:2},{weekStart:'2026-10-05',fulfilledVisits:1}]);
  assert.equal(point.validVisits,4);assert.equal(point.fulfilledVisits,3);
  assert.deepEqual(result.points.find(point=>point.folio==='2').fulfilledByWeek,[{weekStart:'2026-09-28',fulfilledVisits:1}]);
  for(const point of result.points)assert.equal(timelineSum(point),point.fulfilledVisits);
});
test('SOVI contributes one complete measurement per half and never eight component surveys',()=>{
  const report=[...SOVI.map((study,i)=>visit('1',study,i<4?'2026-09-28':'2026-10-03')),...SOVI.map(study=>visit('1',study,'2026-10-05')),...SOVI.slice(0,7).map(study=>visit('1',study,'2026-10-12')),...SOVI.map(study=>visit('1',study,'2026-10-19'))];
  const result=tracking(SOVI.map(study=>({folio:'1',study})),report),point=result.points[0];
  assert.equal(point.validVisits,3);assert.equal(point.fulfilledVisits,2);assert.equal(point.incompleteWeeks,1);
  assert.deepEqual(point.fulfilledByWeek,[{weekStart:'2026-09-28',fulfilledVisits:1},{weekStart:'2026-10-19',fulfilledVisits:1}]);
  const weekly=summarizeWeeklyProgress(result.points,result.period);
  assert.deepEqual(weekly.weeks.map(week=>week.fulfilledVisits),[1,0,0,1,0]);assert.equal(weekly.fulfilledVisits,2);
});
test('rejected, empty and incomplete SOVI records indicate report coverage without creating progress',()=>{
  const rows=[{folio:'1',study:FACING},...SOVI.map(study=>({folio:'2',study}))];
  const report=[visit('1',FACING,'2026-10-06','RECHAZO'),visit('1',FACING,'2026-10-07','VACIO'),...SOVI.slice(0,7).map(study=>visit('2',study,'2026-10-08'))];
  const result=tracking(rows,report),weekly=summarizeWeeklyProgress(result.points,result.period);
  assert.equal(weekly.hasWeeklyData,true);assert.equal(weekly.fulfilledVisits,0);
  assert.deepEqual(weekly.weeks.map(week=>week.fulfilledVisits),[0,0,0,0,0]);
  assert.deepEqual(weekly.weeks.map(week=>week.hasRecords),[true,true,false,false,false]);
  assert(result.points.every(point=>point.fulfilledByWeek.length===0));
});
test('weekly totals and cumulative percentages match the filtered monthly target',()=>{
  const result=tracking([{folio:'1',study:FACING},{folio:'2',study:OSA}],[visit('1',FACING,'2026-09-28'),visit('2',OSA,'2026-09-28'),visit('2',OSA,'2026-10-12')],[{client:'EMBONOR',folio:'2',frequency:'QUINCENALES'}]);
  const snapshot=structuredClone(result.points),weekly=summarizeWeeklyProgress(result.points,result.period);
  assert.equal(weekly.target,3);assert.equal(weekly.fulfilledVisits,3);assert.deepEqual(weekly.weeks.map(week=>week.fulfilledVisits),[2,0,1,0,0]);
  assert.deepEqual(weekly.weeks.map(week=>week.cumulativeVisits),[2,2,3,3,3]);assert.equal(weekly.weeks[0].progress,66.7);assert.equal(weekly.weeks[2].cumulativeProgress,100);
  assert.equal(summarizeWeeklyProgress(result.points.filter(point=>point.study===FACING),result.period).target,1);
  assert.deepEqual(result.points,snapshot);
});
test('the axis includes September 28 for October and clips its final Sunday to October 31',()=>{
  const result=tracking([{folio:'1',study:FACING}],[visit('1',FACING,'2026-09-28')]);
  const weekly=summarizeWeeklyProgress(result.points,result.period);
  assert.equal(weekly.weeks.length,5);assert.equal(weekly.weeks[0].start,'2026-09-28');assert.equal(weekly.weeks[0].end,'2026-10-04');assert.equal(weekly.weeks[4].end,'2026-10-31');
  assert.deepEqual(weekly.weeks.map(week=>week.hasRecords),[true,false,false,false,false]);
});
test('a non-Monday edited range clips its first week and removes out-of-range contributions',()=>{
  const result=tracking([{folio:'1',study:FACING},{folio:'2',study:FACING}],[visit('1',FACING,'2026-09-28'),visit('2',FACING,'2026-10-01'),visit('2',FACING,'2026-11-01')],[],{monthRange:{start:'2026-10-01',end:'2026-10-31'}});
  const weekly=summarizeWeeklyProgress(result.points,result.period);
  assert.equal(weekly.weeks[0].start,'2026-10-01');assert.equal(weekly.weeks.at(-1).end,'2026-10-31');assert.equal(weekly.fulfilledVisits,1);assert.equal(weekly.weeks[0].fulfilledVisits,1);
  assert.equal(result.quality.outsidePeriod,2);
});
test('an explicit six-week range includes its final valid contribution without changing monthly goals',()=>{
  const points=[{target:1,fulfilledVisits:1,fulfilledByWeek:[{weekStart:'2026-08-31',fulfilledVisits:1}]}];
  const period={month:'2026-08',weeks:5,monthRange:{start:'2026-07-27',end:'2026-08-31'},operationalStart:'2026-07-27',operationalEnd:'2026-08-31',lastReportDay:'2026-08-31'};
  const weekly=summarizeWeeklyProgress(points,period);
  assert.equal(weekly.weeks.length,6);assert.equal(weekly.weeks.at(-1).start,'2026-08-31');assert.equal(weekly.weeks.at(-1).end,'2026-08-31');assert.equal(weekly.weeks.at(-1).fulfilledVisits,1);assert.equal(weekly.weeks.at(-1).cumulativeProgress,100);
  assert.equal(weekly.target,1);assert.equal(weekly.fulfilledVisits,1);
});
test('legacy snapshots without a weekly timeline are identified instead of guessed from last visit',()=>{
  const points=[{target:2,fulfilledVisits:1,lastVisit:'2026-10-03'}];
  const weekly=summarizeWeeklyProgress(points,{...options,operationalStart:'2026-09-28',operationalEnd:'2026-10-31',lastReportDay:'2026-10-03'});
  assert.equal(weekly.hasWeeklyData,false);assert.equal(weekly.fulfilledVisits,1);assert.equal(weekly.target,2);assert(weekly.weeks.every(week=>week.fulfilledVisits===0));
});
test('legacy operational periods keep their selected four or five full weeks',()=>{
  const points=[{target:4,fulfilledVisits:0,fulfilledByWeek:[]}];
  const weekly=summarizeWeeklyProgress(points,{operationalStart:'2027-02-01',weeks:4,lastReportDay:null});
  assert.equal(weekly.weeks.length,4);assert.equal(weekly.weeks.at(-1).end,'2027-02-28');assert(weekly.weeks.every(week=>!week.hasRecords));assert.equal(weekly.hasWeeklyData,true);
});
test('invalid or mismatched timelines are unavailable rather than silently showing partial monthly totals',()=>{
  const period={operationalStart:'2026-09-28',weeks:5};
  assert.equal(summarizeWeeklyProgress([{target:2,fulfilledVisits:2,fulfilledByWeek:[{weekStart:'2026-09-28',fulfilledVisits:1}]}],period).hasWeeklyData,false);
  assert.equal(summarizeWeeklyProgress([{target:2,fulfilledVisits:1,fulfilledByWeek:[{weekStart:'2026-09-29',fulfilledVisits:1}]}],period).hasWeeklyData,false);
  assert.equal(summarizeWeeklyProgress([{target:2,fulfilledVisits:1,fulfilledByWeek:[{weekStart:'2026-12-07',fulfilledVisits:1}]}],period).hasWeeklyData,false);
  assert.equal(summarizeWeeklyProgress([{target:2,fulfilledVisits:1,fulfilledByWeek:[null]}],period).hasWeeklyData,false);
  assert.deepEqual(summarizeWeeklyProgress([],{}),{target:0,fulfilledVisits:0,weeks:[],hasWeeklyData:false});
});
