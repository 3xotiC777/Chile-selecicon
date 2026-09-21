import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {parsePlanning,parseUniverse,parseReport} from '../src/workbooks.js';
function book(rows,name){const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),name);return XLSX.write(w,{type:'buffer',bookType:'xlsx'});}
test('reads planning study headers, flags, dates and end-of-data sentinel',()=>{
  const rows=Array.from({length:10},()=>[]);rows[1][18]=46286;rows[2][18]=46291;rows[5][18]=525;rows[6][1]='FOLIOS';rows[6][18]='OSA BEBESTIBLES';rows[6][19]='TOTAL';rows[7][1]='0001';rows[7][15]=100;rows[7][16]='AUDITOR';rows[7][18]=1;rows[9][1]=2;rows[9][18]=1;
  const p=parsePlanning(book(rows,'RETAIL'));assert.equal(p.rows.length,1);assert.equal(p.rows[0].folio,'0001');assert.equal(p.rows[0].studyId,'525');assert.equal(p.rows[0].auditor,'100');assert.equal(p.rows[0].start,'2026-09-21');
});
test('finds universe headers and preserves identifier strings',()=>{const u=parseUniverse(book([['Title'],['FOLIO CADEM','FRECUENCIA','CLIENTE'],['0001','QUINCENALES','EMBONOR']],'Hoja1'));assert.deepEqual(u,[{folio:'0001',frequency:'QUINCENALES',client:'EMBONOR'}]);});
test('reads DIA rather than synchronization date in report',()=>{const r=parseReport(book([['VISITA','FOLIO','ESTUDIO','ESTADO','DIA','DIA SINCRO'],[1,2,'OSA BEBESTIBLES 2','TERMINADO','2026-09-08','2026-09-16']],'Sheet1'));assert.equal(r[0].day,'2026-09-08');});
test('wrong workbook types report actionable missing headers',()=>{assert.throws(()=>parsePlanning(book([['hello']],'Hoja1')),/RETAIL/);assert.throws(()=>parseUniverse(book([['hello']],'Hoja1')),/encabezados/);assert.throws(()=>parseReport(book([['FOLIO','ESTUDIO','ESTADO']],'Hoja1')),/DIA/);});
