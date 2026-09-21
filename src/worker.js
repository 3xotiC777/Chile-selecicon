import { parsePlanning,parseUniverse,parseReport } from './workbooks.js';
import { select,csvRows } from './engine.js';
import { zipSync,strToU8 } from 'fflate';
self.onmessage=event=>{
  const {task,data}=event.data;
  try{
    if(task==='universe'){self.postMessage({ok:true,data:parseUniverse(data)});return;}
    if(task==='planning'){const p=parsePlanning(data);self.postMessage({ok:true,data:{start:p.studies[0].start,end:p.studies[0].end,studies:p.studies.length,rows:p.rows.length}});return;}
    if(task==='select'){
      const progress=message=>self.postMessage({progress:message});
      progress('Leyendo la hoja RETAIL…');const planning=parsePlanning(data.planning);
      progress('Contando visitas TERMINADO por estudio y semana…');const report=data.report?parseReport(data.report):[];
      progress('Seleccionando OSA, SOVI, Facing y los demás estudios…');
      const result=select({planning,report,universe:data.universe,hasReport:!!data.report,options:data.options});
      progress('Preparando los CSV y el ZIP…');
      const files=Object.fromEntries(result.files.map(f=>[f.name,strToU8(csvRows(f.rows))]));
      const zip=zipSync(files,{level:6});
      self.postMessage({ok:true,data:result,zip},[zip.buffer]);
    }
  }catch(e){self.postMessage({ok:false,error:e.message,details:e.details||[]});}
};
