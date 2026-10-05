import test from 'node:test';
import assert from 'node:assert/strict';
import {sortDashboardRows,pointStatusLabel,DASHBOARD_SORT_COLUMNS} from '../src/dashboard-sort.js';

const ids = rows => rows.map(row => row.folio || row.auditor);
test('numeric auditor columns order 2 before 10 and toggle direction without changing the source',()=>{
  const rows = [{auditor:'a',auditorName:'A',surveys:10},{auditor:'b',auditorName:'B',surveys:2}];
  const snapshot = structuredClone(rows);
  assert.deepEqual(ids(sortDashboardRows(rows,'auditors','surveys')),['b','a']);
  assert.deepEqual(ids(sortDashboardRows(rows,'auditors','surveys','desc')),['a','b']);
  assert.deepEqual(rows,snapshot);
  assert.equal(sortDashboardRows(rows,'auditors','surveys')[0],rows[1]);
});
test('all numeric auditor columns use numbers and zero remains a real value',()=>{
  for (const key of DASHBOARD_SORT_COLUMNS.auditors.filter(key=>key!=='name')) {
    const rows = [{auditor:'a',[key]:'10'},{auditor:'b',[key]:'2'},{auditor:'c',[key]:0}];
    assert.deepEqual(ids(sortDashboardRows(rows,'auditors',key)),['c','b','a'],key);
  }
});
test('nullable minutes, targets and remaining values stay last ascending and descending',()=>{
  for (const [table,key] of [['auditors','averageMinutes'],['points','target'],['points','remaining']]) {
    const rows = [{folio:'none',[key]:null},{folio:'ten',[key]:10},{folio:'two',[key]:2},{folio:'empty',[key]:''},{folio:'invalid',[key]:'NaN'}].map(row=>({...row,auditor:row.folio}));
    assert.deepEqual(ids(sortDashboardRows(rows,table,key)),['two','ten','empty','invalid','none']);
    assert.deepEqual(ids(sortDashboardRows(rows,table,key,'desc')),['ten','two','empty','invalid','none']);
  }
});
test('Spanish names and folios sort naturally with numeric codes as tie breakers',()=>{
  const rows = [{auditor:'10',auditorName:'Ángela 10'},{auditor:'2',auditorName:'Ángela 2'},{auditor:'3',actualName:'Beatriz'}];
  assert.deepEqual(ids(sortDashboardRows(rows,'auditors','name')),['2','10','3']);
  const sameName = [{folio:'10',auditorName:'Ana',auditor:'10'},{folio:'2',auditorName:'Ana',auditor:'2'}];
  assert.deepEqual(ids(sortDashboardRows(sameName,'points','auditor')),['2','10']);
  assert.deepEqual(ids(sortDashboardRows([{folio:'10'},{folio:'2'}],'points','folio')),['2','10']);
});
test('point studies distinguish repeated SOVI and non-SOVI folios with deterministic ties',()=>{
  const a={folio:'12',study:'SOVI EMBONOR',fulfilledVisits:1};
  const b={folio:'12',study:'OSA BEBESTIBLES',fulfilledVisits:1};
  const c={folio:'2',study:'SOVI EMBONOR',fulfilledVisits:1};
  assert.deepEqual(sortDashboardRows([a,b,c],'points','fulfilledVisits'),[c,b,a]);
  assert.deepEqual(sortDashboardRows([b,c,a],'points','fulfilledVisits','desc'),[c,b,a]);
  assert.deepEqual(sortDashboardRows([a,b],'points','folio'),[b,a]);
});
test('identical keys retain stable input order',()=>{
  const rows=[{folio:'1',study:'SOVI EMBONOR',target:2,marker:'first'},{folio:'1',study:'SOVI EMBONOR',target:2,marker:'second'}];
  assert.deepEqual(sortDashboardRows(rows,'points','target','desc').map(row=>row.marker),['first','second']);
});
test('last visit dates order chronologically and missing or invalid dates stay last',()=>{
  const rows=[{folio:'unknown',lastVisit:null},{folio:'october',lastVisit:'2026-10-03'},{folio:'september',lastVisit:'2026-09-28'},{folio:'invalid',lastVisit:'2026-02-30'}];
  assert.deepEqual(ids(sortDashboardRows(rows,'points','lastVisit')),['september','october','invalid','unknown']);
  assert.deepEqual(ids(sortDashboardRows(rows,'points','lastVisit','desc')),['october','september','invalid','unknown']);
});
test('point status follows exactly the displayed label and its precedence',()=>{
  assert.equal(pointStatusLabel({target:null,complete:true}),'Sin meta configurada');
  assert.equal(pointStatusLabel({target:2,complete:true,rejected:1}),'Cumplido');
  assert.equal(pointStatusLabel({target:2,rejected:1,empty:1,validVisits:1}),'Con rechazo');
  assert.equal(pointStatusLabel({target:2,empty:1,validVisits:1}),'Con visita vacía');
  assert.equal(pointStatusLabel({target:2,validVisits:1}),'En avance');
  assert.equal(pointStatusLabel({target:2,validVisits:0}),'Sin visita válida');
  const rows=[{folio:'unvisited',target:2},{folio:'complete',target:2,complete:true},{folio:'rejected',target:2,rejected:1}];
  assert.deepEqual(ids(sortDashboardRows(rows,'points','status')),['rejected','complete','unvisited']);
});
test('vacías/rechazos sorts by the visible first number then second number, numerically',()=>{
  const rows=[{folio:'a',empty:10,rejected:0},{folio:'b',empty:2,rejected:10},{folio:'c',empty:2,rejected:2}];
  assert.deepEqual(ids(sortDashboardRows(rows,'points','failures')),['c','b','a']);
  assert.deepEqual(ids(sortDashboardRows(rows,'points','failures','desc')),['a','b','c']);
});
test('planning states sort completed, pending and unassigned and reverse on descending',()=>{
  const rows=[{folio:'none',plannedCurrentWeek:false},{folio:'pending',plannedCurrentWeek:true,currentWeekCompleted:false},{folio:'done',plannedCurrentWeek:true,currentWeekCompleted:true}];
  assert.deepEqual(ids(sortDashboardRows(rows,'points','planned')),['done','pending','none']);
  assert.deepEqual(ids(sortDashboardRows(rows,'points','planned','desc')),['none','pending','done']);
});
test('survey empty and rejection columns support the original count names',()=>{
  const rows=[{auditor:'a',empty:10,rejected:2},{auditor:'b',empty:2,rejected:10}];
  assert.deepEqual(ids(sortDashboardRows(rows,'auditors','surveyEmpty')),['b','a']);
  assert.deepEqual(ids(sortDashboardRows(rows,'auditors','surveyRejected')),['a','b']);
});
test('the sorter rejects unsupported table columns and never invents one',()=>{
  assert.throws(()=>sortDashboardRows([],'points','unknown'),/columna/);
  assert.throws(()=>sortDashboardRows([],'points','constructor'),/columna/);
  assert.throws(()=>sortDashboardRows([],'constructor','name'),/columna/);
  assert.throws(()=>sortDashboardRows(null,'points','folio'),/lista/);
});
