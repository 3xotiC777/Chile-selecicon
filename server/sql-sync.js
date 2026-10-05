import {randomUUID,timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {readSqlReport} from './sql-report.js';

export class SyncError extends Error{
  constructor(status,message,code='SYNC_FAILED'){super(message);this.status=status;this.code=code;}
}
const safeMessages={
  SQL_UNAVAILABLE:'No se pudo leer SQL Server. Se conserva el avance anterior; vuelve a intentar la sincronización.',
  SQL_CERTIFICATE:'El certificado de SQL Server cambió o no es válido. Se conserva el avance anterior; requiere revisar la conexión.',
  REPORT_INVALID:'La respuesta de SQL Server no es válida para el rango activo. Se conserva el avance anterior.',
  REPORT_LIMIT:'Las visitas exceden el límite del mes. Se conserva el avance anterior.',
  CONFLICT:'El mes, sus fechas o el seguimiento cambiaron durante la lectura. Vuelve a sincronizar.',
};
export function serverClient(env=process.env){
  if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)throw new SyncError(503,'La sincronización aún no está configurada.','NOT_CONFIGURED');
  return createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},
    global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(20000)})}});
}
export function matchesCron(authorization,secret){
  if(typeof secret!=='string'||secret.length<32||typeof authorization!=='string')return false;
  const a=Buffer.from(authorization),b=Buffer.from(`Bearer ${secret}`);
  return a.length===b.length&&timingSafeEqual(a,b);
}
export async function authorizeSync(req,client,env=process.env){
  if(req.method==='GET'){
    if(!matchesCron(req.headers.authorization,env.CRON_SECRET))throw new SyncError(401,'Acceso no autorizado.','UNAUTHORIZED');
    return null;
  }
  if(req.method!=='POST')throw new SyncError(405,'Método no permitido.','METHOD_NOT_ALLOWED');
  if(req.headers['sec-fetch-site']==='cross-site')throw new SyncError(403,'Origen no permitido.','FORBIDDEN');
  const token=req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  if(!token||token.length>8192)throw new SyncError(401,'Inicia sesión para sincronizar.','UNAUTHORIZED');
  const {data,error}=await client.auth.getUser(token);
  if(error||!data?.user)throw new SyncError(401,'Tu sesión no es válida. Vuelve a iniciar sesión.','UNAUTHORIZED');
  const member=await client.from('chile_members').select('role').eq('user_id',data.user.id).maybeSingle();
  if(member.error)throw new SyncError(503,'No se pudo verificar tu acceso.');
  if(member.data?.role!=='admin')throw new SyncError(403,'Solo el administrador puede sincronizar las visitas.','FORBIDDEN');
  return data.user.id;
}
function failureCode(error){
  if(Object.hasOwn(safeMessages,error.message))return error.message;
  if(error.code==='PT409')return 'CONFLICT';
  if(/certificate|CERT_|self.signed|hostname/i.test(error.message||''))return 'SQL_CERTIFICATE';
  return 'SQL_UNAVAILABLE';
}
export async function syncReport(client,actorId,{readReport=readSqlReport}={}){
  const runId=randomUUID();
  const begin=await client.rpc('chile_begin_sql_sync',{p_run_id:runId,p_actor_id:actorId});
  if(begin.error){
    const status=begin.error.code==='42501'?403:begin.error.code==='22023'?400:503;
    throw new SyncError(status,status===400?'Primero guarda la base mensual y confirma su rango de fechas.':'No se pudo iniciar la sincronización.');
  }
  const context=begin.data;
  if(!context?.started)return {ok:true,skipped:context?.reason||'busy',message:context?.reason==='cooldown'?'Ya hubo un intento de actualización hace menos de un minuto. Puedes volver a intentar en unos segundos.':'Hay una sincronización en curso.'};
  try{
    const range={start:context.start,end:context.end};
    const report=await readReport(range);
    const finished=await client.rpc('chile_finish_sql_sync',{p_run_id:runId,p_report:report,p_error_code:null});
    if(finished.error)throw finished.error;
    if(!finished.data?.ok)throw new Error(finished.data?.errorCode||'CONFLICT');
    return {ok:true,month:context.month,range,rows:report.length,syncedAt:finished.data.syncedAt,message:'Visitas sincronizadas. Las planeaciones y sus ZIP se conservaron.'};
  }catch(error){
    const code=failureCode(error);
    // Finish stores only a fixed, safe error code; upstream details never reach clients.
    try{await client.rpc('chile_finish_sql_sync',{p_run_id:runId,p_report:null,p_error_code:code});}catch{}
    throw new SyncError(code==='CONFLICT'?409:502,safeMessages[code],code);
  }
}

export function makeSyncHandler({clientFactory=serverClient,runSync=syncReport,env=process.env}={}){
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    try{
      if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');throw new SyncError(405,'Método no permitido.');}
      // No cookies, body, date parameters or arbitrary SQL are accepted by this API.
      if(req.method==='GET'&&!matchesCron(req.headers.authorization,env.CRON_SECRET))throw new SyncError(401,'Acceso no autorizado.','UNAUTHORIZED');
      const client=clientFactory();
      const actor=await authorizeSync(req,client,env);
      const result=await runSync(client,actor);
      res.statusCode=200;res.end(JSON.stringify(result));
    }catch(error){
      res.statusCode=error instanceof SyncError?error.status:503;
      res.end(JSON.stringify({error:error instanceof SyncError?error.message:'La sincronización no está disponible. Se conserva el avance anterior.',code:error instanceof SyncError?error.code:'SYNC_FAILED'}));
    }
  };
}
