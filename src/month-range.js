import './month-range.css';
import {suggestMonthRange,validateMonthRange} from './period.js';

const CACHE = 'chile-month-ranges-v1';
const dateLabel = value => value.split('-').reverse().join('/');
let instance = 0;

function storage() {try {return localStorage;} catch {return null;}}
function savedRanges() {try {return JSON.parse(storage()?.getItem(CACHE) || '{}') || {};} catch {return {};}}
export function readMonthRange(month) {
  try {return validateMonthRange(month,savedRanges()[month]);} catch {return null;}
}
function rememberMonthRange(month,range) {
  const ranges = {...savedRanges(),[month]:range};
  const recent = Object.keys(ranges).filter(key=>/^\d{4}-\d{2}$/.test(key)).sort().slice(-12);
  try {storage()?.setItem(CACHE,JSON.stringify(Object.fromEntries(recent.map(key=>[key,ranges[key]]))));return Boolean(storage());} catch {return false;}
}

/** A confirmed month calendar is reusable; weekly CSV dates remain a separate choice. */
export function mountMonthRange(container,{month,onChange,onSave}={}) {
  const prefix = `month-range-${++instance}`;
  const controller = new AbortController();
  const listen = (target,event,handler) => target.addEventListener(event,handler,{signal:controller.signal});
  let currentMonth = '',range = null,editing = false,dirty = false,saving = false;
  container.classList.add('month-range');
  container.innerHTML = `<div class="month-range-heading"><div><strong>Fechas del mes operativo</strong><p data-range="summary" class="note" aria-live="polite"></p></div><button type="button" class="text-button" data-range="edit">Cambiar rango</button></div><div data-range="editor" class="month-range-editor"><p class="note" data-range="question"></p><div class="month-range-fields"><label for="${prefix}-start">El mes comienza el<input id="${prefix}-start" data-range="start" type="date" /></label><label for="${prefix}-end">El mes termina el<input id="${prefix}-end" data-range="end" type="date" /></label></div><div class="month-range-actions"><button type="button" class="secondary" data-range="save">Guardar rango del mes</button><button type="button" class="text-button" data-range="cancel">Cancelar</button></div></div><p data-range="message" class="note" role="status"></p>`;
  const find = key => container.querySelector(`[data-range="${key}"]`);
  const notify = () => onChange?.();
  function render() {
    const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(currentMonth);
    find('editor').hidden = !editing || !validMonth;
    find('edit').hidden = !range || editing;
    find('cancel').hidden = !range;
    find('summary').textContent = range ? `${dateLabel(range.start)} al ${dateLabel(range.end)} · rango guardado para ${currentMonth}.` : validMonth ? 'Confirma las fechas una vez para este mes. Se usarán en la selección y el avance.' : 'Elige un mes para definir sus fechas.';
    find('question').textContent = `¿Qué rango de fechas corresponde a ${currentMonth}? Incluye los días de otro mes que forman parte de esta operación.`;
    for (const key of ['start','end']) {find(key).disabled = !editing || saving;find(key).required = editing && validMonth;}
    find('save').disabled = saving;
    find('cancel').disabled = saving;
    find('save').textContent = saving ? 'Guardando rango…' : 'Guardar rango del mes';
  }
  function fill(values) {find('start').value = values?.start || '';find('end').value = values?.end || '';}
  function setMonth(value,force=false) {
    if (value === currentMonth && !force) return;
    currentMonth = value;range = readMonthRange(value);editing = !range;dirty = false;
    fill(range || (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? suggestMonthRange(value) : null));
    find('message').textContent = '';render();
  }
  function adoptShared(value,next) {
    let normalized;try {normalized = validateMonthRange(value,next);} catch {return;}
    rememberMonthRange(value,normalized);
    if (value !== currentMonth) return;
    const changed = range?.start !== normalized.start || range?.end !== normalized.end;
    if(dirty||saving){range=normalized;if(changed)notify();return;}
    range = normalized;editing = false;fill(range);render();if(changed)notify();
  }
  listen(find('edit'),'click',()=>{editing=true;dirty=true;fill(range);find('message').textContent='';render();notify();find('start').focus();});
  listen(find('cancel'),'click',()=>{editing=false;dirty=false;fill(range);find('message').textContent='';render();notify();});
  for (const key of ['start','end']) listen(find(key),'input',()=>{dirty=true;find('message').textContent='';notify();});
  listen(find('save'),'click',async()=>{
    if(saving)return;
    const submittedMonth=currentMonth;
    let next;try {next=validateMonthRange(submittedMonth,{start:find('start').value,end:find('end').value});}
    catch(error){find('message').textContent=error.message;find('message').classList.add('error');return;}
    saving=true;find('message').textContent='';find('message').classList.remove('error');render();
    try {
      const outcome=await onSave?.(submittedMonth,next);
      const remembered=rememberMonthRange(submittedMonth,next);
      if(submittedMonth===currentMonth){range=next;editing=false;dirty=false;fill(range);find('message').textContent=outcome?.message || (remembered?'Rango guardado. Puedes cambiarlo cuando lo necesites.':'Rango confirmado para esta sesión. El navegador no permite recordarlo.');notify();}
      document.dispatchEvent(new CustomEvent('chile-month-range-saved',{detail:{month:submittedMonth,range:next}}));
    } catch(error){if(submittedMonth===currentMonth){find('message').textContent=error.message || 'No se pudo guardar el rango.';find('message').classList.add('error');}}
    finally {saving=false;render();}
  });
  listen(document,'chile-month-range-saved',event=>adoptShared(event.detail.month,event.detail.range));
  setMonth(month || '');
  return {setMonth,adoptShared,getRange:()=>!editing&&range?{...range}:null,requireRange(){const current=!editing&&range?{...range}:null;if(!current){find('start').focus();throw new Error('Confirma primero las fechas del mes operativo con «Guardar rango del mes».');}return current;},destroy(){controller.abort();container.replaceChildren();}};
}
