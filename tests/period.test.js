import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestPeriod,suggestMonthRange,validateMonthRange,resolveOperationalPeriod} from '../src/period.js';
test('September 21 is suggested as fourth operational week; September 14 as third',()=>{assert.deepEqual(suggestPeriod('2026-09-21'),{month:'2026-09',week:4,weeks:5});assert.equal(suggestPeriod('2026-09-14').week,3);});
test('four full weeks are suggested for February 2027',()=>{assert.deepEqual(suggestPeriod('2027-02-22'),{month:'2027-02',week:4,weeks:4});});
test('a proposed month starts on its first operational Monday and ends on its last calendar day',()=>{
  assert.deepEqual(suggestMonthRange('2026-10'),{start:'2026-09-28',end:'2026-10-31'});
  assert.deepEqual(suggestMonthRange('2027-02'),{start:'2027-02-01',end:'2027-02-28'});
  assert.deepEqual(suggestMonthRange('2028-02'),{start:'2028-01-31',end:'2028-02-29'});
});
test('confirmed month ranges require real ordered dates that intersect the selected month',()=>{
  const range={start:'2026-09-28',end:'2026-10-31'};
  assert.deepEqual(validateMonthRange('2026-10',range),range);
  for(const invalid of [null,{start:'2026-09-31',end:'2026-10-31'},{start:'2026-10-31',end:'2026-10-01'},{start:'2026-09-01',end:'2026-09-30'}])assert.throws(()=>validateMonthRange('2026-10',invalid),RangeError);
  assert.throws(()=>suggestMonthRange('2026-13'),/mes válido/);
});
test('the complete weekly load must be inside the inclusive confirmed range',()=>{
  const range={start:'2026-09-28',end:'2026-10-31'};
  assert.deepEqual(validateMonthRange('2026-10',range,{start:'2026-09-28',end:'2026-10-03'}),range);
  assert.deepEqual(validateMonthRange('2026-10',range,{start:'2026-10-26',end:'2026-10-31'}),range);
  assert.throws(()=>validateMonthRange('2026-10',range,{start:'2026-09-27',end:'2026-10-03'}),/fuera del rango/);
  assert.throws(()=>validateMonthRange('2026-10',range,{start:'2026-10-26',end:'2026-11-01'}),/fuera del rango/);
});
test('confirmed ranges override week-derived cuts while halves remain anchored to Monday',()=>{
  const period={month:'2026-10',week:3,weeks:5,start:'2026-10-19',end:'2026-10-24'};
  const legacy=resolveOperationalPeriod(period);
  assert.equal(legacy.operationalStart,'2026-10-05');assert.equal(legacy.operationalEnd,'2026-11-08');
  assert(!Object.hasOwn(legacy,'monthRange'));
  const explicit=resolveOperationalPeriod({...period,monthRange:{start:'2026-10-01',end:'2026-10-31'}});
  assert.equal(explicit.operationalStart,'2026-10-01');assert.equal(explicit.operationalEnd,'2026-10-31');assert.equal(explicit.secondHalfStart,'2026-10-12');
  assert.deepEqual(explicit.monthRange,{start:'2026-10-01',end:'2026-10-31'});
});
