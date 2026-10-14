import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {buildTracking} from '../src/tracking.js';
import {progressSheets,progressWorkbook,weeklyStateLabel} from '../src/tracking-export.js';
import {OSA,SOVI,FACING} from '../src/engine.js';

const options={month:'2026-10',week:2,weeks:5,start:'2026-10-05',end:'2026-10-10',monthRange:{start:'2026-09-28',end:'2026-10-31'}};
const planning=rows=>({studies:[],rows:rows.map(row=>({auditor:'001',auditorName:'Ana',...row}))});
let visitId=0;
const visit=(folio,study,day,status='TERMINADO',extra={})=>({folio,study,day,status,visit:String(++visitId),...extra});
const track=(rows,report=[],extra={})=>buildTracking({planning:planning(rows),report,options,...extra});
const column=(model,key)=>model.columns.findIndex(([name])=>name===key);

test('weekly states include September in October, preserve failures, and deduplicate visits',()=>{
  const v=visit('001',OSA,'2026-09-28');
  const data=track([{folio:'001',study:OSA}],[v,v,visit('001',OSA,'2026-10-05','RECHAZO'),visit('001',OSA,'2026-10-06','VACIO'),visit('001',OSA,'2026-10-12','PAUSADO'),visit('001',OSA,'2026-09-27')],{universe:[{client:'EMBONOR',folio:'001',frequency:'FIJA'}]});
  assert.equal(data.quality.duplicates,1);
  assert.equal(data.points[0].weekStates[0].completed,1);
  const model=progressSheets(data.points,data.period)[0],row=model.rows[0];
  assert.equal(row[column(model,'week:2026-09-28')],'TERMINADO');
  assert.equal(row[column(model,'week:2026-10-05')],'RECHAZO / VACIO');
  assert.equal(row[column(model,'week:2026-10-12')],'PAUSADO');
  assert.equal(row[column(model,'week:2026-10-19')],'SIN REGISTROS');
  assert.match(model.columns[column(model,'week:2026-09-28')][1],/28\/09\/2026 al 04\/10\/2026/);
  assert.match(model.columns[column(model,'week:2026-10-26')][1],/31\/10\/2026/);
});

test('completed weeks are factual even when only one fulfills a fortnightly quota',()=>{
  const data=track([{folio:'1',study:OSA}],['2026-09-28','2026-10-05'].map(day=>visit('1',OSA,day)),{universe:[{client:'EMBONOR',folio:'1',frequency:'QUINCENALES'}]});
  assert.deepEqual(data.points[0].weekStates.map(weeklyStateLabel),['TERMINADO','TERMINADO']);
  assert.equal(data.points[0].fulfilledVisits,1);assert.equal(data.points[0].remaining,1);
});

test('SOVI reports partial components per week and requires eight distinct studies to finish',()=>{
  const reports=SOVI.slice(0,7).map(study=>visit('1',study,'2026-09-29'));
  reports.push(visit('1',SOVI[0],'2026-09-30'),visit('1',SOVI[7],'2026-10-01','RECHAZO'));
  reports.push(...SOVI.map(study=>visit('1',study,'2026-10-06')));
  const data=track(SOVI.map(study=>({folio:'1',study})),reports);
  assert.equal(data.points.length,1);
  assert.deepEqual(data.points[0].weekStates.map(weeklyStateLabel),['PARCIAL SOVI (7/8) / RECHAZO','TERMINADO']);
  assert.equal(data.points[0].fulfilledVisits,1);
});

test('undated failures never acquire a week; scheduled VACIO does not invent field activity',()=>{
  const data=track([{folio:'1',study:FACING}],[visit('1',FACING,'','RECHAZO'),visit('1',FACING,'','VACIO'),visit('1',FACING,'2026-10-06','VACIO',{scheduledOnly:true})]);
  const point=data.points[0];
  assert.equal(point.weekStates.length,1);assert.equal(weeklyStateLabel(point.weekStates[0]),'VACIO');
  assert.equal(point.lastVisit,null);assert.equal(point.undatedEmpty,1);assert.equal(point.undatedRejected,1);
  assert.equal(data.daily.length,0);assert.equal(point.validVisits,0);
});

test('weekly states respect confirmed range, as-of and independent study/client boundaries',()=>{
  const data=track([{folio:'1',study:OSA},{folio:'1',study:'QUIEBRES CRUZ VERDE'}],[visit('1',OSA,'2026-09-30'),visit('1',OSA,'2026-10-01'),visit('1','QUIEBRES CRUZ VERDE','2026-10-06')],{options:{...options,monthRange:{start:'2026-10-01',end:'2026-10-31'},asOf:'2026-10-05'}});
  const models=progressSheets(data.points,data.period);
  assert.deepEqual(models.map(model=>model.name),['CRUZ VERDE','EMBONOR']);
  assert.equal(models[0].rows[0][column(models[0],'week:2026-10-05')],'SIN REGISTROS');
  assert.match(models[1].columns[column(models[1],'week:2026-09-28')][1],/01\/10\/2026/);
  assert.equal(data.points.find(point=>point.study===OSA).weekStates[0].completed,1);
});

test('export rejects empty filters and legacy snapshots instead of guessing weekly states',()=>{
  const data=track([{folio:'1',study:FACING}]);
  assert.throws(()=>progressSheets([],data.period),/No hay puntos/);
  const legacy={...data.points[0]};delete legacy.weekStates;
  assert.throws(()=>progressSheets([legacy],data.period),/Actualiza/);
});

test('Excel has one tab per client, typed identifiers/dates/percentages, styles, filters and frozen headers',async()=>{
  const data=track([{folio:'0001',study:FACING,auditorName:'=2+2',address:'Av. A & B',office:'Santiago',measurementDay:'LUNES'},{folio:'0001',study:'QUIEBRES CRUZ VERDE'}],[visit('0001',FACING,'2026-10-01')]);
  const bytes=await progressWorkbook(data.points,data.period,{filters:{search:'0001'}});
  const book=XLSX.read(bytes,{type:'array',cellDates:true,cellStyles:true});
  assert.deepEqual(book.SheetNames,['CRUZ VERDE','EMBONOR']);
  const sheet=book.Sheets.EMBONOR,model=progressSheets(data.points,data.period)[1];
  const cell=key=>sheet[XLSX.utils.encode_cell({r:6,c:column(model,key)})];
  assert.equal(cell('folio').v,'0001');assert.equal(cell('auditor').v,'001');
  assert.equal(cell('auditorName').v,'=2+2');assert.equal(cell('auditorName').f,undefined);
  assert.equal(cell('address').v,'Av. A & B');assert.equal(cell('office').v,'Santiago');
  assert.equal(cell('progress').v,1);assert.equal(cell('progress').z,'0.00%');
  assert.equal(cell('lastVisit').v.toISOString().slice(0,10),'2026-10-01');
  assert.equal(cell('target').t,'n');assert.equal(cell('week:2026-09-28').v,'TERMINADO');
  assert.match(sheet.A3.v,/Búsqueda: 0001/);
  assert.equal(sheet['!autofilter'].ref,`A6:${XLSX.utils.encode_col(model.columns.length-1)}7`);
  const zip=await JSZip.loadAsync(bytes);
  for(const file of Object.values(zip.files).filter(file=>file.name.endsWith('.xml'))){
    const errors=[];new DOMParser({onError:(level,message)=>errors.push(message)}).parseFromString(await file.async('string'),'application/xml');
    assert.deepEqual(errors,[],file.name);
  }
  const xml=await zip.file('xl/worksheets/sheet2.xml').async('string');
  assert.match(xml,/<pane xSplit="2" ySplit="6"/);assert.match(xml,/state="frozen"/);
  assert.match(xml,/<c r="N7"[^>]*s="4"/);
});

test('filtered exports omit other clients and sanitize colliding worksheet names',async()=>{
  const data=track([{folio:'1',study:FACING}]);
  const filtered=await progressWorkbook(data.points,data.period);
  assert.deepEqual(XLSX.read(filtered).SheetNames,['EMBONOR']);
  const models=progressSheets(['A/B','A:B','a:b',"'Client'"] .map(client=>({...data.points[0],client})),data.period);
  assert.equal(new Set(models.map(model=>model.name.toUpperCase())).size,4);
  assert.ok(models.every(model=>model.name.length<=31&&!/[\[\]:*?/\\]/.test(model.name)));
});
