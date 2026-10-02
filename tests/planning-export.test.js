import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { markPlanning } from '../src/planning-export.js';

const points=[{folio:'001',sourceRow:8},{folio:'2',sourceRow:9},{folio:'3',sourceRow:10}];
async function fixture(extra=''){
  const zip=new JSZip();
  zip.file('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="OTRA" sheetId="1" r:id="rId1"/><sheet name="RETAIL" sheetId="2" r:id="rId2"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>');
  zip.file('xl/sharedStrings.xml','<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>FOLIOS</t></si><si><t>TOTAL</t></si></sst>');
  zip.file('xl/worksheets/sheet1.xml','<worksheet><sheetData><row r="1"><c r="A1"><f>SUM(A2:A3)</f><v>123</v></c></row></sheetData></worksheet>');
  zip.file('xl/vbaProject.bin',new Uint8Array([0,1,2,255,128,17]));
  zip.file('xl/styles.xml','<original-styles/>');
  zip.file('xl/worksheets/_rels/sheet2.xml.rels','<original-drawing-and-comments/>');
  zip.file('xl/worksheets/sheet2.xml',`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:XFD12"/><cols><col min="1" max="16384" width="11" style="7" customWidth="1"/></cols><sheetData><row r="7" spans="1:3"><c r="B7" s="8" t="s"><v>0</v></c><c r="C7" s="9" t="s"><v>1</v></c></row><row r="8" spans="1:16384"><c r="B8" s="31" t="inlineStr"><is><t>001</t></is></c><c r="C8"><f>SUM(E8:F8)</f><v>4</v></c><c r="D8" s="68"/><c r="XFD8" s="68"/></row><row r="9"><c r="B9"><v>2</v></c><c r="D9" s="68"/></row><row r="10"><c r="B10"><v>3</v></c></row><row r="11"><c r="B11"><v>0</v></c></row><row r="12"><c r="B12"><v>4</v></c>${extra}</row></sheetData><autoFilter ref="B7:C10"/><conditionalFormatting sqref="B8:C10"><cfRule type="expression" priority="1"><formula>B8&gt;0</formula></cfRule></conditionalFormatting><pageMargins left="0.7" right="0.7"/></worksheet>`);
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
test('adds a nearby selection column, including unselected points, without changing other workbook parts',async()=>{
  const input=await fixture(),original=await JSZip.loadAsync(input);
  const marked=await markPlanning(input,points,['001','001']);
  assert.equal(marked.column,'D');
  const output=await JSZip.loadAsync(marked.bytes);
  assert.deepEqual(Object.keys(output.files),Object.keys(original.files));
  for(const name of Object.keys(original.files))if(name!=='xl/worksheets/sheet2.xml'&&!original.files[name].dir)assert.deepEqual(await output.file(name).async('uint8array'),await original.file(name).async('uint8array'),name);
  const sheet=await output.file('xl/worksheets/sheet2.xml').async('string');
  assert.match(sheet,/<c r="D7" s="9" t="inlineStr"><is><t>SELECCIONADO/);
  assert.match(sheet,/<c r="D8" s="31" t="inlineStr"><is><t>SÍ/);
  for(const row of [9,10])assert.match(sheet,new RegExp(`<c r="D${row}"[^>]*><is><t>NO`));
  assert(!sheet.includes('r="D11"'));assert(!sheet.includes('r="D12"'));
  assert.match(sheet,/<c r="XFD8" s="68"\/>/);assert.match(sheet,/<f>SUM\(E8:F8\)<\/f><v>4<\/v>/);
  assert.match(sheet,/<col min="4" max="4" width="22" customWidth="1"\/>/);
  assert.match(sheet,/<col min="5" max="16384" width="11" style="7" customWidth="1"\/>/);
  assert.match(sheet,/<autoFilter ref="B7:C10"\/>/);assert.match(sheet,/<conditionalFormatting sqref="B8:C10">/);
});
test('a real xlsx workbook remains readable with its formulas and marked identifier strings',async()=>{
  const data=Array.from({length:10},()=>[]);data[6][1]='FOLIOS';data[6][2]='TOTAL';data[7][1]='001';data[8][1]='2';data[9][1]='3';
  const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(data);
  sheet.C8={t:'n',v:4,f:'SUM(2,2)'};XLSX.utils.book_append_sheet(workbook,sheet,'RETAIL');XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Keep this']]),'OTRA');
  const input=XLSX.write(workbook,{type:'buffer',bookType:'xlsx',bookSST:true});
  const marked=await markPlanning(input,points,['001']);
  const parsed=XLSX.read(marked.bytes,{type:'array',cellFormula:true});
  assert.equal(marked.column,'D');assert.equal(parsed.Sheets.RETAIL.D8.v,'SÍ');assert.equal(parsed.Sheets.RETAIL.D9.v,'NO');
  assert.equal(parsed.Sheets.RETAIL.B8.v,'001');assert.equal(parsed.Sheets.RETAIL.C8.f,'SUM(2,2)');assert.equal(parsed.Sheets.OTRA.A1.v,'Keep this');
});
test('reusing an annotated planning updates the existing column instead of adding another',async()=>{
  const first=await markPlanning(await fixture(),points,['001']);
  const next=await markPlanning(first.bytes,points,['2']);assert.equal(next.column,'D');
  const sheet=await (await JSZip.loadAsync(next.bytes)).file('xl/worksheets/sheet2.xml').async('string');
  assert.equal((sheet.match(/SELECCIONADO/g)||[]).length,1);
  assert.match(sheet,/<c r="D8"[^>]*><is><t>NO/);assert.match(sheet,/<c r="D9"[^>]*><is><t>SÍ/);
});
test('replacing a styled blank cannot consume following cells with values or formulas',async()=>{
  const input=await fixture();const source=await JSZip.loadAsync(input);
  const path='xl/worksheets/sheet2.xml';
  const sheet=(await source.file(path).async('string')).replace('<c r="D8" s="68"/>','<c r="D8" s="68"/><c r="E8"><v>777</v></c><c r="F8"><f>1+1</f><v>2</v></c>');
  source.file(path,sheet);
  const marked=await markPlanning(await source.generateAsync({type:'uint8array'}),points,['001']);assert.equal(marked.column,'D');
  const output=await (await JSZip.loadAsync(marked.bytes)).file(path).async('string');
  assert.match(output,/<c r="E8"><v>777<\/v><\/c>/);assert.match(output,/<c r="F8"><f>1\+1<\/f><v>2<\/v><\/c>/);
});
test('never overwrites data or formulas in a column with an empty header',async()=>{
  const marked=await markPlanning(await fixture('<c r="D12"><f>1+1</f></c>'),points,['2']);
  assert.equal(marked.column,'E');
  const sheet=await (await JSZip.loadAsync(marked.bytes)).file('xl/worksheets/sheet2.xml').async('string');
  assert.match(sheet,/<c r="D12"><f>1\+1<\/f><\/c>/);assert.match(sheet,/<c r="E9"[^>]*><is><t>SÍ/);
});
test('rejects stale row mappings instead of silently omitting selection marks',async()=>{
  await assert.rejects(markPlanning(await fixture(),[{folio:'99',sourceRow:99}],['99']),/Faltan filas/);
});
