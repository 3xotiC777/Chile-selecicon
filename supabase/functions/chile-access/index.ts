import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const headers={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store' };
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const url=Deno.env.get('SUPABASE_URL')!;
const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const fail=(message:string,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');
const credentials=(body:Record<string,unknown>)=>{
  const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||''),name=String(body.name||'').trim().slice(0,120);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)fail('Indica un correo válido.');
  if(password.length<12||password.length>128)fail('La contraseña debe tener entre 12 y 128 caracteres.');
  return {email,password,name};
};
async function createMember(body:Record<string,unknown>,role:string,setupHash?:string,actorId?:string){
  const {email,password,name}=credentials(body);
  const created=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:name}});
  if(created.error)fail('No se pudo crear el usuario. Comprueba que el correo no esté registrado.');
  const user=created.data.user!;
  const result=setupHash
    ?await service.rpc('chile_claim_setup',{p_token_hash:setupHash,p_user_id:user.id,p_display_name:name})
    :await service.rpc('chile_add_member',{p_actor_id:actorId,p_user_id:user.id,p_role:role,p_display_name:name});
  if(result.error){await service.auth.admin.deleteUser(user.id);fail(setupHash?'El enlace de activación venció o ya fue utilizado.':'No se pudo asignar acceso al usuario.');}
  return {user:{id:user.id,email:user.email},role};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return reply({error:'Usa POST.'},405);
  try{
    const raw=await req.text();if(raw.length>16384)fail('La solicitud es demasiado grande.',413);
    let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{fail('Solicitud no válida.');}
    if(!body!||typeof body!=='object'||Array.isArray(body))fail('Solicitud no válida.');
    if(body.action==='setup'){
      const token=String(body.token||'');if(!/^[A-Za-z0-9_-]{43,128}$/.test(token))fail('Enlace de activación no válido.',403);
      const tokenHash=await hash(token);
      const setup=await service.rpc('chile_validate_setup',{p_token_hash:tokenHash});
      if(setup.error||setup.data!==true)fail('El enlace de activación venció o ya fue utilizado.',403);
      return reply(await createMember(body,'admin',tokenHash),201);
    }
    const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');if(!token)fail('Inicia sesión para continuar.',401);
    const identity=await service.auth.getUser(token);if(identity.error||!identity.data.user)fail('La sesión no es válida.',401);
    const caller=identity.data.user;
    const membership=await service.from('chile_members').select('role').eq('user_id',caller.id).maybeSingle();
    if(membership.error||membership.data?.role!=='admin')fail('Solo el administrador puede gestionar usuarios.',403);
    if(body.action==='list'){
      const members=await service.from('chile_members').select('user_id,role,display_name,created_at').order('created_at');
      if(members.error)fail('No se pudo consultar los usuarios.',500);
      const users=await Promise.all((members.data||[]).map(async(member)=>{
        const user=await service.auth.admin.getUserById(member.user_id);
        return {...member,email:user.data.user?.email||'',last_sign_in_at:user.data.user?.last_sign_in_at||null};
      }));
      return reply({users});
    }
    if(body.action==='create'){
      const role=body.role==='admin'?'admin':body.role==='field'?'field':null;if(!role)fail('Selecciona un rol válido.');
      return reply(await createMember(body,role,undefined,caller.id),201);
    }
    if(body.action==='delete'){
      const userId=String(body.userId||'');if(!/^[0-9a-f-]{36}$/i.test(userId))fail('Usuario no válido.');
      if(userId===caller.id)fail('No puedes eliminar tu propia cuenta.');
      const target=await service.from('chile_members').select('role').eq('user_id',userId).maybeSingle();
      if(!target.data)fail('Este usuario no pertenece a Chile.',404);
      // Membership removal revokes data access immediately, including old JWTs.
      const removed=await service.rpc('chile_remove_access',{p_user_id:userId,p_actor_id:caller.id});
      if(removed.error)fail('No se pudo quitar el acceso. Debe quedar un administrador y no puedes eliminar tu propia cuenta.',400);
      const deleted=await service.auth.admin.deleteUser(userId);
      if(deleted.error)fail('Acceso retirado; la cuenta no pudo eliminarse. Revisa Supabase Auth.',500);
      return reply({deleted:true});
    }
    fail('Acción no reconocida.');
  }catch(error){return reply({error:error instanceof Error?error.message:'No se pudo completar la operación.'},(error as {status?:number}).status||500);}
});
