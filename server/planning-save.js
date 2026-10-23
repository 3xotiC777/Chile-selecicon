import {gunzipSync} from 'node:zlib';
import {createClient} from '@supabase/supabase-js';
import {validateSave,CloudError} from '../src/cloud.js';

const MAX_COMPRESSED=4*1024*1024,MAX_JSON=36*1024*1024;
class SaveError extends Error{constructor(status,message,code='SAVE_FAILED'){super(message);this.status=status;this.code=code;}}
export function planningClient(token,env=process.env){
  const url=env.SUPABASE_URL||env.VITE_SUPABASE_URL,key=env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new SaveError(503,'El guardado aún no está configurado.','NOT_CONFIGURED');
  // The user's JWT and publishable key keep the RPC subject to the existing RLS.
  // This endpoint deliberately never uses SUPABASE_SECRET_KEY.
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`},fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(40000)})}});
}
async function readInput(req){
  if(req.headers['content-type']?.split(';')[0]!=='application/octet-stream'||req.headers['x-chile-payload']!=='gzip')throw new SaveError(415,'Formato de guardado no válido.','INVALID_PAYLOAD');
  if(Number(req.headers['content-length'])>MAX_COMPRESSED)throw new SaveError(413,'El archivo de guardado comprimido excede 4 MB.','PAYLOAD_LIMIT');
  let body=req.body;
  if(body==null){
    const chunks=[];let size=0;
    for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>MAX_COMPRESSED)throw new SaveError(413,'El archivo de guardado comprimido excede 4 MB.','PAYLOAD_LIMIT');chunks.push(bytes);}
    body=Buffer.concat(chunks);
  }
  if(!Buffer.isBuffer(body)||body.length>MAX_COMPRESSED)throw new SaveError(413,'El archivo de guardado no tiene un tamaño válido.','PAYLOAD_LIMIT');
  try{return JSON.parse(gunzipSync(body,{maxOutputLength:MAX_JSON}).toString('utf8'));}
  catch{throw new SaveError(400,'No se pudo leer el guardado comprimido. Vuelve a generar la selección.','INVALID_PAYLOAD');}
}
export function makePlanningSaveHandler({clientFactory=planningClient}={}){
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    try{
      if(req.method!=='POST'){res.setHeader('Allow','POST');throw new SaveError(405,'Método no permitido.','METHOD_NOT_ALLOWED');}
      if(req.headers['sec-fetch-site']==='cross-site')throw new SaveError(403,'Origen no permitido.','FORBIDDEN');
      const origin=req.headers.origin;
      if(origin&&new URL(origin).host!==req.headers.host)throw new SaveError(403,'Origen no permitido.','FORBIDDEN');
      const token=req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
      if(!token||token.length>8192)throw new SaveError(401,'Inicia sesión para guardar.','UNAUTHORIZED');
      const client=clientFactory(token);
      const user=await client.auth.getUser(token);
      if(user.error||!user.data?.user)throw new SaveError(401,'Tu sesión no es válida. Vuelve a iniciar sesión.','UNAUTHORIZED');
      const member=await client.from('chile_members').select('role').eq('user_id',user.data.user.id).maybeSingle();
      if(member.error)throw new SaveError(503,'No se pudo verificar tu acceso.');
      if(member.data?.role!=='admin')throw new SaveError(403,'Solo el administrador puede guardar la planeación.','FORBIDDEN');
      const input=await readInput(req);
      try{validateSave(input);}catch(error){throw new SaveError(400,error instanceof CloudError?error.message:'Datos de guardado inválidos.','INVALID_PAYLOAD');}
      const {data,error}=await client.rpc('chile_save_workspace',{
        p_month:input.month,p_expected_revision:input.revision,p_planning:input.planning??null,
        p_universe:input.universe??null,p_report:input.report??null,p_selection:input.selection??null,p_metadata:input.metadata||{},
      });
      if(error){
        if(error.code==='PT409')throw new SaveError(409,'El seguimiento cambió. Genera la selección con el avance actualizado antes de guardarla.','PT409');
        if(error.code==='42501')throw new SaveError(403,'Tu usuario ya no tiene permiso para guardar.','42501');
        if(error.code==='22023')throw new SaveError(400,error.message,'22023');
        throw new SaveError(503,'El servidor no confirmó el guardado. La selección sigue disponible; reintenta guardarla.',error.code==='57014'?'57014':'SAVE_FAILED');
      }
      if(!Number.isSafeInteger(data?.revision)||data.revision<=input.revision)throw new SaveError(503,'El servidor no devolvió una confirmación válida del guardado.');
      res.statusCode=200;res.end(JSON.stringify(data));
    }catch(error){
      res.statusCode=error instanceof SaveError?error.status:503;
      res.end(JSON.stringify({error:error instanceof SaveError?error.message:'No se pudo conectar con el guardado. Reintenta sin cambiar la selección.',code:error instanceof SaveError?error.code:'SAVE_FAILED'}));
    }
  };
}
