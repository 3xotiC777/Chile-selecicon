import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { normalize,SelectionError } from './engine.js';

const HEADER='SELECCIONADO';
const attr=(text,name)=>text.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`))?.[2];
const cells=()=>/<((?:[\w.-]+:)?c)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
const rows=()=>/<((?:[\w.-]+:)?row)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
const populated=body=>/<(?:[\w.-]+:)?f\b|<(?:[\w.-]+:)?v(?:\s[^>]*)?>[^<]+<\/|<(?:[\w.-]+:)?t(?:\s[^>]*)?>[^<]+<\//.test(body||'');
function columnNumber(name){let n=0;for(const c of name)n=n*26+c.charCodeAt(0)-64;return n;}
function columnName(n){let name='';while(n){n--;name=String.fromCharCode(65+n%26)+name;n=Math.floor(n/26);}return name;}
function xml(text){return new DOMParser({onError:()=>{throw new SelectionError('El XML del planning no se pudo leer.');}}).parseFromString(text,'application/xml');}
const elements=(doc,name)=>Array.from(doc.getElementsByTagName('*')).filter(e=>e.localName===name);
function textValue(body,shared){
  const doc=xml(`<root xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${body}</root>`);
  const v=elements(doc,'v')[0]?.textContent;
  return shared&&v!=null?shared[Number(v)]||'':elements(doc,'t').map(t=>t.textContent).join('');
}
function setAttr(text,name,value){
  const pattern=new RegExp(`\\s${name}\\s*=\\s*(["']).*?\\1`);
  return pattern.test(text)?text.replace(pattern,` ${name}="${value}"`):`${text} ${name}="${value}"`;
}
function updateColumns(sheet,col){
  const match=sheet.match(/<((?:[\w.-]+:)?cols)\b[^>]*>([\s\S]*?)<\/\1>/);
  const prefix=sheet.match(/<((?:[\w.-]+:)?worksheet)\b/)?.[1].replace(/worksheet$/,'')||'';
  const newColumn=`<${prefix}col min="${col}" max="${col}" width="22" customWidth="1"/>`;
  if(!match)return sheet.replace(/<(?:[\w.-]+:)?sheetData\b/,`<${prefix}cols>${newColumn}</${prefix}cols>$&`);
  let inserted=false;
  let body=match[2].replace(/<((?:[\w.-]+:)?col)\b([^>]*?)(?:\/>|>\s*<\/\1>)/g,(tag,name,attrs)=>{
    const min=Number(attr(attrs,'min')),max=Number(attr(attrs,'max'));
    const copy=(from,to)=>`<${name}${setAttr(setAttr(attrs,'min',from),'max',to)}/>`;
    if(min<=col&&max>=col){inserted=true;return (min<col?copy(min,col-1):'')+newColumn+(col<max?copy(col+1,max):'');}
    if(!inserted&&min>col){inserted=true;return newColumn+tag;}
    return tag;
  });
  if(!inserted)body+=newColumn;
  return sheet.replace(match[0],match[0].replace(match[2],body));
}

// Change only RETAIL's XML. Other package parts (including VBA) retain their bytes.
export async function markPlanning(bytes,points,selectedFolios,progress=()=>{}){
  progress('Abriendo una copia de la planeación…');
  const zip=await JSZip.loadAsync(bytes);
  const workbook=xml(await zip.file('xl/workbook.xml')?.async('string')||'');
  const retail=elements(workbook,'sheet').find(s=>normalize(s.getAttribute('name'))==='RETAIL');
  if(!retail)throw new SelectionError('No se encontró RETAIL para marcar la selección.');
  const relationshipId=Array.from(retail.attributes).find(a=>a.localName==='id')?.value;
  const rels=xml(await zip.file('xl/_rels/workbook.xml.rels')?.async('string')||'');
  const relationship=elements(rels,'Relationship').find(r=>r.getAttribute('Id')===relationshipId);
  const target=relationship?.getAttribute('Target');
  if(!target||relationship.getAttribute('TargetMode')==='External')throw new SelectionError('No se encontró el archivo interno de RETAIL.');
  const path=target.startsWith('/')?target.slice(1):new URL(target,'https://workbook.local/xl/workbook.xml').pathname.slice(1);
  const part=zip.file(path);
  if(!part)throw new SelectionError('No se encontró el archivo interno de RETAIL.');
  let sheet=await part.async('string');
  let header;
  for(const row of sheet.matchAll(rows()))if(Number(attr(row[2],'r'))===7){header=row;break;}
  if(!header)throw new SelectionError('Falta la fila 7 de RETAIL.');
  const stringsPart=zip.file('xl/sharedStrings.xml');
  const strings=stringsPart?elements(xml(await stringsPart.async('string')),'si').map(si=>elements(si,'t').map(t=>t.textContent).join('')):[];
  let lastHeader=0,existing=0,headerStyle;
  for(const c of header[3]?.matchAll(cells())||[]){
    if(!populated(c[3]))continue;
    const col=columnNumber(attr(c[2],'r').match(/^[A-Z]+/)[0]);
    if(col>=lastHeader){lastHeader=col;headerStyle=attr(c[2],'s');}
    if(normalize(textValue(c[3],attr(c[2],'t')==='s'?strings:null))===HEADER)existing=col;
  }
  const occupied=new Set();
  // Skip self-closing cells: the source can contain millions of styled blanks.
  const filled=/<((?:[\w.-]+:)?c)\b([^>]*?)(?<!\/)>([\s\S]*?)<\/\1>/g;
  for(const c of sheet.matchAll(filled))if(populated(c[3])){
    const ref=attr(c[2],'r');if(ref)occupied.add(columnNumber(ref.match(/^[A-Z]+/)[0]));
  }
  let col=existing||lastHeader+1;
  while(!existing&&occupied.has(col))col++;
  if(col>16384)throw new SelectionError('RETAIL no tiene espacio para una columna adicional.');
  const column=columnName(col),selected=new Set(selectedFolios.map(String));
  const marks=new Map(points.map(p=>[p.sourceRow,selected.has(String(p.folio))?'SÍ':'NO']));
  marks.set(7,HEADER);
  progress(`Marcando SÍ / NO en la columna ${column} de RETAIL…`);
  const changed=new Set();
  sheet=sheet.replace(rows(),(original,tag,attrs,body='')=>{
    const row=Number(attr(attrs,'r'));if(!marks.has(row))return original;
    const prefix=tag.replace(/row$/,''),ref=column+row;
    const cellPattern=new RegExp(`<((?:[\\w.-]+:)?c)\\b(?=[^>]*\\br=["']${ref}["'])[^>]*?(?:\\/>|>[\\s\\S]*?<\\/\\1>)`);
    const previous=body.match(cellPattern);
    const folioCell=body.match(new RegExp(`<(?:[\\w.-]+:)?c\\b([^>]*\\br=["']B${row}["'][^>]*)>`));
    const style=row===7?headerStyle:attr(folioCell?.[1]||'','s');
    const cell=`<${prefix}c r="${ref}"${style!=null?` s="${style}"`:''} t="inlineStr"><${prefix}is><${prefix}t>${marks.get(row)}</${prefix}t></${prefix}is></${prefix}c>`;
    if(previous)body=body.replace(previous[0],cell);
    else{
      let position=body.length;
      for(const c of body.matchAll(/<(?:[\w.-]+:)?c\b([^>]*?)>/g)){
        const r=attr(c[1],'r');if(r&&columnNumber(r.match(/^[A-Z]+/)[0])>col){position=c.index;break;}
      }
      body=body.slice(0,position)+cell+body.slice(position);
    }
    const span=attr(attrs,'spans')?.split(':').map(Number);
    if(span&&col>span[1])attrs=setAttr(attrs,'spans',`${span[0]}:${col}`);
    changed.add(row);
    return `<${tag}${attrs}>${body}</${tag}>`;
  });
  if(changed.size!==marks.size)throw new SelectionError('Faltan filas de RETAIL para marcar la selección. Vuelve a generar con la planeación actual.');
  sheet=updateColumns(sheet,col);
  sheet=sheet.replace(/(<(?:[\w.-]+:)?dimension\b[^>]*\bref=)(["'])([^"']+)\2/,(tag,begin,quote,ref)=>{
    const [start,end=start]=ref.split(':'),endColumn=columnNumber(end.match(/^[A-Z]+/)[0]);
    return col>endColumn?`${begin}${quote}${start}:${column}${end.match(/\d+$/)[0]}${quote}`:tag;
  });
  zip.file(path,sheet,{date:part.date,createFolders:false});
  progress('Guardando la planeación con su selección…');
  return {bytes:await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}}),column};
}
