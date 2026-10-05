import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardScopes,clearDashboardDetailFilters,DEFAULT_DASHBOARD_FILTERS} from '../src/dashboard-filters.js';
import {summarizeTracking} from '../src/tracking.js';

const cvPoint = (index, extra = {}) => ({folio:String(index),client:'CRUZ VERDE',study:'QUIEBRES CRUZ VERDE',auditor:'100',region:'VIII',target:2,validVisits:0,fulfilledVisits:0,remaining:2,complete:false,...extra});

test('viewing the 161 planned pending points preserves monthly progress across all 316 Cruz Verde points',()=>{
  const points=Array.from({length:316},(_,index)=>cvPoint(index,index<155 ? {validVisits:1,fulfilledVisits:1,remaining:1} : {plannedCurrentWeek:true,plannedPending:true}));
  const data={points,daily:[{client:'CRUZ VERDE',study:'QUIEBRES CRUZ VERDE',auditor:'100',day:'2026-10-01',surveys:155,completedSurveys:155}]};
  const scopes=dashboardScopes(data,{client:'CRUZ VERDE',planned:true,status:'unvisited'});
  assert.equal(scopes.points.length,161);
  assert.equal(summarizeTracking(scopes.points).summary.fulfilledVisits,0);
  const monthly=summarizeTracking(scopes.monthlyPoints).summary;
  assert.equal(monthly.points,316);assert.equal(monthly.target,632);assert.equal(monthly.fulfilledVisits,155);assert.ok(monthly.progress>0);
  assert.equal(summarizeTracking(scopes.productivityPoints,scopes.daily).summary.completedSurveys,155);
});

test('detail status and search narrow points without changing monthly totals',()=>{
  const data={points:[cvPoint(1,{complete:true,fulfilledVisits:2,remaining:0,validVisits:2}),cvPoint(2,{empty:1}),cvPoint(3,{region:'V'})]};
  const scopes=dashboardScopes(data,{client:'CRUZ VERDE',region:'VIII',status:'complete',search:'1'});
  assert.deepEqual(scopes.points.map(p=>p.folio),['1']);assert.equal(scopes.monthlyPoints.length,2);assert.equal(scopes.productivityPoints.length,3);
  assert.equal(summarizeTracking(scopes.monthlyPoints).summary.progress,50);
});

test('primary filters apply to monthly points while productivity keeps the auditor who actually submitted the export',()=>{
  const data={points:[cvPoint(1,{auditor:'100'}),cvPoint(2,{auditor:'200'}),cvPoint(3,{client:'EMBONOR'})],daily:[{client:'CRUZ VERDE',study:'QUIEBRES CRUZ VERDE',auditor:'100'},{client:'CRUZ VERDE',study:'QUIEBRES CRUZ VERDE',auditor:'200'}]};
  const scopes=dashboardScopes(data,{client:'CRUZ VERDE',study:'QUIEBRES CRUZ VERDE',auditor:'200',region:'VIII',planned:true});
  assert.deepEqual(scopes.monthlyPoints.map(p=>p.folio),['2']);assert.equal(scopes.points.length,0);assert.equal(scopes.daily.length,1);assert.equal(scopes.daily[0].auditor,'200');
});

test('returning to all monthly points clears only detail filters and does not mutate the previous state',()=>{
  const filters={client:'CRUZ VERDE',study:'QUIEBRES CRUZ VERDE',auditor:'200',region:'VIII',status:'unvisited',search:'Talcahuano',planned:true};
  const cleared=clearDashboardDetailFilters(filters);
  assert.deepEqual(cleared,{...filters,status:'',search:'',planned:false});assert.equal(filters.planned,true);
});

test('search remains accent-insensitive and supports auditor and point location',()=>{
  const data={points:[cvPoint(1,{location:'Almacén Las Águilas'}),cvPoint(2,{auditorName:'María Fuentes'})]};
  assert.deepEqual(dashboardScopes(data,{search:'almacen'}).points.map(p=>p.folio),['1']);
  assert.deepEqual(dashboardScopes(data,{search:'maria'}).points.map(p=>p.folio),['2']);
});

test('empty dashboard data has no retained rows and fresh defaults have no account-specific filters',()=>{
  assert.deepEqual(dashboardScopes(null,{...DEFAULT_DASHBOARD_FILTERS,planned:true}),{monthlyPoints:[],points:[],productivityPoints:[],daily:[]});
  assert.deepEqual({...DEFAULT_DASHBOARD_FILTERS},{client:'',study:'',auditor:'',region:'',status:'',search:'',planned:false});
});
