import './portal.css';
import {createCloud} from './cloud.js';
import {mountDashboard} from './dashboard.js';
import {csvRows} from './engine.js';
import {TRACKING_ALIASES,reportForPeriod} from './tracking.js';
import {zipSync,strToU8} from 'fflate';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=value=>Number(value||0).toLocaleString('es-CL');
function download(bytes,type,name){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function selectionZip(selection){return zipSync(Object.fromEntries(selection.files.map(file=>[file.name,strToU8(csvRows(file.rows))])),{level:6});}
export function compactSelection(result){return {files:result.files,period:result.period,metrics:result.metrics,warnings:result.warnings,workload:result.workload,soviAuditors:result.soviAuditors};}

export function initPortal({runWorker,onWorkspace,resetSelection}){
  const cloud=createCloud();let access=null,workspace=null,loading=null,section='dashboard',authRevision=0,accessSync=null,loadingRevision=0;
  $('import-month').value=new Date().toISOString().slice(0,7);
  let setupToken=new URLSearchParams(location.hash.slice(1)).get('activar');
  if(setupToken)history.replaceState(null,'',location.pathname+location.search);
  const dashboard=mountDashboard($('dashboard'),{onRefresh:()=>refresh(),onDownloadPlanning:()=>downloadPlan(workspace?.weeklyPlans[0])});
  const message=(id,text,error=false)=>{$(id).textContent=text;$(id).classList.toggle('error',error);};
  const admin=()=>access?.role==='admin';
  function view(name){
    section=name;
    for(const key of ['dashboard','planning','export','users'])$(key+'-view').hidden=key!==name;
    document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===name));
    if(name==='users'&&admin())loadUsers();
  }
  function showAccess(){
    const signed=Boolean(access?.role);
    $('auth-view').hidden=signed;$('app-view').hidden=!signed;$('account-controls').hidden=!signed;
    document.querySelectorAll('[data-admin]').forEach(el=>el.hidden=!admin());
    if(signed){$('account-name').textContent=(access.member?.display_name||access.user.email)+' · '+(admin()?'Administrador':'Campo');if(!admin()&&section!=='dashboard')view('dashboard');}
  }
  function clearPrivateView(){workspace=null;dashboard.setSnapshot(null);$('saved-plans').replaceChildren();$('users-list').replaceChildren();$('password-panel').hidden=true;for(const id of ['login-form','password-form','user-form','export-form','import-form'])$(id)?.reset();resetSelection?.();}
  async function syncAccess(){
    if(accessSync)return accessSync;
    const revision=++authRevision;
    accessSync=(async()=>{try{const next=await cloud.getAccess();if(revision!==authRevision)return;access=next;
      if(next.user&&!next.role){message('auth-status','Tu cuenta no tiene acceso a Chile. Solicítalo al administrador.',true);await cloud.signOut();access=null;}
      showAccess();if(access?.role)await refresh();
    }catch(e){message('auth-status',e.message,true);access=null;clearPrivateView();showAccess();}finally{accessSync=null;}})();return accessSync;
  }
  async function refresh(){
    if(!access?.role||!cloud)return;
    if(loading){if(loadingRevision===authRevision)return loading;await loading;return refresh();}
    dashboard.setState({loading:true,error:''});
    const revision=authRevision;
    loadingRevision=revision;
    loading=(async()=>{
      try{const current=await cloud.getAccess();if(revision!==authRevision)return;
        if(!current.role){access=null;clearPrivateView();showAccess();message('auth-status','Tu acceso fue retirado. Solicítalo al administrador.',true);await cloud.signOut();return;}
        access=current;showAccess();const next=await cloud.loadWorkspace();if(revision!==authRevision)return;workspace=next;onWorkspace?.(next);
        if(!workspace.planning){dashboard.setSnapshot(null);renderPlans();return;}
        const options={...workspace.metadata.options,month:workspace.month};
        const latest=workspace.weeklyPlans[0];
        const tracked=await runWorker('tracking',{planning:workspace.planning,universe:workspace.universe,report:workspace.report,options:{...options,assignments:latest?.result.files.flatMap(f=>f.rows)||[]}});
        if(revision!==authRevision)return;
        dashboard.setSnapshot({tracking:tracked.data,updatedAt:workspace.updatedAt,planningName:workspace.metadata.planningName,reportName:workspace.metadata.reportName,planPeriod:latest?.result.period,lastPlanningAvailable:!!latest});
        renderPlans();
        $('import-month').value=workspace.month;$('import-week').value=String(options.week||1);$('import-weeks').value=String(options.weeks||5);
        $('export-current').textContent=`Mes activo: ${workspace.month} · última actualización: ${new Date(workspace.updatedAt).toLocaleString('es-CL',{timeZone:'America/Santiago'})}. La carga reemplaza el export del mes; conserva las planeaciones guardadas.`;
      }catch(e){if(['ACCESS_DENIED','PGRST301','PGRST302','PGRST303','bad_jwt','session_not_found','user_not_found'].includes(e.code)){access=null;clearPrivateView();showAccess();message('auth-status',e.message,true);try{await cloud.signOut();}catch{}}else dashboard.setState({error:e.message});}
      finally{dashboard.setState({loading:false});loading=null;}
    })();return loading;
  }
  function downloadPlan(plan){if(!plan)return;download(selectionZip(plan.result),'application/zip',`CHILE_${plan.month}_SEMANA_${plan.week}.zip`);}
  function renderPlans(){
    const plans=workspace?.weeklyPlans||[];
    $('saved-plans').innerHTML=`<div class="section-heading"><span class="step">ZIP</span><h2>Planeaciones guardadas del mes</h2></div>${plans.length?`<div class="table-wrap"><table><thead><tr><th>Semana / fechas</th><th>Puntos</th><th>Guardada</th><th>Descarga</th></tr></thead><tbody>${plans.map(plan=>`<tr><td>Semana ${plan.week}<br><small>${esc(plan.result.period.start)} al ${esc(plan.result.period.end)}</small></td><td>${n(plan.result.metrics.points)}</td><td>${esc(new Date(plan.updatedAt).toLocaleString('es-CL',{timeZone:'America/Santiago'}))}</td><td><button type="button" class="text-button" data-plan="${plan.week}">Descargar ZIP</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="note">Aún no se ha guardado una selección semanal. El administrador puede generarla en Planeación y pulsar «Guardar planeación compartida».</p>'}`;
    $('saved-plans').querySelectorAll('[data-plan]').forEach(button=>button.addEventListener('click',()=>downloadPlan(plans.find(p=>p.week===Number(button.dataset.plan)))));
    if(plans.some(plan=>plan.metadata.selectionOrigin?.startsWith('Selección generada'))){const note=document.createElement('p');note.className='note';note.textContent='La selección inicial se calculó con el último RETAIL y export proporcionados. Revisa el ZIP antes de enviarlo a campo.';$('saved-plans').append(note);}
  }
  async function saveSelection(draft){
    if(!admin())throw new Error('Solo el administrador puede guardar una planeación.');
    if(!draft)throw new Error('Genera de nuevo la selección antes de guardar.');
    const selection=compactSelection(draft.result),{month}=selection.period;
    const planning={...draft.planning,rows:draft.planning.rows.filter(r=>!draft.options.excludedFolios?.includes(r.folio)).map(r=>({...r,auditor:draft.options.auditorOverrides?.[r.folio]||r.auditor}))};
    const changed=workspace?.month&&workspace.month!==month;
    const metadata={...draft.metadata,options:{...draft.options,...selection.period,aliases:{...TRACKING_ALIASES,...draft.options.aliases}},selectionOrigin:'Guardada por el administrador'};
    if(changed&&!confirm(`Guardar ${month} reemplazará el seguimiento y los ZIP de ${workspace.month}. Ya revisaste la nueva selección. ¿Iniciar el mes ${month}?`))throw new Error('Se canceló el cambio de mes. La selección sigue disponible para descargar.');
    await cloud.saveWorkspace({month,planning,universe:draft.universe,report:reportForPeriod(draft.report,selection.period),selection,metadata,revision:workspace?.revision||0});
    await refresh();view('dashboard');
  }
  function authForm(){
    $('auth-view').innerHTML=`<div class="login-copy"><p class="eyebrow">OPERACIÓN CHILE</p><h1>${setupToken?'Activa tu administrador':'Planeación y avance, en un solo lugar.'}</h1><p>${setupToken?'Elige el correo y la contraseña de la primera cuenta. Este enlace se usa una sola vez.':'Consulta las visitas del mes, los pendientes y la última planeación compartida.'}</p><div class="login-feature"><strong>Avance real</strong><span>Solo TERMINADO cumple la meta. Vacíos y rechazos quedan visibles.</span></div><div class="login-feature"><strong>Acceso por usuario</strong><span>Campo consulta y descarga. Administración prepara y actualiza.</span></div></div><form id="login-form" class="login-form"><h2>${setupToken?'Crear administrador':'Iniciar sesión'}</h2>${setupToken?'<label>Nombre<input id="login-name" autocomplete="name" required maxlength="120" /></label>':''}<label>Correo<input id="login-email" type="email" autocomplete="username" required /></label><label>Contraseña<input id="login-password" type="password" autocomplete="${setupToken?'new-password':'current-password'}" required ${setupToken?'minlength="12"':''} maxlength="128" /></label>${setupToken?'<label>Confirmar contraseña<input id="login-confirm" type="password" autocomplete="new-password" required minlength="12" /></label><p class="note">Mínimo 12 caracteres. Después podrás crear las cuentas del equipo.</p>':''}<button id="login-submit" class="primary" type="submit">${setupToken?'Crear administrador':'Entrar'}</button><p id="auth-status" role="status" class="portal-message"></p><p class="note">Las cuentas las administra el responsable de Chile.</p></form>`;
    $('login-form').addEventListener('submit',async event=>{
      event.preventDefault();$('login-submit').disabled=true;message('auth-status','Conectando…');
      try{const email=$('login-email').value,password=$('login-password').value;
        if(setupToken){if(password!==$('login-confirm').value)throw new Error('Las contraseñas no coinciden.');await cloud.firstAdminSetup(setupToken,email,password,$('login-name').value);setupToken=null;authForm();}
        await cloud.signIn(email,password);await syncAccess();
        $('login-form').reset();
      }catch(e){message('auth-status',e.message,true);}
      finally{$('login-submit').disabled=false;}
    });
  }
  async function loadUsers(){
    if(!admin())return;message('users-status','Consultando usuarios…');
    try{const {users}=await cloud.listUsers();
      $('users-list').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Último acceso</th><th>Acción</th></tr></thead><tbody>${users.map(user=>`<tr><td>${esc(user.display_name)}<br><small>${esc(user.email)}</small></td><td>${user.role==='admin'?'Administrador':'Campo'}</td><td>${user.last_sign_in_at?esc(new Date(user.last_sign_in_at).toLocaleDateString('es-CL')):'Sin acceso'}</td><td>${user.user_id!==access.user.id?`<button type="button" class="text-button danger" data-delete="${esc(user.user_id)}" data-email="${esc(user.email)}">Eliminar</button>`:'Tu cuenta'}</td></tr>`).join('')}</tbody></table></div>`;
      $('users-list').querySelectorAll('[data-delete]').forEach(button=>button.addEventListener('click',async()=>{
        if(!confirm(`¿Eliminar el acceso de ${button.dataset.email}? Dejará de poder consultar los datos.`))return;
        button.disabled=true;try{await cloud.deleteUser(button.dataset.delete);await loadUsers();}catch(e){message('users-status',e.message,true);button.disabled=false;}
      }));message('users-status',`${users.length} usuarios con acceso.`);
    }catch(e){message('users-status',e.message,true);}
  }
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>view(button.dataset.view)));
  $('sign-out').addEventListener('click',async()=>{await cloud.signOut();authRevision++;access=null;clearPrivateView();showAccess();});
  $('change-password').addEventListener('click',()=>{$('password-panel').hidden=!$('password-panel').hidden;});
  $('password-form').addEventListener('submit',async event=>{
    event.preventDefault();message('password-status','Guardando…');try{const password=$('new-password').value;if(password!==$('confirm-password').value)throw new Error('Las contraseñas no coinciden.');await cloud.updatePassword(password);$('password-form').reset();message('password-status','Contraseña actualizada.');}catch(e){message('password-status',e.code==='reauthentication_needed'?'Para cambiar tu contraseña, sal y vuelve a iniciar sesión.':e.message,true);}
  });
  $('user-form').addEventListener('submit',async event=>{
    event.preventDefault();$('create-user').disabled=true;message('users-status','Creando usuario…');
    try{await cloud.createUser({email:$('user-email').value,password:$('user-password').value,displayName:$('user-name').value,role:$('user-role').value});$('user-form').reset();await loadUsers();}
    catch(e){message('users-status',e.message,true);}finally{$('create-user').disabled=false;}
  });
  $('export-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!admin()||!workspace?.planning)return message('export-status','Primero guarda una base mensual.',true);
    $('update-export').disabled=true;message('export-status','Leyendo el export…');
    try{const file=$('tracking-export').files[0],loaded=await runWorker('report',await file.arrayBuffer());
      const preview=await runWorker('tracking',{planning:workspace.planning,universe:workspace.universe,report:loaded.data,options:workspace.metadata.options});
      if(!preview.data.daily.length)throw new Error('El export no tiene encuestas fechadas dentro del mes operativo activo. Revisa el archivo y el período.');
      await cloud.saveWorkspace({month:workspace.month,report:reportForPeriod(loaded.data,preview.data.period),revision:workspace.revision,metadata:{reportName:file.name,reportUpdatedAt:new Date().toISOString()}});
      $('export-form').reset();message('export-status','Export actualizado. Se conservaron las planeaciones y sus ZIP.');await refresh();
    }catch(e){message('export-status',e.message,true);}finally{$('update-export').disabled=false;}
  });
  $('import-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!admin())return;$('import-save').disabled=true;message('import-status','Leyendo archivos…');
    try{const planningFile=$('tracking-base').files[0],universeFile=$('tracking-universe').files[0],reportFile=$('tracking-base-report').files[0];
      const loaded=await runWorker('workspaceInputs',{planning:await planningFile.arrayBuffer(),universeBytes:universeFile?await universeFile.arrayBuffer():null,universe:workspace?.universe,report:reportFile?await reportFile.arrayBuffer():null});
      const {planning,universe,report}=loaded.data;if(!universe?.length)throw new Error('Carga el universo para iniciar el seguimiento.');
      const month=$('import-month').value,week=Number($('import-week').value),weeks=Number($('import-weeks').value),start=planning.studies[0].start,end=planning.studies[0].end;
      const options={month,week,weeks,start,end,aliases:TRACKING_ALIASES};
      const checked=await runWorker('tracking',{planning,universe,report,options});
      if(!checked.data.points.length)throw new Error('La base no tiene puntos para seguir.');
      if(workspace?.month&&month!==workspace.month&&!confirm(`Iniciar ${month} reemplazará el mes ${workspace.month} y sus ZIP. ¿Guardar la nueva base?`))return;
      await cloud.saveWorkspace({month,planning,universe,report:reportFile?reportForPeriod(report,checked.data.period):workspace?.month===month?undefined:[],revision:workspace?.revision||0,metadata:{planningName:planningFile.name,universeName:universeFile?.name||workspace?.metadata.universeName||'Universo compartido',...(reportFile?{reportName:reportFile.name}:{}),options}});
      message('import-status','Base guardada. Genera la selección semanal en Planeación para guardar su ZIP.');await refresh();
    }catch(e){message('import-status',e.message,true);}finally{$('import-save').disabled=false;}
  });
  if(!cloud){
    $('auth-view').hidden=true;$('app-view').hidden=false;
    document.querySelectorAll('[data-view]').forEach(button=>button.hidden=button.dataset.view!=='planning');
    $('account-controls').hidden=true;view('planning');
    return {canPlan:()=>true,canWrite:()=>false,saveSelection};
  }
  authForm();syncAccess();
  cloud.onAuthChange(event=>{if(event==='SIGNED_OUT'){authRevision++;access=null;clearPrivateView();showAccess();}else if(event==='SIGNED_IN')setTimeout(()=>syncAccess(),0);});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&access?.role)refresh();});
  setInterval(()=>{if(document.visibilityState==='visible'&&access?.role)refresh();},60000);
  return {canPlan:admin,canWrite:admin,saveSelection,refresh};
}
