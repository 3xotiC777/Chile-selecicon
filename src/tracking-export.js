import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {isoDate,monday} from './engine.js';
import {summarizeWeeklyProgress} from './weekly-progress.js';

export const PROGRESS_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HEADER_ROW=6;
const compare=(a,b)=>String(a??'').localeCompare(String(b??''),'es',{numeric:true});
const shortDate=value=>value?value.split('-').reverse().join('/'):'';
const excelDate=value=>isoDate(value)?(Date.parse(isoDate(value)+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000:null;

// ISO calendar week, independent of the operational month's week 1–5.
export function calendarWeek(day){
  const date=new Date(day+'T00:00:00Z');
  date.setUTCDate(date.getUTCDate()+4-(date.getUTCDay()||7));
  return Math.ceil(((date-Date.UTC(date.getUTCFullYear(),0,1))/86400000+1)/7);
}

export function weeklyOutcomeFlag(entry){
  return entry?.completedVisits>0||entry?.rejected>0?1:0;
}

// Completed work wins over failed attempts in the same week. SOVI only
// completes with all eight distinct components, as counted by buildTracking.
export function weeklyStateLabel(entry){
  if(!entry)return 'SIN REGISTROS';
  if(entry.completedVisits>0)return 'TERMINADO';
  const states=[];
  if(entry.completedStudies>0)states.push(`PARCIAL SOVI (${entry.completedStudies}/8)`);
  if(entry.rejected>0)states.push('RECHAZO');
  if(entry.empty>0)states.push('VACIO');
  if(entry.other>0)states.push(...(entry.otherStatuses?.length?entry.otherStatuses:['OTRO ESTADO']));
  return states.join(' / ')||'SIN REGISTROS';
}

function sheetName(client,used){
  const base=(String(client).replace(/[\[\]:*?/\\\x00-\x1f]/g,' ').trim().replace(/^'+|'+$/g,'')||'OTROS').slice(0,31);
  let name=base,suffix=1;
  while(used.has(name.toUpperCase())){const tail=` (${++suffix})`;name=base.slice(0,31-tail.length)+tail;}
  used.add(name.toUpperCase());return name;
}

const fixedColumns=[
  ['folio','FOLIO',16],['study','ESTUDIO',38],['auditorName','AUDITOR',30],['auditor','COD. AUDITOR',16],
  ['coordinator','COORDINADOR',28],['office','OFICINA',20],['location','NOMBRE LOCAL',30],
  ['measurementDay','DÍA MEDICIÓN',18],['frequency','FRECUENCIA',18],['address','DIRECCIÓN',40],
  ['chain','CADENA',20],['commune','COMUNA',22],['region','REGIÓN',14]
];
const totalColumns=[
  ['target','META MENSUAL',17],['fulfilledVisits','CUMPLIDAS',15],['remaining','PENDIENTES',15],
  ['progress','AVANCE',14],['monthlyStatus','ESTADO MENSUAL',21],
  ['undatedEmpty','VACÍAS SIN FECHA',19],['undatedRejected','RECHAZADAS SIN FECHA',22],['lastVisit','ÚLTIMA VISITA',18]
];

export function progressSheets(points,period,{filters={}}={}){
  if(!points.length)throw new Error('No hay puntos con estos filtros para descargar.');
  const {weeks}=summarizeWeeklyProgress([],period);
  if(!weeks.length)throw new Error('Falta el rango del mes para descargar el avance por semana.');
  // Legacy snapshots cannot recover rejected/empty weeks from monthly totals.
  if(points.some(point=>!Array.isArray(point.weekStates)))throw new Error('Actualiza el seguimiento antes de descargar el avance semanal.');
  const stateColumns=weeks.map(week=>[`week:${monday(week.start)}`,`SEMANA ${week.week}\n${shortDate(week.start)} al ${shortDate(week.end)}`,34]);
  const groups=new Map(),used=new Set();
  for(const point of points){const client=point.client||'OTROS';if(!groups.has(client))groups.set(client,[]);groups.get(client).push(point);}
  const labels={client:'Cliente',study:'Estudio',auditor:'Auditor',region:'Región',status:'Estado',search:'Búsqueda',planned:'Solo planeación guardada'};
  const scope=Object.entries(filters).filter(([,v])=>v).map(([k,v])=>`${labels[k]||k}: ${v===true?'Sí':v}`).join('; ')||'Todos los puntos del mes';
  return [...groups].sort(([a],[b])=>compare(a,b)).map(([client,group])=>{
    const prefix=client==='CRUZ VERDE'?'SUMCV':`SUM${client.replace(/\s+/g,'')}`;
    const flagColumns=weeks.map(week=>[`flag:${monday(week.start)}`,`${prefix}_${calendarWeek(week.start)}`,19]);
    const columns=[...fixedColumns,...stateColumns,...flagColumns,...totalColumns];
    const rows=group.slice().sort((a,b)=>compare(a.auditorName,b.auditorName)||compare(a.folio,b.folio)||compare(a.study,b.study)).map(point=>{
      const states=new Map(point.weekStates.map(entry=>[entry.weekStart,entry]));
      return columns.map(([key])=>{
        if(key.startsWith('week:'))return weeklyStateLabel(states.get(key.slice(5)));
        if(key.startsWith('flag:'))return weeklyOutcomeFlag(states.get(key.slice(5)));
        if(key==='monthlyStatus')return point.target==null?'SIN FRECUENCIA':point.complete?'CUMPLIDO':point.fulfilledVisits>0?'EN AVANCE':'PENDIENTE';
        if(key==='progress')return point.target==null?null:point.progress/100;
        if(key==='lastVisit')return excelDate(point.lastVisit);
        // Identifier strings (including leading zeros) stay literal Excel text.
        return point[key]??null;
      });
    });
    return {name:sheetName(client,used),columns,rows,values:[
      [`AVANCE ${period.month} · ${client}`],
      [`Mes operativo: ${shortDate(period.operationalStart)} al ${shortDate(period.operationalEnd)}. Corte: ${shortDate(period.asOf)}. Última actividad con fecha: ${shortDate(period.lastReportDay)||'Sin registros'}.`],
      [`Filtros: ${scope}. Una fila por folio y estudio. Auditor y datos del punto: base de planeación.`],
      ['TERMINADO: visita válida en la semana. SOVI: exige 8 estudios. SIN REGISTROS: sin estado fechado; no implica que el punto no se haya cargado.'],
      [`${prefix}_n: semana calendario; 1 = TERMINADO o RECHAZO, 0 = VACIO, sin registro u otro estado. Sin fecha se muestra aparte. CUMPLIDAS cuenta solo visitas válidas; meta semanal: 4 al mes.`],
      columns.map(([,label])=>label),...rows
    ]};
  });
}

// SheetJS CE writes the values, types, ranges and filters. Add the small set
// of presentation styles and frozen panes to its generated OOXML package.
const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="4"><font><sz val="10"/><color rgb="FF243746"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FF005F60"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF526575"/><name val="Calibri"/></font></fonts>
<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF007F80"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDF1E4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE8DF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1CB"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F4F7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="6" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="center"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function stateStyle(value){
  if(value==='TERMINADO'||value==='CUMPLIDO')return 4;
  if(String(value).includes('RECHAZO'))return 5;
  if(value==='SIN REGISTROS'||value==='SIN FRECUENCIA')return 7;
  return 6;
}

export async function progressWorkbook(points,period,options={}){
  const sheets=progressSheets(points,period,options),book=XLSX.utils.book_new();
  for(const model of sheets){
    const sheet=XLSX.utils.aoa_to_sheet(model.values);
    sheet['!cols']=model.columns.map(([, ,width])=>({wch:width}));
    sheet['!rows']=model.values.map((row,index)=>({hpt:index===0?30:index<5?20:index===5?46:Math.max(30,...row.map((value,c)=>Math.ceil(String(value??'').length/(model.columns[c]?.[2]-3||30))*13))}));
    sheet['!merges']=Array.from({length:5},(_,r)=>({s:{r,c:0},e:{r,c:model.columns.length-1}}));
    sheet['!autofilter']={ref:XLSX.utils.encode_range({s:{r:HEADER_ROW-1,c:0},e:{r:model.values.length-1,c:model.columns.length-1}})};
    XLSX.utils.book_append_sheet(book,sheet,model.name);
  }
  const zip=await JSZip.loadAsync(XLSX.write(book,{type:'array',bookType:'xlsx'}));
  zip.file('xl/styles.xml',styles);
  for(let i=0;i<sheets.length;i++){
    const model=sheets[i],path=`xl/worksheets/sheet${i+1}.xml`;
    let xml=await zip.file(path).async('string');
    xml=xml.replace(/<c\b([^>]*?)>/g,(tag,attributes)=>{
      const ref=attributes.match(/\br="([A-Z]+\d+)"/);if(!ref)return tag;
      const {r,c}=XLSX.utils.decode_cell(ref[1]),key=model.columns[c]?.[0],value=model.values[r]?.[c];
      const style=r===0?2:r<5?3:r===5?1:key==='progress'?8:key==='lastVisit'?9:key?.startsWith('week:')||key==='monthlyStatus'?stateStyle(value):0;
      return `<c${attributes.replace(/\s+s="[^"]*"/g,'')} s="${style}">`;
    });
    const views=`<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="2" ySplit="6" topLeftCell="C7" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="C7" sqref="C7"/></sheetView></sheetViews>`;
    xml=xml.replace(/<sheetViews\b[^>]*>[\s\S]*?<\/sheetViews>/,views);
    zip.file(path,xml);
  }
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
