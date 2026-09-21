import test from 'node:test';
import assert from 'node:assert/strict';
import {select,buildHistory,csvRows,isoDate,DEFAULT_ALIASES,OSA,REPLICAS,SOVI,FACING,CV,MONTHLY} from '../src/engine.js';
const names=[OSA,...REPLICAS,...SOVI,FACING,...CV,...MONTHLY,'POY','FERIAS LIBRES'];
function fixture(){
  const studies=names.map((name,i)=>({name,studyId:String(i+100),start:'2026-09-21',end:'2026-09-26'}));
  const rows=studies.flatMap(s=>Array.from({length:10},(_,i)=>({folio:String(i+1),auditor:i<5?'101':'102',auditorName:i<5?'Auditor A':'Auditor B',study:s.name,studyId:s.studyId,start:s.start,end:s.end,sourceRow:i+8})));
  const universe=['EMBONOR','CRUZ VERDE'].flatMap(client=>Array.from({length:10},(_,i)=>({folio:String(i+1),client,frequency:client==='EMBONOR'?'FIJA':2+(i%3)})));
  return {planning:{studies,rows},universe,report:[],hasReport:true,options:{month:'2026-09',week:3,weeks:5,holidays:0}};
}
function visit(study,folio,day='2026-09-08',extra={}){return {visit:`${study}-${folio}-${day}`,folio:String(folio),study:DEFAULT_ALIASES[study]||study,day,status:'TERMINADO',...extra};}
function selected(result,name){return new Set(result.files.flatMap(f=>f.rows).filter(r=>r.study===name).map(r=>r.folio));}
test('first week works without report and keeps OSA replicas and 8 SOVI identical',()=>{
  const f=fixture();f.options.week=1;f.hasReport=false;const r=select(f);
  assert.equal(selected(r,OSA).size,10);
  for(const n of REPLICAS)assert.deepEqual(selected(r,n),selected(r,OSA));
  assert.equal(selected(r,SOVI[0]).size,6);
  for(const n of SOVI)assert.deepEqual(selected(r,n),selected(r,SOVI[0]));
  assert.equal(selected(r,FACING).size,4);
  assert.equal(r.files.filter(f=>f.name.startsWith('SOVI')).length,1);
  assert.equal(r.files.find(f=>f.name==='SOVI EMBONOR.csv').rows.length,48);
});
test('week 2 requires the report',()=>{const f=fixture();f.options.week=2;f.hasReport=false;assert.throws(()=>select(f),/export/);});
test('only TERMINADO in selected month and before planning start counts; duplicate IDs count once',()=>{
  const h=buildHistory([visit(OSA,1),visit(OSA,1),visit(OSA,1,'2026-08-08'),visit(OSA,1,'2026-09-21'),visit(OSA,1,'2026-09-10',{status:'RECHAZO'}),visit(OSA,1,'2026-09-11',{status:'VACIO'})],{month:'2026-09',start:'2026-09-21',aliases:DEFAULT_ALIASES});
  assert.equal(h.count(OSA,'1'),1);assert.equal(h.stats.duplicates,1);assert.equal(h.stats.ignoredStatus,2);assert.equal(h.stats.ignoredPeriod,2);
});
test('SOVI can span days of the same week, but never different weeks',()=>{
  const visits=SOVI.map((s,i)=>visit(s,1,i<4?'2026-09-07':'2026-09-12'));
  visits.push(...SOVI.map((s,i)=>visit(s,2,i<4?'2026-09-07':'2026-09-15')));
  const h=buildHistory(visits,{month:'2026-09',start:'2026-09-21',aliases:DEFAULT_ALIASES});
  assert.equal(h.soviCount('1'),1);assert.equal(h.soviCount('2'),0);
});
test('SOVI counts complete visits from every elapsed week, and repeated components are not extra visits',()=>{
  const visits=['2026-09-01','2026-09-08'].flatMap(d=>SOVI.map(s=>visit(s,1,d)));
  visits.push(...SOVI.map(s=>visit(s,1,'2026-09-09')));
  const h=buildHistory(visits,{month:'2026-09',start:'2026-09-21',aliases:DEFAULT_ALIASES});assert.equal(h.soviCount('1'),2);
});
test('eight records from seven different SOVI are incomplete',()=>{
  const visits=SOVI.slice(0,7).map(s=>visit(s,1));visits.push(visit(SOVI[0],1,'2026-09-09'));
  const h=buildHistory(visits,{month:'2026-09',start:'2026-09-21',aliases:DEFAULT_ALIASES});assert.equal(h.soviCount('1'),0);
});
test('quincenales use first-half quota 1 and second-half quota 2',()=>{
  for(const week of [1,2,3,4,5]){
    const f=fixture();f.options.week=week;f.universe.filter(r=>r.client==='EMBONOR').forEach(r=>r.frequency='QUINCENALES');
    f.report=[visit(OSA,2),visit(OSA,3),visit(OSA,3,'2026-09-15')];
    const chosen=selected(select(f),OSA);assert(chosen.has('1'));assert.equal(chosen.has('2'),week>=3);assert(!chosen.has('3'));
  }
});
test('SOVI quincenal needs a full eight-study visit to meet quota',()=>{
  const f=fixture();f.options.week=2;f.universe.filter(r=>r.client==='EMBONOR').forEach(r=>r.frequency='QUINCENALES');
  f.report=[...SOVI.map(s=>visit(s,1)),...SOVI.slice(0,7).map(s=>visit(s,2))];
  const r=select(f);assert(!selected(r,SOVI[0]).has('1'));assert(selected(r,SOVI[0]).has('2'));
});
test('one and two holidays reduce only fixed OSA using 17%, with fewer visits first',()=>{
  for(const [holidays,target] of [[0,10],[1,8],[2,7]]){
    const f=fixture();f.options.holidays=holidays;f.report=[visit(OSA,1),visit(OSA,2)];const r=select(f);
    assert.equal(r.metrics.fixedTarget,target);assert.equal(selected(r,OSA).size,target);
    if(holidays)assert(!selected(r,OSA).has('1'));
    for(const s of SOVI)for(const folio of selected(r,s))assert(selected(r,OSA).has(folio));
  }
});
test('holiday reduction leaves eligible quincenales intact',()=>{
  const f=fixture();f.options.holidays=2;f.universe.find(r=>r.client==='EMBONOR'&&r.folio==='1').frequency='QUINCENALES';
  const r=select(f);assert.equal(r.metrics.fixedTarget,6);assert.equal(selected(r,OSA).size,7);assert(selected(r,OSA).has('1'));
});
test('SOVI fixed quota rounds up independently for each auditor and prioritizes zero visits',()=>{
  const f=fixture();f.report=SOVI.map(s=>visit(s,1));const r=select(f);
  assert(!selected(r,SOVI[0]).has('1'));assert.deepEqual(r.soviAuditors.map(a=>a.selected),[3,3]);
});
test('points missing CHECKOUT stay in OSA and are excluded from all SOVI',()=>{
  const f=fixture();f.planning.rows=f.planning.rows.filter(r=>!(r.study===SOVI[7]&&r.folio==='1'));
  const r=select(f);assert(selected(r,OSA).has('1'));for(const s of SOVI)assert(!selected(r,s).has('1'));assert(selected(r,FACING).has('1'));
});
test('Facing avoids SOVI normally and overlaps only during the declared last week',()=>{
  const f=fixture();f.report=[visit(FACING,10)];let r=select(f);for(const folio of selected(r,FACING))assert(!selected(r,SOVI[0]).has(folio));
  f.options.week=5;r=select(f);assert.equal(selected(r,FACING).size,9);assert(r.metrics.facingExceptions>0);assert(!selected(r,FACING).has('10'));
  f.options.week=4;f.options.weeks=4;r=select(f);assert.equal(selected(r,FACING).size,9);
});
test('Facing always requires OSA, including last week; unreachable points are reported',()=>{
  const f=fixture();f.options.week=5;f.options.holidays=2;const r=select(f);for(const folio of selected(r,FACING))assert(selected(r,OSA).has(folio));assert(r.warnings.some(w=>w.includes('siguen pendientes')));
});
test('Cruz Verde counts each study separately and observes frequencies 2,3,4',()=>{
  const f=fixture();for(let folio=1;folio<=3;folio++)for(let d=1;d<=folio+1;d++)f.report.push(visit(CV[0],folio,`2026-09-0${d}`));
  const r=select(f);for(const folio of ['1','2','3']){assert(!selected(r,CV[0]).has(folio));assert(selected(r,CV[1]).has(folio));}
});
test('Colgate is monthly and POY / FERIAS are complete',()=>{
  const f=fixture();f.report=MONTHLY.map(s=>visit(s,1));const r=select(f);for(const s of MONTHLY){assert.equal(selected(r,s).size,9);assert(!selected(r,s).has('1'));}assert.equal(selected(r,'POY').size,10);assert.equal(selected(r,'FERIAS LIBRES').size,10);
});
test('missing frequencies and conflicting universe keys block output',()=>{
  const f=fixture();f.universe=f.universe.filter(r=>!(r.client==='EMBONOR'&&r.folio==='1'));assert.throws(()=>select(f),/frecuencias/);
  const g=fixture();g.universe.push({folio:'1',client:'EMBONOR',frequency:'QUINCENALES'});assert.throws(()=>select(g),/frecuencias/);
});
test('replication cannot silently drop an OSA folio',()=>{const f=fixture();f.planning.rows=f.planning.rows.filter(r=>!(r.study===REPLICAS[0]&&r.folio==='1'));assert.throws(()=>select(f),/replicar/);});
test('duplicates, unsupported studies and missing SOVI studies block output',()=>{
  const f=fixture();f.planning.rows.push(f.planning.rows[0]);assert.throws(()=>select(f),/duplicados/);
  const g=fixture();g.planning.studies.push({name:'NUEVO ESTUDIO'});assert.throws(()=>select(g),/sin una regla/);
  const h=fixture();h.planning.studies=h.planning.studies.filter(s=>s.name!==SOVI[7]);h.planning.rows=h.planning.rows.filter(s=>s.study!==SOVI[7]);assert.throws(()=>select(h),/ocho estudios/);
});
test('manual exclusion removes a point from every study and is disclosed',()=>{
  const f=fixture();f.options.excludedFolios=['1'];f.planning.rows.filter(r=>r.folio==='1').forEach(r=>r.auditor='x|x|');const r=select(f);assert(!r.files.flatMap(f=>f.rows).some(r=>r.folio==='1'));assert(r.warnings.some(w=>w.includes('Exclusión manual')));
});
test('auditor correction applies to every study without changing planning source',()=>{
  const f=fixture();f.planning.rows.filter(r=>r.folio==='1').forEach(r=>r.auditor='x|x|');f.options.auditorOverrides={'1':'428'};const r=select(f);assert(r.files.flatMap(f=>f.rows).filter(r=>r.folio==='1').every(r=>r.auditor==='428'));assert.equal(f.planning.rows[0].auditor,'x|x|');assert(r.warnings.some(w=>w.includes('428')));
});
test('date parsing validates calendar dates and csv matches six-column semicolon format',()=>{
  assert.equal(isoDate('21/09/2026'),'2026-09-21');assert.equal(isoDate('2026-02-30'),null);assert.equal(isoDate('31/02/2026'),null);
  assert.equal(csvRows([{folio:'0012',auditor:'101',studyId:'535',start:'2026-09-21',end:'2026-09-26'}]),'0012;101;535;21/09/2026;21/09/2026;26/09/2026\r\n');assert.equal(csvRows([]),'');
});
