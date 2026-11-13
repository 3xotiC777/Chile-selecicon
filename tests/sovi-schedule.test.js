import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSoviSchedule,soviGroupForWeek,competitionWeek,sharedSoviSchedule} from '../src/sovi-schedule.js';
const month='2026-11';
const rows=Array.from({length:100},(_,i)=>({folio:String(i+1),auditor:i<50?'101':'102'}));
test('100 folios split into stable halves by auditor, independent of RETAIL order',()=>{
  const a=buildSoviSchedule({month,rows}),b=buildSoviSchedule({month,rows:[...rows].reverse()});
  assert.deepEqual(a,b);
  for(const auditor of ['101','102'])for(const group of [1,2])assert.equal(rows.filter(r=>r.auditor===auditor&&a.groups[r.folio]===group).length,25);
  assert.deepEqual([1,2,3,4,5].map(soviGroupForWeek),[1,2,1,2,null]);
  assert.deepEqual([1,2,3,4,5].map(competitionWeek),[true,false,true,false,false]);
});
test('odd routes put the extra folio into the first group',()=>{
  const schedule=buildSoviSchedule({month,rows:rows.slice(0,5)});
  assert.equal(Object.values(schedule.groups).filter(g=>g===1).length,3);
  assert.equal(Object.values(schedule.groups).filter(g=>g===2).length,2);
});
test('a saved month keeps its groups when folios, auditors or row order change',()=>{
  const saved=buildSoviSchedule({month,rows});
  const changed=[{folio:'000',auditor:'101'},...rows.filter(r=>r.folio!=='2').reverse().map(r=>({...r,auditor:r.folio==='51'?'101':r.auditor}))];
  const next=buildSoviSchedule({month,rows:changed,saved});
  for(const[folio,group]of Object.entries(saved.groups))assert.equal(next.groups[folio],group);
  assert.ok([1,2].includes(next.groups['000']));
  assert.equal(buildSoviSchedule({month,rows,saved:next}).groups['2'],saved.groups['2']);
});
test('a new month does not inherit old groups and malformed saved groups cannot silently reshuffle',()=>{
  const saved={version:1,month,groups:{'1':2}};
  assert.equal(buildSoviSchedule({month:'2026-12',rows:rows.slice(0,1),saved}).groups['1'],1);
  assert.throws(()=>buildSoviSchedule({month,rows,saved:{...saved,groups:{'1':3}}}),/inválido/);
  assert.throws(()=>buildSoviSchedule({month,rows,saved:{...saved,version:2}}),/válido/);
});
test('shared calendar is confined to its month and falls back to saved selections',()=>{
  const schedule=buildSoviSchedule({month,rows});
  assert.equal(sharedSoviSchedule({month,metadata:{soviSchedule:schedule}},month),schedule);
  assert.equal(sharedSoviSchedule({month,weeklyPlans:[{result:{soviSchedule:schedule}}]},month),schedule);
  assert.equal(sharedSoviSchedule({month,metadata:{soviSchedule:schedule}},'2026-12'),null);
});
