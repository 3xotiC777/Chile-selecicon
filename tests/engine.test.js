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
function setWeek(f,week){
  const start=['2026-08-31','2026-09-07','2026-09-14','2026-09-21','2026-09-28'][week-1];
  const end=['2026-09-05','2026-09-12','2026-09-19','2026-09-26','2026-10-03'][week-1];
  f.options.week=week;f.hasReport=week>1;
  for(const row of [...f.planning.rows,...f.planning.studies])Object.assign(row,{start,end});
}
test('OSA quincenales split by auditor then select only unfinished points of the half',()=>{
  const f=fixture();f.universe.filter(r=>r.client==='EMBONOR').forEach(r=>r.frequency='QUINCENALES');setWeek(f,1);
  const first=select(f);assert.equal(selected(first,OSA).size,6);
  f.report=[...selected(first,OSA)].map(folio=>visit(OSA,folio,'2026-09-01'));setWeek(f,2);
  const second=selected(select(f),OSA);assert.equal(second.size,4);for(const folio of second)assert(!selected(first,OSA).has(folio));
});

test('full five-week simulation yields exactly one measurement in each half for SOVI and every frequency-2 study',()=>{
  for(const mode of ['fixed','fortnightly','mixed']){
    const f=fixture();
    f.universe.filter(r=>r.client==='EMBONOR'&&(mode==='fortnightly'||mode==='mixed'&&Number(r.folio)<=4)).forEach(r=>r.frequency='QUINCENALES');
    const dates=['2026-09-01','2026-09-08','2026-09-15','2026-09-22','2026-09-29'];
    const scheduled=[];
    for(let week=1;week<=5;week++){
      setWeek(f,week);const r=select(f);scheduled.push(r);
      for(const name of SOVI)assert.deepEqual(selected(r,name),selected(r,SOVI[0]));
      for(const name of REPLICAS)assert.deepEqual(selected(r,name),selected(r,OSA));
      for(const folio of selected(r,SOVI[0]))assert(selected(r,OSA).has(folio));
      f.report.push(...r.files.flatMap(file=>file.rows).map(row=>visit(row.study,row.folio,dates[week-1])));
    }
    for(const half of [0,2]){
      const a=selected(scheduled[half],SOVI[0]),b=selected(scheduled[half+1],SOVI[0]);
      assert.equal(new Set([...a,...b]).size,10);assert([...a].every(folio=>!b.has(folio)));
    }
    assert.equal(selected(scheduled[4],SOVI[0]).size,0);
    const h=buildHistory(f.report,{month:'2026-09',start:'2026-09-30',week:5,aliases:DEFAULT_ALIASES});
    for(const folio of Array.from({length:10},(_,i)=>String(i+1))){
      assert.equal(h.soviCount(folio),2);assert.equal(h.soviHalfCount(folio,1),1);assert.equal(h.soviHalfCount(folio,2),1);
      if(f.universe.find(r=>r.client==='EMBONOR'&&r.folio===folio).frequency==='QUINCENALES'){
        assert.equal(h.count(OSA,folio),2);assert.equal(h.halfCount(OSA,folio,1),1);assert.equal(h.halfCount(OSA,folio,2),1);
      }
      if(f.universe.find(r=>r.client==='CRUZ VERDE'&&r.folio===folio).frequency===2)for(const name of CV){assert.equal(h.count(name,folio),2);assert.equal(h.halfCount(name,folio,1),1);assert.equal(h.halfCount(name,folio,2),1);}
    }
  }
});
test('SOVI closing week selects every unfinished point even if more than half remain',()=>{
  const f=fixture();setWeek(f,2);f.report=[...SOVI.map(s=>visit(s,1,'2026-09-01')),...SOVI.slice(0,7).map(s=>visit(s,2,'2026-09-01'))];
  const chosen=selected(select(f),SOVI[0]);assert.equal(chosen.size,9);assert(!chosen.has('1'));assert(chosen.has('2'));
});
test('all SOVI are blocked once their current half is complete, even with fewer than two monthly visits',()=>{
  const f=fixture();setWeek(f,4);f.report=SOVI.map(s=>visit(s,1,'2026-09-15'));
  const r=select(f);assert(!selected(r,SOVI[0]).has('1'));const d=r.decisions.find(r=>r.study===SOVI[0]&&r.folio==='1');assert.equal(d.visitsFirstHalf,0);assert.equal(d.visitsSecondHalf,1);assert.match(d.reason,/no repetir/);
});
test('quincenales and CV frequency 2 do not duplicate a completed current half',()=>{
  const f=fixture();setWeek(f,4);f.universe.find(r=>r.client==='EMBONOR'&&r.folio==='1').frequency='QUINCENALES';f.report=[OSA,...CV].map(s=>visit(s,1,'2026-09-15'));
  const r=select(f);for(const s of [OSA,...CV])assert(!selected(r,s).has('1'));
});
test('two SOVI visits in the first half do not cause a third in the second; anomaly is visible',()=>{
  const f=fixture();setWeek(f,3);f.report=['2026-09-01','2026-09-08'].flatMap(d=>SOVI.map(s=>visit(s,1,d)));
  const r=select(f);assert(!selected(r,SOVI[0]).has('1'));assert(r.warnings.some(w=>w.includes('más de una medición')));
});
test('month boundaries use operational weeks instead of the 15th calendar day',()=>{
  const h=buildHistory([visit(OSA,1,'2026-09-13'),visit(OSA,2,'2026-09-14')],{month:'2026-09',start:'2026-09-21',week:4,aliases:DEFAULT_ALIASES});
  assert.equal(h.secondHalfStart,'2026-09-14');assert.equal(h.halfCount(OSA,'1',1),1);assert.equal(h.halfCount(OSA,'2',2),1);
});
test('closing SOVI cannot break OSA dependency when OSA is already completed',()=>{
  const f=fixture();setWeek(f,2);f.universe.find(r=>r.client==='EMBONOR'&&r.folio==='1').frequency='QUINCENALES';f.report=[visit(OSA,1,'2026-09-01')];
  const r=select(f);assert(!selected(r,OSA).has('1'));assert(!selected(r,SOVI[0]).has('1'));assert(r.warnings.some(w=>w.includes('SOVI pendientes')));
});
test('uneven CHECKOUT subset must not halve OSA quincenales again and strand them the following week',()=>{
  const f=fixture();f.universe.filter(r=>r.client==='EMBONOR').forEach(r=>r.frequency='QUINCENALES');
  f.planning.rows=f.planning.rows.filter(r=>!(r.study===SOVI[7]&&['4','5'].includes(r.folio)));
  setWeek(f,1);const first=select(f);
  for(const folio of ['1','2','3'])assert(selected(first,SOVI[0]).has(folio));
  f.report=first.files.flatMap(file=>file.rows).map(row=>visit(row.study,row.folio,'2026-09-01'));
  setWeek(f,2);const second=select(f);
  assert.equal(new Set([...selected(first,SOVI[0]),...selected(second,SOVI[0])]).size,8);
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
