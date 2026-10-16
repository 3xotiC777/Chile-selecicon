import test from 'node:test';
import assert from 'node:assert/strict';
import {compactSelection,latestSavedPlan,savedPlanningIndex,planningStatusLabel,planningWeekLabel} from '../src/saved-planning.js';
import {buildTracking} from '../src/tracking.js';
import {SOVI,FACING} from '../src/engine.js';
const period={month:'2026-10',week:3,weeks:5,start:'2026-10-12',end:'2026-10-17'};
const selection={period,files:[{rows:[{folio:'001',study:FACING,start:period.start,end:period.end}]}],decisions:[{folio:'001',study:FACING,selected:true,reason:'Facing pendiente'},{folio:'002',study:FACING,selected:false,reason:'Ya seleccionado en SOVI'}]};

test('the last save wins even when an earlier week was corrected later',()=>{
  const plans=[{week:4,updatedAt:'2026-10-16T10:00:00Z'},{week:3,updatedAt:'2026-10-16T12:00:00Z'}];
  assert.equal(latestSavedPlan(plans).week,3);assert.equal(plans[0].week,4);
  assert.equal(latestSavedPlan([{week:2},{week:3}]).week,3);assert.equal(latestSavedPlan(),null);
});

test('saved decisions survive compact serialization with only the audit fields',()=>{
  const source={...selection,decisions:selection.decisions.map(row=>({...row,sourceRow:100}))};
  const compact=JSON.parse(JSON.stringify(compactSelection(source)));
  assert.deepEqual(compact.decisions,selection.decisions);assert.deepEqual(compact.files,selection.files);
  const lookup=savedPlanningIndex(compact),yes=lookup('001',FACING),no=lookup('002',FACING);
  assert.equal(planningStatusLabel(yes),'Sí');assert.equal(yes.notPlannedReason,'');
  assert.equal(planningStatusLabel(no),'No');assert.equal(no.notPlannedReason,'Ya seleccionado en SOVI');
  assert.equal(yes.planningWeek,'Semana 3 de octubre');assert.equal(no.planningWeek,yes.planningWeek);
});

test('legacy missing reasons and absent plans are distinguished without invented exclusions',()=>{
  const legacy=savedPlanningIndex({period,files:selection.files});
  assert.equal(legacy('002',FACING).notPlannedReason,'Motivo no guardado en esta planeación.');
  const none=savedPlanningIndex(null)('001',FACING);
  assert.equal(planningStatusLabel(none),'Sin planeación');assert.equal(none.planningWeek,'Sin planeación');
  assert.equal(none.notPlannedReason,'No hay una planeación guardada.');
  assert.equal(planningWeekLabel({month:'2026-02',week:1}),'Semana 1 de febrero');
  assert.equal(planningWeekLabel({month:'2026-13',week:1}),'Semana no registrada');
  const empty=savedPlanningIndex({period,files:[],decisions:[]})('001',FACING);
  assert.equal(planningStatusLabel(empty),'No');assert.equal(empty.planningWeek,'Semana 3 de octubre');
});

test('Cencosud splits and SOVI consolidation retain the saved membership and reasons',()=>{
  const lookup=savedPlanningIndex({period,files:[{rows:[{folio:'1',study:'CENCOSUD'},...SOVI.map(study=>({folio:'2',study}))]}],decisions:[...SOVI.map(study=>({folio:'3',study,selected:false,reason:'No seleccionado en OSA'})),{folio:'4',study:'CENCOSUD',selected:false,reason:'Ambos estudios completados'}]});
  for(const study of ['PRECIOS CENCOSUD','FOTOGRAFIAS CENCOSUD']){
    assert.equal(lookup('1',study).plannedCurrentWeek,true);
    assert.equal(lookup('4',study).notPlannedReason,'Ambos estudios completados');
  }
  assert.equal(lookup('2','SOVI EMBONOR').plannedCurrentWeek,true);
  assert.equal(lookup('3','SOVI EMBONOR').notPlannedReason,'No seleccionado en OSA');
  assert.equal(lookup('1',FACING).plannedCurrentWeek,false);
});

test('current completions never erase saved programming or rewrite a historical exclusion reason',()=>{
  const planning={rows:['001','002'].map(folio=>({folio,study:FACING,auditor:'1',auditorName:'Ana'})),studies:[]};
  const report=['001','002'].map(folio=>({folio,study:FACING,day:'2026-10-14',status:'TERMINADO',visit:folio}));
  const data=buildTracking({planning,report,options:{...period,savedSelection:selection}});
  const yes=data.points.find(point=>point.folio==='001'),no=data.points.find(point=>point.folio==='002');
  assert.equal(yes.complete,true);assert.equal(planningStatusLabel(yes),'Sí');
  assert.equal(no.complete,true);assert.equal(planningStatusLabel(no),'No');assert.equal(no.notPlannedReason,'Ya seleccionado en SOVI');
  assert.equal(yes.planningWeek,'Semana 3 de octubre');
});
