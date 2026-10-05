import sql from 'mssql';
import {id,normalize,isoDate} from '../src/engine.js';
import {validateMonthRange} from '../src/period.js';

export const MAX_REPORT_ROWS=100000;
// Verified against matching VISITA IDs in the user's export. Unknown codes
// stay visible as other states and can never count as a completed visit.
const SQL_STATUS={1:'VACIO',2:'VACIO',4:'TERMINADO',5:'RECHAZO'};
export function sqlStatus(value){
  const status=normalize(value);
  return SQL_STATUS[status]||(/^\d+$/.test(status)?`ESTADO ${status}`:status);
}
export function operationalRange(workspace){
  const options=workspace.metadata?.options||{};
  return validateMonthRange(workspace.active_month,options.monthRange||{start:options.operationalStart,end:options.operationalEnd});
}
export function sqlConfig(env=process.env){
  for(const key of ['SQLSERVER_HOST','SQLSERVER_DATABASE','SQLSERVER_USER','SQLSERVER_PASSWORD']){
    if(!env[key])throw new Error('SQL_CONFIG');
  }
  const port=Number(env.SQLSERVER_PORT||1433);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('SQL_CONFIG');
  return {
    server:env.SQLSERVER_HOST,database:env.SQLSERVER_DATABASE,user:env.SQLSERVER_USER,password:env.SQLSERVER_PASSWORD,port,
    connectionTimeout:15000,requestTimeout:60000,pool:{max:1,min:0,idleTimeoutMillis:1000},
    options:{encrypt:true,trustServerCertificate:false,useUTC:true,
      ...(env.SQLSERVER_CA_PEM?{serverName:env.SQLSERVER_CERT_NAME||env.SQLSERVER_HOST,
        cryptoCredentialsDetails:{ca:env.SQLSERVER_CA_PEM,minVersion:'TLSv1.2'}}:{})},
  };
}

// One parameterized read; status changes (including reversals) replace the snapshot.
// Calendar strings are formatted in SQL, avoiding timezone shifts of DIA and clocks.
export const REPORT_QUERY=`
SELECT TOP (100001)
  CONVERT(varchar(30),v.id_visita) AS VISITA,
  CONVERT(varchar(30),s.foliocadem) AS FOLIO,
  a.NOMBREAPELLIDO AS AUDITOR, CONVERT(varchar(30),v.ID_AUDITOR) AS COD_AUDITOR,
  sv.NOMBREAPELLIDO AS COORDINADOR,
  CONVERT(char(10),v.DIA,23) AS DIA,
  CONVERT(varchar(33),v.HORAINICIO,126) AS INICIO,
  CONVERT(varchar(33),v.HORAFIN,126) AS FIN,
  DATEDIFF(SECOND,v.HORAINICIO,v.HORAFIN) AS SEGUNDOS,
  c.nombrecliente AS CLIENTE,e.nombreestudio AS ESTUDIO,v.estado AS ESTADO,
  CONVERT(varchar(30),es.id_estudio) AS ID_ESTUDIO
FROM visita v
LEFT JOIN ESTUDIOSALA es ON v.ID_ESTUDIOSALA=es.ID_ESTUDIOSALA
LEFT JOIN estudio e ON es.ID_ESTUDIO=e.ID_ESTUDIO
LEFT JOIN cliente c ON e.ID_CLIENTE=c.ID_CLIENTE
LEFT JOIN sala s ON es.ID_SALA=s.ID_SALA
LEFT JOIN AUDITOR a ON v.ID_AUDITOR=a.ID_AUDITOR
LEFT JOIN AUDITOR sv ON a.ID_SUPERVISOR=sv.ID_AUDITOR
WHERE v.DIA >= @periodStart AND v.DIA < @periodEndExclusive
ORDER BY v.DIA,v.id_visita`;

export function normalizeSqlReport(rows,range){
  if(!Array.isArray(rows)||rows.length>MAX_REPORT_ROWS)throw new Error('REPORT_LIMIT');
  return rows.map(row=>{
    const day=isoDate(row.DIA);
    if(!day||day<range.start||day>range.end)throw new Error('REPORT_INVALID');
    const seconds=row.SEGUNDOS==null?null:Number(row.SEGUNDOS);
    const duration=Number.isFinite(seconds)&&seconds>0&&seconds<=43200
      ?`${Math.floor(seconds/3600)}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:'';
    return {folio:id(row.FOLIO),study:normalize(row.ESTUDIO),status:sqlStatus(row.ESTADO),day,
      visit:id(row.VISITA),auditorName:String(row.AUDITOR??'').trim(),auditorCode:id(row.COD_AUDITOR),
      coordinator:String(row.COORDINADOR??'').trim(),client:normalize(row.CLIENTE),duration,
      timeStart:String(row.INICIO??''),timeEnd:String(row.FIN??''),
      ...(!row.INICIO&&!row.FIN&&sqlStatus(row.ESTADO)==='VACIO'?{scheduledOnly:true}:{})};
  });
}

export async function readSqlReport(range,env=process.env){
  const pool=new sql.ConnectionPool(sqlConfig(env));
  pool.on('error',()=>{}); // Request errors are handled below; never log connection strings.
  try{
    await pool.connect();
    const start=new Date(range.start+'T00:00:00Z'),end=new Date(range.end+'T00:00:00Z');
    end.setUTCDate(end.getUTCDate()+1);
    const result=await pool.request().input('periodStart',sql.Date,start).input('periodEndExclusive',sql.Date,end).query(REPORT_QUERY);
    return normalizeSqlReport(result.recordset,range);
  }finally{await pool.close();}
}
