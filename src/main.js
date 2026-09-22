import './style.css';
import { DEFAULT_ALIASES,reviewCsv } from './engine.js';
import { suggestPeriod } from './period.js';
const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number(value).toLocaleString('es-CL');
const CACHE='chile-universe-v1';
let universe=null,result=null,zip=null,revision=0,periodRevision=0,busy=false,universeTask=null,planningTask=null;
$('month').value=new Date().toISOString().slice(0,7);
$('aliases').innerHTML=Object.entries(DEFAULT_ALIASES).filter(([name])=>name!=='CRUZ VERDE PROFUNDIDAD').map(([name,alias])=>`<label>${escape(name)}<input data-alias="${escape(name)}" value="${escape(alias)}" /></label>`).join('');
function runWorker(task,data,progress){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
    const timeout=setTimeout(()=>{worker.terminate();reject(new Error('La lectura tardó demasiado. Guarda una copia del Excel con solo las hojas necesarias y vuelve a intentarlo.'));},120000);
    const finish=()=>{clearTimeout(timeout);worker.terminate();};
    worker.onmessage=({data:r})=>{if(r.progress){progress?.(r.progress);return;}finish();if(r.ok)resolve(r);else{const e=new Error(r.error);e.details=r.details;reject(e);}};
    worker.onerror=()=>{finish();reject(new Error('No se pudo procesar el archivo. Recarga la página e intenta de nuevo.'));};
    worker.postMessage({task,data});
  });
}
function invalidate(){revision++;result=null;zip=null;$('results').hidden=true;if(!busy)$('status').replaceChildren();}
function showStatus(message,error=false,details=[]){$('status').innerHTML=`<div class="status-message ${error?'error':busy?'busy':''}">${escape(message)}${details.length?`<details><summary>Ver ${number(details.length)} observaciones</summary><ul>${details.slice(0,150).map(d=>`<li>${escape(d)}</li>`).join('')}</ul>${details.length>150?'<p>Se muestran las primeras 150. Corrige los datos de origen para continuar.</p>':''}</details>`:''}</div>`;}
function updatePeriod(){
  const week=Number($('week').value),weeks=Number($('weeks').value),holidays=Number($('holidays').value);
  $('report').required=week>1;
  $('report-required').textContent=week===1?'Opcional en semana 1':'Obligatorio desde semana 2';
  const schedule=week===1||week===3?'primera mitad por auditor.':week===5?'solo pendientes; sin tercera medición.':'segunda mitad y visitas pendientes de esta quincena.';
  $('period-note').textContent=`${week<3?'Primera':'Segunda'} quincena · ${schedule} Aplica a SOVI, OSA quincenal y Cruz Verde de frecuencia 2. ${week===weeks?'Última semana: Facing puede coincidir con SOVI para cerrar pendientes.':''} ${holidays?'Fijas OSA: '+(100-17*holidays)+' % de la base.':'Fijas OSA: todas las de la planeación.'}`;
  document.querySelectorAll('.week-track span').forEach((s,i)=>s.classList.toggle('active',i+1===week));$('track5').hidden=weeks===4;
  updateReady();
}
function updateReady(){const missing=[];if(!$('planning').files.length)missing.push('planeación');if(!universe)missing.push('universo');if(Number($('week').value)>1&&!$('report').files.length)missing.push('export');$('ready-note').textContent=missing.length?'Falta cargar: '+missing.join(', ')+'.':'Archivos listos. Genera la selección y revisa el resumen.';}
function updateUniverse(name){$('universe-name').textContent=`${name} · ${number(universe.length)} frecuencias`;$('universe').closest('.file-box').classList.add('loaded');$('forget').hidden=false;updateReady();}
try{const cached=JSON.parse(localStorage.getItem(CACHE));if(cached?.version===1&&Array.isArray(cached.rows)&&cached.rows.length){universe=cached.rows;updateUniverse(cached.name);}}catch{/* Browser storage may be unavailable. */}
$('forget').addEventListener('click',()=>{invalidate();universe=null;$('universe').value='';universeTask=null;try{localStorage.removeItem(CACHE);}catch{}$('universe-name').textContent='Selecciona UNIVERSO CHILE.xlsx';$('universe').closest('.file-box').classList.remove('loaded');$('forget').hidden=true;updateReady();});
for(const name of ['month','week','weeks','holidays'])$(name).addEventListener('change',()=>{periodRevision++;invalidate();updatePeriod();});
document.querySelectorAll('[data-alias],#depth-alias,#excluded-folios,#auditor-overrides').forEach(input=>input.addEventListener('input',invalidate));
try{$('auditor-overrides').value=localStorage.getItem('chile-auditor-overrides-v1')||'';}catch{}
$('auditor-overrides').addEventListener('change',()=>{try{localStorage.setItem('chile-auditor-overrides-v1',$('auditor-overrides').value);}catch{}});
for(const name of ['planning','report','universe'])$(name).addEventListener('change',async()=>{
  invalidate();const file=$(name).files[0],thisPeriodRevision=periodRevision;
  $(name+'-name').textContent=file?file.name:'Selecciona un archivo';$(name).closest('.file-box').classList.toggle('loaded',!!file);updateReady();
  if(!file)return;
  if(name==='universe'){
    universe=null;updateReady();
    universeTask=(async()=>{const loaded=await runWorker('universe',await file.arrayBuffer());if($('universe').files[0]!==file)return;universe=loaded.data;try{localStorage.setItem(CACHE,JSON.stringify({version:1,name:file.name,rows:universe}));}catch{showStatus('Universo cargado. Este navegador no permite recordarlo: tendrás que cargarlo de nuevo la próxima vez.');}updateUniverse(file.name);})();
    try{await universeTask;}catch(e){if($('universe').files[0]===file){universe=null;showStatus(e.message,true,e.details);}}finally{updateReady();}
  }
  if(name==='planning'){
    planningTask=(async()=>{const loaded=await runWorker('planning',await file.arrayBuffer());if($('planning').files[0]!==file)return;const p=loaded.data;$('planning-name').textContent=`${file.name} · ${p.start.split('-').reverse().join('/')} a ${p.end.split('-').reverse().join('/')}`;if(periodRevision===thisPeriodRevision){const suggested=suggestPeriod(p.start);$('month').value=suggested.month;$('week').value=String(suggested.week);$('weeks').value=String(suggested.weeks);updatePeriod();}})();
    try{await planningTask;}catch(e){if($('planning').files[0]===file)showStatus(e.message,true,e.details);}
  }
});
updatePeriod();
function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function renderResults(){
  const m=result.metrics;
  $('results').innerHTML=`<div class="result-header"><div><p class="eyebrow">SELECCIÓN GENERADA</p><h2>Lista para revisar y descargar</h2><p>${escape(result.period.start)} al ${escape(result.period.end)} · semana ${result.period.week} de ${result.period.weeks}</p></div><button type="button" id="download" class="primary">Descargar ZIP <span>↓</span></button></div><div class="metrics">${[[m.points,'Puntos únicos'],[m.rows,'Asignaciones'],[m.files,'Archivos CSV'],[m.auditors,'Auditores']].map(([n,label])=>`<div><strong>${number(n)}</strong><span>${label}</span></div>`).join('')}</div>${result.warnings.length?`<div class="warnings"><strong>Observaciones de la selección</strong><ul>${result.warnings.map(w=>`<li>${escape(w)}</li>`).join('')}</ul></div>`:''}<p class="note">Fijas OSA: ${number(m.fixedTarget)} de ${number(m.fixedTotal)}. SOVI: ${number(m.sovi)} puntos × 8 estudios. Export: ${number(result.history.valid)} encuestas válidas utilizadas; ${number(result.history.duplicates)} duplicadas omitidas.</p><div class="table-wrap"><table><thead><tr><th>Archivo de carga</th><th class="number">Puntos</th><th class="number">Filas</th></tr></thead><tbody>${result.files.map(f=>`<tr><td>${escape(f.name)}</td><td class="number">${number(new Set(f.rows.map(r=>r.folio)).size)}</td><td class="number">${number(f.rows.length)}</td></tr>`).join('')}</tbody></table></div><details><summary>Reparto de SOVI por auditor y frecuencia</summary><div class="table-wrap"><table><thead><tr><th>Auditor</th><th>Frecuencia</th><th class="number">Base de reparto</th><th class="number">Pendientes con OSA</th><th class="number">Seleccionados</th></tr></thead><tbody>${result.soviAuditors.map(a=>`<tr><td>${escape(a.name)} (${escape(a.auditor)})</td><td>${a.frequency==='fixed'?'Fija':'Quincenal'}</td><td class="number">${a.eligible}</td><td class="number">${a.pending}</td><td class="number">${a.selected}</td></tr>`).join('')}</tbody></table></div></details><details><summary>Revisar puntos y motivos de selección</summary><div class="detail-tools"><label>Buscar folio, auditor o estudio<input id="search" placeholder="Ej. folio o nombre del auditor" /></label><button type="button" class="text-button" id="review-download">Descargar detalle de revisión</button></div><p class="note">Quincena ${result.period.half} en curso; la segunda comienza el ${escape(result.period.secondHalfStart)}. Este detalle incluye seleccionados y excluidos, con las visitas de cada quincena. Se descarga por separado; el ZIP solo contiene los CSV de carga.</p><div id="decision-rows" class="detail-table"></div></details>`;
  $('results').hidden=false;
  $('download').addEventListener('click',()=>download(zip,'application/zip',`CHILE_${result.period.month}_SEMANA_${result.period.week}.zip`));
  $('review-download').addEventListener('click',()=>download(reviewCsv(result.decisions),'text/csv;charset=utf-8',`REVISION_CHILE_${result.period.month}_S${result.period.week}.csv`));
  function details(){const query=$('search').value.toLowerCase(),filtered=result.decisions.filter(r=>`${r.folio} ${r.auditorName} ${r.study}`.toLowerCase().includes(query));$('decision-rows').innerHTML=`<p class="note">${number(filtered.length)} registros. Se muestran hasta 200.</p><table><thead><tr><th>Folio / auditor</th><th>Estudio</th><th>Visitas mes</th><th>Quincena 1</th><th>Quincena 2</th><th>Selección</th><th>Motivo</th></tr></thead><tbody>${filtered.slice(0,200).map(r=>`<tr><td>${escape(r.folio)}<br><small>${escape(r.auditorName)}</small></td><td>${escape(r.study)}</td><td>${r.visits??'—'}</td><td>${r.visitsFirstHalf??'—'}</td><td>${r.visitsSecondHalf??'—'}</td><td>${r.selected?'Sí':'No'}</td><td>${escape(r.reason)}</td></tr>`).join('')}</tbody></table>`;}
  $('search').addEventListener('input',details);details();
}
$('selection-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;invalidate();busy=true;const submittedRevision=revision;
  $('generate').disabled=true;$('generate').textContent='Procesando…';$('selection-form').setAttribute('aria-busy','true');
  try{
    await Promise.all([universeTask,planningTask]);
    if(!universe)throw new Error('Carga UNIVERSO CHILE.xlsx para cruzar las frecuencias.');
    const planningFile=$('planning').files[0],reportFile=$('report').files[0];
    if(!planningFile)throw new Error('Carga el archivo de planeación.');
    const options={month:$('month').value,week:Number($('week').value),weeks:Number($('weeks').value),holidays:Number($('holidays').value),aliases:Object.fromEntries([...document.querySelectorAll('[data-alias]')].map(i=>[i.dataset.alias,i.value]))};
    options.aliases['CRUZ VERDE PROFUNDIDAD']=$('depth-alias').value;
    options.excludedFolios=$('excluded-folios').value.split(/[,;\s]+/).filter(Boolean);
    const correctionEntries=$('auditor-overrides').value.split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
    if(correctionEntries.some(s=>!/^\d+\s*=\s*\d+$/.test(s)))throw new Error('Usa FOLIO=CODIGO en las correcciones de auditor, separados por comas.');
    options.auditorOverrides=Object.fromEntries(correctionEntries.map(s=>s.split('=').map(v=>v.trim())));
    showStatus('Leyendo archivos en tu navegador…');
    const loaded=await runWorker('select',{planning:await planningFile.arrayBuffer(),report:reportFile?await reportFile.arrayBuffer():null,universe,options},message=>showStatus(message));
    if(submittedRevision!==revision){showStatus('Cambiaste los archivos o ajustes durante el cálculo. Genera de nuevo la selección.');return;}
    result=loaded.data;zip=loaded.zip;renderResults();$('status').replaceChildren();$('results').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){showStatus(e.message,true,e.details);}
  finally{busy=false;$('generate').disabled=false;$('generate').innerHTML='Generar selección <span>→</span>';$('selection-form').removeAttribute('aria-busy');}
});
