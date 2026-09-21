import * as XLSX from 'xlsx';
import { id,normalize,isoDate,SelectionError } from './engine.js';

function readWorkbook(bytes,onlySheet) {
  try {
    const opts={type:'array',cellDates:false,cellFormula:false,cellHTML:false,cellStyles:false};
    if(onlySheet){
      const names=XLSX.read(bytes,{...opts,bookSheets:true}).SheetNames;
      const match=names.find(n=>normalize(n)===onlySheet);
      if(!match)throw new SelectionError(`No se encontró la hoja ${onlySheet}.`,[`Hojas disponibles: ${names.join(', ')}`]);
      return XLSX.read(bytes,{...opts,sheets:[match]});
    }
    return XLSX.read(bytes,opts);
  }catch(e){if(e instanceof SelectionError)throw e;throw new SelectionError('No se pudo leer el Excel. Comprueba que no esté protegido, dañado o sea un archivo diferente.');}
}
const value=(sheet,r,c)=>sheet[XLSX.utils.encode_cell({r,c})]?.v;
function requiredId(v,label){const result=id(v);if(!result||!/^\d+$/.test(result)||Number(result)===0)throw new SelectionError(`${label}: falta un código numérico válido.`);return result;}
export function parsePlanning(bytes){
  const workbook=readWorkbook(bytes,'RETAIL');
  const name=workbook.SheetNames.find(n=>normalize(n)==='RETAIL');
  const sheet=workbook.Sheets[name];
  if(!sheet?.['!ref'])throw new SelectionError('RETAIL está vacía.');
  const range=XLSX.utils.decode_range(sheet['!ref']);
  if(normalize(value(sheet,6,1))!=='FOLIOS'&&normalize(value(sheet,6,1))!=='FOLIO')throw new SelectionError('RETAIL no tiene el formato esperado: FOLIOS en B7.');
  const studies=[],rows=[],warnings=[];let totalFound=false;
  for(let c=16;c<=range.e.c;c++){
    const name=normalize(value(sheet,6,c));
    if(name==='TOTAL'){totalFound=true;break;}
    const code=value(sheet,5,c);
    if(!code||!/^\d+$/.test(id(code)))continue;
    const studyId=requiredId(code,`ID del estudio ${name}`),start=isoDate(value(sheet,1,c)),end=isoDate(value(sheet,2,c));
    if(!name||!start||!end||start>end)throw new SelectionError(`Revisa el nombre y las fechas de ${name||'la columna '+(c+1)} en las filas 2, 3 y 7.`);
    if(studies.some(s=>s.name===name||s.studyId===studyId))throw new SelectionError(`Estudio o código duplicado: ${name} (${studyId}).`);
    studies.push({name,studyId,start,end,col:c});
  }
  if(!totalFound)throw new SelectionError('Falta la columna TOTAL en la fila 7 de RETAIL.');
  if(!studies.length)throw new SelectionError('No hay estudios con códigos y fechas válidos en RETAIL.');
  for(let r=7;r<=range.e.r;r++){
    const folioValue=value(sheet,r,1);
    if(folioValue==null||id(folioValue)===''||Number(folioValue)===0)break;
    const enabled=studies.filter(s=>Number(value(sheet,r,s.col))===1);
    if(!enabled.length)continue;
    const folio=requiredId(folioValue,`Folio B${r+1}`),auditor=id(value(sheet,r,15));
    const auditorName=String(value(sheet,r,16)??auditor).trim();
    for(const s of enabled)rows.push({folio,auditor,auditorName,study:s.name,studyId:s.studyId,start:s.start,end:s.end,sourceRow:r+1});
  }
  return {studies,rows,warnings};
}
function findTable(workbook,predicate,label){
  for(const name of workbook.SheetNames){
    const sheet=workbook.Sheets[name];if(!sheet?.['!ref'])continue;
    const range=XLSX.utils.decode_range(sheet['!ref']);
    for(let r=0;r<=Math.min(range.e.r,30);r++){
      const headers=[];for(let c=0;c<=Math.min(range.e.c,200);c++)headers.push(normalize(value(sheet,r,c)));
      if(predicate(headers))return {sheet,range,headerRow:r,headers};
    }
  }
  throw new SelectionError(`No se encontraron los encabezados de ${label}.`);
}
export function parseUniverse(bytes){
  const w=readWorkbook(bytes);
  const t=findTable(w,h=>(h.includes('FOLIO CADEM')||h.includes('FOLIO'))&&h.includes('FRECUENCIA')&&h.includes('CLIENTE'),'UNIVERSO: FOLIO CADEM, FRECUENCIA, CLIENTE');
  const fc=t.headers.indexOf('FOLIO CADEM')>=0?t.headers.indexOf('FOLIO CADEM'):t.headers.indexOf('FOLIO'),fr=t.headers.indexOf('FRECUENCIA'),cl=t.headers.indexOf('CLIENTE'),rows=[];
  for(let r=t.headerRow+1;r<=t.range.e.r;r++){
    if(value(t.sheet,r,fc)==null)continue;
    rows.push({folio:requiredId(value(t.sheet,r,fc),`Universo fila ${r+1}`),frequency:value(t.sheet,r,fr),client:normalize(value(t.sheet,r,cl))});
  }
  if(!rows.length)throw new SelectionError('El universo está vacío.');
  return rows;
}
export function parseReport(bytes){
  const w=readWorkbook(bytes);
  const t=findTable(w,h=>['FOLIO','ESTUDIO','ESTADO','DIA'].every(n=>h.includes(n)),'export: FOLIO, ESTUDIO, ESTADO, DIA');
  const col=n=>t.headers.indexOf(n),rows=[];
  for(let r=t.headerRow+1;r<=t.range.e.r;r++){
    const folio=id(value(t.sheet,r,col('FOLIO'))),study=normalize(value(t.sheet,r,col('ESTUDIO'))),status=normalize(value(t.sheet,r,col('ESTADO')));
    if(!folio&&!study&&!status)continue;
    rows.push({folio,study,status,day:value(t.sheet,r,col('DIA')),visit:col('VISITA')>=0?id(value(t.sheet,r,col('VISITA'))):''});
  }
  return rows;
}
