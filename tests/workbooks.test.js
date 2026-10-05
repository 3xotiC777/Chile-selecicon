import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {parsePlanning,parseUniverse,parseReport,parseTrackingPlanning} from '../src/workbooks.js';
function book(rows,name){const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),name);return XLSX.write(w,{type:'buffer',bookType:'xlsx'});}
test('reads planning study headers, flags, dates and end-of-data sentinel',()=>{
  const rows=Array.from({length:10},()=>[]);rows[1][18]=46286;rows[2][18]=46291;rows[5][18]=525;rows[6][1]='FOLIOS';rows[6][18]='OSA BEBESTIBLES';rows[6][19]='TOTAL';rows[7][1]='0001';rows[7][15]=100;rows[7][16]='AUDITOR';rows[7][18]=1;rows[9][1]=2;rows[9][18]=1;
  const p=parsePlanning(book(rows,'RETAIL'));assert.equal(p.rows.length,1);assert.equal(p.rows[0].folio,'0001');assert.equal(p.rows[0].studyId,'525');assert.equal(p.rows[0].auditor,'100');assert.equal(p.rows[0].start,'2026-09-21');
});
test('finds universe headers and preserves identifier strings',()=>{const u=parseUniverse(book([['Title'],['FOLIO CADEM','FRECUENCIA','CLIENTE'],['0001','QUINCENALES','EMBONOR']],'Hoja1'));assert.deepEqual(u,[{folio:'0001',frequency:'QUINCENALES',client:'EMBONOR'}]);});
test('planning point map includes rows without enabled studies and stops at the empty folio',()=>{
  const rows=Array.from({length:12},()=>[]);rows[1][18]=46286;rows[2][18]=46291;rows[5][18]=525;rows[6][1]='FOLIOS';rows[6][18]='OSA BEBESTIBLES';rows[6][19]='TOTAL';
  rows[7][1]='0001';rows[7][15]=100;rows[7][18]=1;rows[8][1]='0002';rows[10][1]='0003';rows[10][18]=1;
  const p=parsePlanning(book(rows,'RETAIL'));assert.equal(p.rows.length,1);
  assert.deepEqual(p.points,[{folio:'0001',sourceRow:8},{folio:'0002',sourceRow:9}]);
});
test('reads DIA rather than synchronization date in report',()=>{const r=parseReport(book([['VISITA','FOLIO','ESTUDIO','ESTADO','DIA','DIA SINCRO'],[1,2,'OSA BEBESTIBLES 2','TERMINADO','2026-09-08','2026-09-16']],'Sheet1'));assert.equal(r[0].day,'2026-09-08');});
test('report retains actual auditor, client and duration metadata for productivity',()=>{
  const r=parseReport(book([['VISITA','FOLIO','ESTUDIO','ESTADO','DIA','AUDITOR','COORDINADOR','CLIENTE','DURACION','HORAINICIO','HORAFIN'],[1,2,'OSA BEBESTIBLES 2','TERMINADO','2026-09-08','Ana','Luis','EMBONOR','00:05:00','08:00:00','08:05:00']],'Sheet1'));
  assert.equal(r[0].auditorName,'Ana');assert.equal(r[0].coordinator,'Luis');assert.equal(r[0].client,'EMBONOR');assert.equal(r[0].duration,'00:05:00');assert.equal(r[0].timeStart,'08:00:00');
});
test('planning carries optional region, commune and address without changing selection columns',()=>{
  const rows=Array.from({length:8},()=>[]);rows[1][18]=46286;rows[2][18]=46291;rows[5][18]=525;rows[6][1]='FOLIOS';rows[6][11]='REGIÓN';rows[6][12]='COMUNA';rows[6][10]='DIRECCIÓN';rows[6][18]='OSA BEBESTIBLES';rows[6][19]='TOTAL';rows[7][1]='0001';rows[7][15]=100;rows[7][16]='Ana';rows[7][18]=1;rows[7][11]='RM';rows[7][12]='Santiago';rows[7][10]='Avenida 123';
  const p=parseTrackingPlanning(book(rows,'RETAIL'));assert.equal(p.canGenerate,true);assert.equal(p.rows[0].region,'RM');assert.equal(p.rows[0].commune,'Santiago');assert.equal(p.rows[0].address,'Avenida 123');
});
test('reference followup is not treated as an authoritative RETAIL planning',()=>{
  assert.throws(()=>parseTrackingPlanning(book([['FOLIO','AUDITOR','OSA BEBESTIBLES 2'],[1,'Ana','N/C']],'EMBONOR')),/guía de seguimiento/);
});
test('wrong workbook types report actionable missing headers',()=>{assert.throws(()=>parsePlanning(book([['hello']],'Hoja1')),/RETAIL/);assert.throws(()=>parseUniverse(book([['hello']],'Hoja1')),/encabezados/);assert.throws(()=>parseReport(book([['FOLIO','ESTUDIO','ESTADO']],'Hoja1')),/DIA/);});
