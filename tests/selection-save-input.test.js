import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionSaveInput,sameData} from '../src/selection-save-input.js';

const period={month:'2026-10',week:4,weeks:5,start:'2026-10-19',end:'2026-10-24',operationalStart:'2026-09-28',operationalEnd:'2026-10-31'};
function fixture(){
  const planning={rows:[{folio:'1',auditor:'2',study:'POY',start:'2026-10-19'}],studies:[{name:'POY'}],points:[{folio:'1',sourceRow:8}]};
  const universe=[{folio:'1',frequency:'SEMANAL'}],report=[{folio:'1',study:'POY',day:'2026-10-13',status:'TERMINADO'}];
  const draft={planning,universe,report,options:{},workspaceRevision:7,metadata:{reportName:'SQL Server'},result:{period,files:[{name:'POY.csv',rows:[{folio:'1'}]}],decisions:[{folio:'1',study:'POY',selected:true,reason:'Pendiente'}]}};
  return {draft,workspace:{month:period.month,planning,universe,report,revision:7}};
}
test('a weekly save sends only the selection when the monthly inputs have not changed',()=>{
  const {draft,workspace}=fixture(),before=JSON.stringify(workspace);
  const input=selectionSaveInput(draft,workspace);
  assert.equal(input.planning,null);assert.equal(input.universe,null);assert.equal(input.report,null);
  assert.equal(input.selection.period.week,4);assert.equal(input.selection.decisions.length,1);
  assert.equal(input.revision,7);assert.equal(JSON.stringify(workspace),before);
});
test('JSONB key order and parser-only markers do not cause another full base upload',()=>{
  const {draft,workspace}=fixture();
  workspace.planning={...workspace.planning,sourceType:'retail',canGenerate:true,rows:[{start:'2026-10-19',study:'POY',auditor:'2',folio:'1'}]};
  workspace.report=[{status:'TERMINADO',day:'2026-10-13',study:'POY',folio:'1'}];
  assert.equal(selectionSaveInput(draft,workspace).planning,null);
  assert.equal(selectionSaveInput(draft,workspace).report,null);
  assert.equal(sameData([1,2],[2,1]),false);
});
test('changed weekly dates, auditor corrections and exclusions are still persisted',()=>{
  const {draft,workspace}=fixture();workspace.planning=structuredClone(workspace.planning);
  workspace.planning.rows[0].start='2026-10-05';
  assert.equal(selectionSaveInput(draft,workspace).planning.rows[0].start,'2026-10-19');
  draft.options.auditorOverrides={'1':'3'};
  assert.equal(selectionSaveInput(draft,workspace).planning.rows[0].auditor,'3');
  draft.options.excludedFolios=['1'];
  assert.deepEqual(selectionSaveInput(draft,workspace).planning.rows,[]);
});
test('new reports, frequencies and month changes are not silently dropped',()=>{
  const {draft,workspace}=fixture();draft.report=[...draft.report,{folio:'1',day:'2026-10-14',status:'RECHAZO'}];
  draft.universe=[{folio:'1',frequency:'QUINCENAL'}];
  let input=selectionSaveInput(draft,workspace);assert.equal(input.report.length,2);assert.equal(input.universe[0].frequency,'QUINCENAL');
  workspace.month='2026-09';input=selectionSaveInput(draft,workspace);
  assert.ok(input.planning);assert.ok(input.universe);assert.ok(input.report);
});
test('the monthly filter is retained and a newer workspace cannot replace the draft revision',()=>{
  const {draft,workspace}=fixture();workspace.revision=8;
  draft.report=[...draft.report,{folio:'1',day:'2026-11-01'}];
  const input=selectionSaveInput(draft,workspace);
  assert.equal(input.report,null);assert.equal(input.revision,7);
});
