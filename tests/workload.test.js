import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBalanced,pointLoads,summarizeWorkload,workloadCsv } from '../src/workload.js';

const route=(auditor,n,offset=0)=>Array.from({length:n},(_,i)=>({auditor,folio:String(offset+i+1),auditorName:`Auditor ${auditor}`,study:'OSA BEBESTIBLES'}));
test('equal visit priority fills routes evenly despite clustered folio numbers',()=>{
  const rows=[...route('1',10),...route('2',10,100),...route('3',10,200)];
  const chosen=chooseBalanced(rows,20,()=>0);
  const loads=pointLoads(rows.filter(r=>chosen.has(r.folio)));
  assert.deepEqual([...loads.values()].map(p=>p.size),[7,7,6]);
  assert.deepEqual(chooseBalanced([...rows].reverse(),20,()=>0),chosen);
});
test('balancing accounts for committed points in other studies and quincenal OSA',()=>{
  const rows=[...route('1',10),...route('2',10,100)];
  const committed=route('1',6,300).map(r=>({...r,study:'POY'}));
  const chosen=chooseBalanced(rows,8,()=>0,committed);
  const loads=pointLoads([...committed,...rows.filter(r=>chosen.has(r.folio))]);
  assert.deepEqual([...loads.values()].map(p=>p.size),[7,7]);
});
test('fewer completed visits take precedence over equal route sizes',()=>{
  const rows=[...route('1',5),...route('2',5,100)];
  const chosen=chooseBalanced(rows,4,f=>Number(f)>100?1:0,route('1',10,300));
  assert.deepEqual([...chosen],['1','2','3','4']);
});
test('exhausted routes do not prevent meeting the exact global sample',()=>{
  const rows=[...route('1',1),...route('2',10,100)];
  const chosen=chooseBalanced(rows,7,()=>0);
  assert.equal(chosen.size,7);assert(chosen.has('1'));
  assert.equal(chooseBalanced(rows,0,()=>0).size,0);
  assert.equal(chooseBalanced(rows,rows.length,()=>0).size,rows.length);
});
test('load counts a repeated point once while retaining study row totals and zero-load auditors',()=>{
  const rows=[...route('1',1),...route('2',1,100)];
  const selected=[rows[0],...Array.from({length:8},(_,i)=>({...rows[0],study:`SOVI ${i}`}))];
  const load=summarizeWorkload([...rows,...selected],selected);
  assert.deepEqual(load.map(r=>[r.base,r.points,r.assignments,r.osa,r.sovi]),[[1,1,9,1,1],[1,0,0,0,0]]);
  assert.equal(pointLoads(selected).get('1').size,1);
  assert.match(workloadCsv(load),/PUNTOS_SELECCIONADOS/);
  assert.match(workloadCsv([{...load[0],name:'Ana; "Norte"'}]),/"Ana; ""Norte"""/);
});
