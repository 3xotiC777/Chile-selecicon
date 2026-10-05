import './dashboard.css';
import { summarizeTracking, trackingCsv, productivityCsv } from './tracking.js';
import { DEFAULT_DASHBOARD_FILTERS, dashboardScopes, clearDashboardDetailFilters } from './dashboard-filters.js';
import { DASHBOARD_SORT_DEFAULTS, DASHBOARD_SORT_COLUMNS, sortDashboardRows, pointStatusLabel } from './dashboard-sort.js';
import {summarizeWeeklyProgress} from './weekly-progress.js';
import {weeklyChartMarkup,weeklyDetailText} from './weekly-chart.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const number = value => Number(value || 0).toLocaleString('es-CL');
const decimal = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('es-CL', {maximumFractionDigits:1}) : '—';
const percentage = value => `${decimal(Math.min(100, Math.max(0, Number(value) || 0)))} %`;
const field = (value, fallback = '—') => escape(value == null || value === '' ? fallback : value);
const PAGE_SIZE = 40;
const TABLE_HEADERS = {
  auditors:[['name','Auditor'],['surveys','Encuestas',true],['completedSurveys','TERMINADO',true],['fieldDays','Días activos',true],['surveysPerDay','Encuestas / día',true],['averageMinutes','Minutos / encuesta',true],['surveyEmpty','Vacías',true],['surveyRejected','Rechazadas',true]],
  points:[['folio','Punto / estudio'],['auditor','Auditor'],['status','Estado'],['target','Meta',true],['fulfilledVisits','Cumplidas',true],['remaining','Faltan',true],['failures','Vacías / rech.',true],['lastVisit','Última visita'],['planned','Planeación guardada']]
};
let instance = 0;

function date(value, includeTime = false) {
  if (!value) return 'Sin actualización';
  const parsed = new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(parsed.getTime())) return escape(value);
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle:'medium', ...(includeTime ? {timeStyle:'short',timeZone:'America/Bogota'} : {timeZone:'UTC'})
  }).format(parsed);
}

function monthLabel(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return 'Seguimiento mensual';
  return new Intl.DateTimeFormat('es-CL', {month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`));
}

function download(content, filename) {
  const url = URL.createObjectURL(new Blob([content], {type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function pointState(point) {
  return {label:pointStatusLabel(point),className:point.target == null?'unknown':point.complete?'complete':point.rejected>0?'rejected':point.empty>0?'empty':'pending'};
}

/** Mounts the shared, read-only field dashboard. Updating source files is handled by the host. */
export function mountDashboard(container, {snapshot = null, onRefresh, onDownloadPlanning, onExport} = {}) {
  if (!(container instanceof Element)) throw new TypeError('El dashboard necesita un contenedor.');
  const prefix = `tracking-${++instance}`;
  const filters = {...DEFAULT_DASHBOARD_FILTERS};
  const orders = {auditors:{...DASHBOARD_SORT_DEFAULTS.auditors},points:{...DASHBOARD_SORT_DEFAULTS.points}};
  let data = null, metadata = {}, page = 1, loading = false, error = '', exporting = false;
  let currentPoints = [], currentMonthlyPoints = [], currentAuditors = [], weeklySeries = null, selectedWeek = null, weeklyCalendarKey = null;
  const controller = new AbortController();
  const listen = (element, type, handler) => element.addEventListener(type, handler, {signal:controller.signal});
  const find = name => container.querySelector(`[data-dashboard="${name}"]`);

  container.classList.add('tracking-dashboard');
  container.innerHTML = `
    <div class="tracking-heading">
      <div><p class="eyebrow">SEGUIMIENTO COMPARTIDO</p><h1>Control de campo</h1><p data-dashboard="period" class="tracking-period">Seguimiento mensual</p></div>
      <div class="tracking-actions">
        <button type="button" class="tracking-button tracking-button-light" data-action="refresh">Actualizar vista <span aria-hidden="true">↻</span></button>
        <button type="button" class="tracking-button tracking-button-light" data-action="export-progress">Descargar avance <span aria-hidden="true">↓</span></button>
        <button type="button" class="tracking-button tracking-button-primary" data-action="download-plan">Última planeación · ZIP <span aria-hidden="true">↓</span></button>
      </div>
    </div>
    <div data-dashboard="message" aria-live="polite"></div>
    <div data-dashboard="empty"></div>
    <div data-dashboard="content" hidden>
      <div data-dashboard="source" class="tracking-source"></div>
      <section class="tracking-filters" aria-label="Filtros de seguimiento">
        <label for="${prefix}-client">Cliente<select id="${prefix}-client" data-filter="client"><option value="">Todos los clientes</option></select></label>
        <label for="${prefix}-study">Estudio<select id="${prefix}-study" data-filter="study"><option value="">Todos los estudios</option></select></label>
        <label for="${prefix}-auditor">Auditor<select id="${prefix}-auditor" data-filter="auditor"><option value="">Todos los auditores</option></select></label>
        <label for="${prefix}-region" data-dashboard="region-filter" hidden>Región<select id="${prefix}-region" data-filter="region"><option value="">Todas las regiones</option></select></label>
        <label for="${prefix}-status">Estado en el detalle<select id="${prefix}-status" data-filter="status"><option value="">Todos los estados</option><option value="complete">Cumplido</option><option value="pending">Con visitas pendientes</option><option value="unvisited">Sin visita válida</option><option value="empty">Con visitas vacías</option><option value="rejected">Con rechazos</option><option value="planned-pending">Enviados: pendientes de visita</option><option value="planned-complete">Enviados: visitados esta semana</option><option value="unknown">Sin meta configurada</option></select></label>
        <label class="tracking-search" for="${prefix}-search">Buscar en el detalle<input id="${prefix}-search" type="search" data-filter="search" placeholder="Folio, auditor, dirección o comuna" /></label>
        <div class="tracking-filter-bottom"><label class="tracking-check"><input type="checkbox" data-filter="planned" /> Solo programados en la última planeación</label><button type="button" class="text-button" data-action="reset">Limpiar filtros</button></div>
      </section>
      <div data-dashboard="plan" class="tracking-plan"></div>
      <p data-dashboard="monthly-scope" class="tracking-summary-scope" aria-live="polite"></p>
      <section data-dashboard="metrics" class="tracking-metrics" aria-label="Resumen de cumplimiento"></section>
      <div data-dashboard="alerts" class="tracking-alerts"></div>
      <section class="tracking-section tracking-weekly-chart" aria-labelledby="${prefix}-weekly-title">
        <div class="tracking-section-heading"><div><p class="eyebrow">MEDICIONES POR SEMANA</p><h2 id="${prefix}-weekly-title">Avance por semana del mes</h2></div></div>
        <p class="tracking-small">Mediciones que cumplen la meta mensual, según la frecuencia de cada punto. SOVI cuenta una medición por los ocho estudios completos.</p>
        <div data-dashboard="weekly"></div>
      </section>
      <section class="tracking-section" aria-labelledby="${prefix}-studies-title">
        <div class="tracking-section-heading"><div><p class="eyebrow">MEDICIONES DEL MES</p><h2 id="${prefix}-studies-title">Avance por estudio</h2></div><p data-dashboard="coverage" class="tracking-small"></p></div>
        <p class="tracking-small">El avance compara mediciones cumplidas con la meta mensual. Una medición SOVI requiere los ocho estudios TERMINADO de la misma semana.</p>
        <div data-dashboard="studies" class="tracking-table-wrap"></div>
      </section>
      <section class="tracking-section" aria-labelledby="${prefix}-auditors-title">
        <div class="tracking-section-heading"><div><p class="eyebrow">TRABAJO REGISTRADO</p><h2 id="${prefix}-auditors-title">Productividad por auditor</h2></div><button type="button" class="text-button" data-action="export-productivity">Descargar productividad</button></div>
        <p class="tracking-small">Encuestas por día usa los días con actividad registrada. La duración promedio considera las encuestas con un tiempo válido. Los VACIO sin fecha o todavía sin inicio en SQL se muestran en los puntos y quedan fuera de la productividad. Aquí aplican cliente, estudio y auditor del export. La región y los filtros del detalle no cambian esta tabla. Pulsa un encabezado para ordenar.</p>
        <div data-dashboard="auditors" class="tracking-table-wrap tracking-auditors"></div>
      </section>
      <section class="tracking-section" aria-labelledby="${prefix}-points-title">
        <div class="tracking-section-heading"><div><p class="eyebrow">PUNTOS Y VISITAS</p><h2 id="${prefix}-points-title">Detalle de cumplimiento</h2></div><p data-dashboard="point-count" class="tracking-small" aria-live="polite"></p></div>
        <div data-dashboard="detail-scope" class="tracking-detail-scope" aria-live="polite"></div>
        <div data-dashboard="points" class="tracking-table-wrap tracking-points"></div>
        <div data-dashboard="pagination" class="tracking-pagination"></div>
      </section>
      <details class="tracking-quality"><summary>Revisión del export y reglas de conteo</summary><div data-dashboard="quality"></div></details>
    </div>`;

  function renderMessage() {
    find('message').innerHTML = error ? `<div class="tracking-message tracking-message-error" role="alert">${escape(error)}</div>` : loading ? '<div class="tracking-message" role="status">Actualizando el seguimiento compartido…</div>' : '';
    container.querySelector('[data-action="refresh"]').disabled = loading || !onRefresh;
    container.querySelector('[data-action="export-progress"]').disabled = !data || exporting;
    container.querySelector('[data-action="download-plan"]').disabled = !onDownloadPlanning || !metadata.lastPlanningAvailable || loading;
  }

  function renderOptions() {
    const points = data?.points || [];
    const options = (key, label, values) => {
      const select = container.querySelector(`[data-filter="${key}"]`);
      if (filters[key] && !values.some(option => String(option.value) === String(filters[key]))) filters[key] = '';
      select.innerHTML = `<option value="">${label}</option>` + values.map(option => `<option value="${escape(option.value)}">${escape(option.label)}</option>`).join('');
      select.value = filters[key];
    };
    const unique = (key, source = points) => [...new Set(source.map(point => point[key]).filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b),'es')).map(value => ({value,label:value}));
    const sources = [...points,...(data?.daily || [])];
    options('client','Todos los clientes',unique('client',sources));
    options('study','Todos los estudios',unique('study',sources.filter(point => !filters.client || point.client === filters.client)));
    const auditorNames = new Map();
    const auditorRows = [...points,...(data?.daily || [])].filter(point => (!filters.client || point.client === filters.client) && (!filters.study || point.study === filters.study));
    for (const point of auditorRows) {
      const code = String(point.auditor);
      if (!auditorNames.has(code)) auditorNames.set(code,`${point.auditorName || point.auditor}${code.startsWith('nombre:')?' · solo en export':` (${point.auditor})`}`);
    }
    options('auditor','Todos los auditores',[...auditorNames].map(([value,label]) => ({value,label})).sort((a,b) => a.label.localeCompare(b.label,'es')));
    const regions = [...new Set(points.map(point=>String(point.region || '').trim().toUpperCase()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')).map(value=>({value,label:value}));
    options('region','Todas las regiones',regions);
    find('region-filter').hidden = !regions.length;
  }

  function syncFilterControls() {
    container.querySelectorAll('[data-filter]').forEach(control => {
      if (control.type === 'checkbox') control.checked = Boolean(filters[control.dataset.filter]);
      else control.value = filters[control.dataset.filter];
    });
  }

  function renderMetrics(summary, points) {
    const complete = summary.completedPoints ?? points.filter(point => point.complete).length;
    const cards = [
      {value:summary.target?percentage(summary.progress):'—',label:'Avance de mediciones',accent:true,description:summary.target?`${number(summary.fulfilledVisits)} de ${number(summary.target)} cumplidas`:'Sin meta para estos filtros'},
      {value:number(complete),label:'Puntos con meta cumplida',description:`de ${number(points.length)} puntos y estudios`},
      {value:number(summary.remaining),label:'Mediciones pendientes',description:`${number(summary.pendingPoints)} puntos requieren visitas`},
      {value:number(points.reduce((sum,point) => sum + (Number(point.empty)||0),0)),label:'Registros vacíos',description:'Pendientes o vacíos en el export',action:'empty',className:'empty'},
      {value:number(points.reduce((sum,point) => sum + (Number(point.rejected)||0),0)),label:'Visitas rechazadas',description:'Registradas en los puntos filtrados',action:'rejected',className:'rejected'}
    ];
    find('metrics').innerHTML = cards.map(card => `<${card.action?'button type="button"':'div'} class="tracking-metric ${card.accent?'tracking-metric-main':''} ${card.className||''}"${card.action?` data-action="status-${card.action}" aria-label="Ver puntos con ${card.label.toLowerCase()}"`:''}><span>${card.label}</span><strong>${card.value}</strong><small>${card.description}</small></${card.action?'button':'div'}>`).join('');
  }

  function renderStudies(studies) {
    find('studies').innerHTML = studies.length ? `<table class="tracking-table tracking-study-table"><thead><tr><th>Cliente / estudio</th><th>Avance mensual</th><th class="number">Mediciones</th><th class="number">Puntos cumplidos</th><th class="number">Pendientes</th></tr></thead><tbody>${studies.map(study => `<tr><td><small>${field(study.client)}</small><strong>${field(study.study)}</strong></td><td class="tracking-progress-cell">${study.hasTarget?`<div class="tracking-progress-label"><span>${percentage(study.progress)}</span>${study.complete ? '<em>Todos los puntos cumplidos</em>' : ''}</div><div class="tracking-progress" role="progressbar" aria-label="Avance de ${escape(study.study)}" aria-valuenow="${Math.round(Number(study.progress)||0)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.min(100,Math.max(0,Number(study.progress)||0))}%"></span></div>`:'<span class="tracking-badge unknown">Sin meta configurada</span>'}</td><td class="number">${study.hasTarget?`${number(study.fulfilledVisits)} <span class="tracking-muted">/ ${number(study.target)}</span>`:'—'}</td><td class="number">${number(study.completedPoints)} <span class="tracking-muted">/ ${number(study.points)}</span></td><td class="number">${study.hasTarget?number(study.remaining):'—'}</td></tr>`).join('')}</tbody></table>` : '<div class="tracking-no-results">No hay estudios para estos filtros.</div>';
  }

  function renderWeekly(points) {
    weeklySeries=summarizeWeeklyProgress(points,data.period);
    const calendarKey=JSON.stringify([data.period?.month,weeklySeries.weeks[0]?.start,weeklySeries.weeks.at(-1)?.end]);
    if(calendarKey!==weeklyCalendarKey){selectedWeek=null;weeklyCalendarKey=calendarKey;}
    if(!weeklySeries.weeks.some(week=>week.week===selectedWeek))selectedWeek=weeklySeries.weeks.findLast(week=>week.hasRecords)?.week||weeklySeries.weeks[0]?.week||null;
    find('weekly').innerHTML=weeklyChartMarkup(weeklySeries,{pointCount:points.length,selectedWeek});
  }

  function selectWeeklyDetail(week) {
    const selected=weeklySeries?.weeks.find(row=>row.week===week);
    if(!selected||!find('weekly-detail'))return;
    selectedWeek=week;find('weekly-detail').textContent=weeklyDetailText(weeklySeries,selected);
    container.querySelectorAll('[data-weekly-week]').forEach(button=>{
      const active=Number(button.dataset.weeklyWeek)===week;
      button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));
    });
  }

  function sortHeaders(table) {
    const order = orders[table];
    return TABLE_HEADERS[table].map(([key,label,numeric]) => {
      const active = order.key === key;
      const direction = active && order.direction === 'asc' ? 'descendente' : 'ascendente';
      return `<th scope="col"${numeric?' class="number"':''} aria-sort="${active?(order.direction==='asc'?'ascending':'descending'):'none'}"><button type="button" class="tracking-sort-button" data-action="sort" data-sort-table="${table}" data-sort-key="${key}" aria-label="${label}: ordenar ${direction}"><span>${label}</span><span class="tracking-sort-arrow" aria-hidden="true">${active?(order.direction==='asc'?'↑':'↓'):'↕'}</span></button></th>`;
    }).join('');
  }

  function renderAuditors(auditors) {
    find('auditors').innerHTML = auditors.length ? `<table class="tracking-table"><thead><tr>${sortHeaders('auditors')}</tr></thead><tbody>${auditors.map(auditor => `<tr><td><strong>${field(auditor.auditorName || auditor.name || auditor.auditor)}</strong><small>${String(auditor.auditor).startsWith('nombre:')?'Solo en el export':`Código ${field(auditor.auditor)}`}</small></td><td class="number">${number(auditor.surveys)}</td><td class="number">${number(auditor.completedSurveys)}</td><td class="number">${number(auditor.fieldDays)}</td><td class="number">${decimal(auditor.surveysPerDay)}</td><td class="number">${auditor.averageMinutes == null ? '—' : decimal(auditor.averageMinutes)}</td><td class="number">${number(auditor.surveyEmpty??auditor.empty)}</td><td class="number">${number(auditor.surveyRejected??auditor.rejected)}</td></tr>`).join('')}</tbody></table>` : '<div class="tracking-no-results">El export no tiene actividad para este cliente, estudio o auditor.</div>';
  }

  function renderPoints() {
    const pages = Math.max(1,Math.ceil(currentPoints.length/PAGE_SIZE));
    page = Math.min(page,pages);
    const visible = currentPoints.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
    find('point-count').textContent = `${number(currentPoints.length)} puntos y estudios · ${number(new Set(currentPoints.map(point => point.folio)).size)} folios únicos`;
    const detailFilters = [];
    if (filters.planned) detailFilters.push('Solo programados en la última planeación');
    if (filters.status) detailFilters.push(container.querySelector('[data-filter="status"]').selectedOptions[0]?.textContent || filters.status);
    if (filters.search) detailFilters.push(`Búsqueda: ${filters.search}`);
    find('detail-scope').innerHTML = `<div><strong>${number(currentPoints.length)} de ${number(currentMonthlyPoints.length)} puntos y estudios del mes</strong>${detailFilters.length ? `<div class="tracking-detail-chips">${detailFilters.map(label => `<span>${escape(label)}</span>`).join('')}</div>` : '<span>Se muestran todos los puntos de los filtros de cliente, estudio, auditor y región.</span>'}</div>${detailFilters.length ? '<button type="button" class="text-button" data-action="clear-detail">Ver todos los puntos del mes</button>' : ''}`;
    find('points').innerHTML = visible.length ? `<table class="tracking-table"><thead><tr>${sortHeaders('points')}</tr></thead><tbody>${visible.map(point => {
      const state = pointState(point);
      const halves = point.rule === 'fortnightly';
      const partial = point.partialSovi?.length ? `<details class="tracking-sovi-detail"><summary>${number(point.partialSovi.length)} semana${point.partialSovi.length>1?'s':''} SOVI incompleta${point.partialSovi.length>1?'s':''}</summary><ul>${point.partialSovi.map(week => `<li>${date(week.weekStart)}: ${number(week.completedStudies)} de 8 TERMINADO.<br>Faltan: ${(week.missingStudies || []).map(escape).join(', ')}.</li>`).join('')}</ul></details>` : '';
      return `<tr><td><strong class="tracking-folio">${field(point.folio)}</strong><span>${field(point.study)}</span><small>${field([point.commune,point.region].filter(Boolean).join(' · '),point.client||'—')}</small>${point.location ? `<small>${escape(point.location)}</small>` : ''}</td><td><strong>${field(point.auditorName || point.auditor)}</strong><small>${field(point.auditor)}</small></td><td><span class="tracking-badge ${state.className}">${state.label}</span>${halves?`<small>Q1: ${number(point.visitsFirstHalf)} · Q2: ${number(point.visitsSecondHalf)}</small>`:''}${partial}</td><td class="number">${point.target==null?'—':number(point.target)}</td><td class="number">${number(point.fulfilledVisits)}${Number(point.validVisits)>Number(point.fulfilledVisits)?`<small>${number(point.validVisits)} válidas</small>`:''}</td><td class="number">${point.remaining==null?'—':number(point.remaining)}</td><td class="number">${number(point.empty)} / ${number(point.rejected)}</td><td>${point.lastVisit?date(point.lastVisit):'Sin visita'}</td><td>${point.plannedCurrentWeek?`<span class="tracking-badge ${point.currentWeekCompleted?'complete':'planned'}">${point.currentWeekCompleted?'Visita completada':'Enviado · pendiente'}</span>`:'—'}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="tracking-no-results"><strong>No hay puntos con estos filtros.</strong><p>Limpia el estado o la búsqueda para ver otros puntos del mes.</p><button type="button" class="text-button" data-action="reset">Limpiar filtros</button></div>';
    find('pagination').innerHTML = currentPoints.length ? `<span>Mostrando ${number((page-1)*PAGE_SIZE+1)}–${number(Math.min(page*PAGE_SIZE,currentPoints.length))} de ${number(currentPoints.length)}</span><div><button type="button" class="tracking-page-button" data-action="previous"${page===1?' disabled':''} aria-label="Página anterior">←</button><span>Página ${page} de ${pages}</span><button type="button" class="tracking-page-button" data-action="next"${page===pages?' disabled':''} aria-label="Página siguiente">→</button></div>` : '';
  }

  function render() {
    renderMessage();
    find('content').hidden = !data;
    find('empty').innerHTML = data || loading ? '' : '<div class="tracking-empty"><span aria-hidden="true">↗</span><h2>El seguimiento todavía no tiene datos</h2><p>Guarda la planeación, el universo y el export del mes para compartir el avance con campo. Después podrás actualizar las visitas cargando solo el export.</p></div>';
    if (!data) return;
    const {monthlyPoints,points,productivityPoints,daily} = dashboardScopes(data,filters);
    const aggregate = summarizeTracking(monthlyPoints,[]);
    const productivityAggregate = summarizeTracking(productivityPoints,daily);
    currentPoints = sortDashboardRows(points,'points',orders.points.key,orders.points.direction);
    currentMonthlyPoints = monthlyPoints;
    currentAuditors = sortDashboardRows(productivityAggregate.auditors || [],'auditors',orders.auditors.key,orders.auditors.direction);
    const summary = aggregate.summary || aggregate;
    find('period').textContent = `${monthLabel(data.period?.month)} · semana ${data.period?.week || '—'} de ${data.period?.weeks || '—'}${data.period?.monthRange?` · ${date(data.period.monthRange.start)} al ${date(data.period.monthRange.end)}`:''}`;
    const quality = data.quality || {};
    find('source').innerHTML = `<div><span class="tracking-live-dot" aria-hidden="true"></span><strong>Última actualización</strong><span>${date(metadata.updatedAt || data.updatedAt,true)}</span></div><div><strong>Export</strong><span>${field(metadata.reportName,'Sin nombre de archivo')} · ${number(quality.rows)} registros leídos</span>${data.period?.lastReportDay?`<span>Visitas hasta ${date(data.period.lastReportDay)}</span>`:''}</div>`;
    const planPeriod = metadata.planPeriod || data.planPeriod || {};
    const planned = (data.points || []).filter(point => point.plannedCurrentWeek);
    const plannedPoints = new Set(planned.map(point => point.folio)).size;
    find('plan').innerHTML = metadata.lastPlanningAvailable || planned.length ? `<div><span class="eyebrow">ÚLTIMA PLANEACIÓN GUARDADA</span><strong>${planPeriod.week ? `Semana ${escape(planPeriod.week)} · ` : ''}${planPeriod.start ? `${date(planPeriod.start)} al ${date(planPeriod.end)}` : field(metadata.planningName,'Planeación guardada')}</strong><span>${number(plannedPoints)} folios programados · ${number(planned.length)} puntos y estudios · ${number(planned.filter(point=>point.plannedPending).length)} pendientes de visita esta semana</span></div><button type="button" class="tracking-button tracking-button-light" data-action="show-planned" aria-pressed="${filters.planned}">${filters.planned?'Ver todos los puntos':'Ver puntos programados'} <span aria-hidden="true">→</span></button>` : '<div><strong>Aún no hay una selección semanal guardada.</strong><span>Genera y guarda una planeación para consultar aquí los puntos programados para campo.</span></div>';
    const monthlyScope = [filters.client,filters.study,filters.auditor?`Auditor ${filters.auditor}`:'',filters.region?`Región ${filters.region}`:''].filter(Boolean);
    find('monthly-scope').textContent = `Avance mensual · ${number(monthlyPoints.length)} puntos y estudios${monthlyScope.length?` · ${monthlyScope.join(' · ')}`:''}. Estado, búsqueda y solo programados filtran el detalle.`;
    renderMetrics(summary,monthlyPoints);
    const pending = monthlyPoints.filter(point => !point.complete && !point.validVisits).length;
    find('alerts').innerHTML = pending ? `<span><i aria-hidden="true"></i>${number(pending)} puntos y estudios del mes todavía no tienen una visita válida.</span>` : monthlyPoints.length ? '<span class="tracking-complete-message">Todos los puntos del mes en estos filtros tienen al menos una visita válida.</span>' : '';
    renderWeekly(monthlyPoints);
    find('coverage').textContent = `${number((aggregate.studies || []).length)} estudios en esta vista`;
    renderStudies(aggregate.studies || []);
    renderAuditors(currentAuditors);
    renderPoints();
    const knownQuality = [
      ['rows','Registros leídos'],['duplicates','Duplicados omitidos'],['invalidDates','Sin fecha válida'],['undatedEmpty','VACIO sin fecha'],
      ['outsidePeriod','Fuera del período'],['unknownStudies','Estudios sin correspondencia'],
      ['incompleteSovi','Semanas SOVI incompletas'],['missingFrequencies','Frecuencias faltantes']
    ];
    find('quality').innerHTML = `<div class="tracking-quality-grid">${knownQuality.filter(([key]) => quality[key] != null).map(([key,label]) => `<div><span>${label}</span><strong>${number(quality[key])}</strong></div>`).join('')}</div>${data.warnings?.length?`<ul>${data.warnings.map(warning => `<li>${escape(typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning))}</li>`).join('')}</ul>`:''}<p class="tracking-small">Solo TERMINADO cumple visitas. Las vacías y rechazadas se muestran para seguimiento. Los registros duplicados no aumentan el avance. La productividad contabiliza encuestas; SOVI conserva sus ocho encuestas por medición.</p>`;
  }

  async function perform(action, details = {}) {
    if(action==='weekly-detail'){selectWeeklyDetail(Number(details.weeklyWeek));return;}
    if (action === 'sort') {
      const table = details.sortTable, key = details.sortKey;
      if (!Object.hasOwn(DASHBOARD_SORT_COLUMNS,table) || !DASHBOARD_SORT_COLUMNS[table].includes(key)) return;
      const order = orders[table];
      orders[table] = {key,direction:order.key===key && order.direction==='asc'?'desc':'asc'};
      page=1;render();return;
    }
    if (action === 'reset') {
      Object.assign(filters,DEFAULT_DASHBOARD_FILTERS);
      syncFilterControls();
      page=1;renderOptions();render();return;
    }
    if (action === 'clear-detail') {
      Object.assign(filters,clearDashboardDetailFilters(filters));
      syncFilterControls();page=1;render();return;
    }
    if (action === 'next' || action === 'previous') {page += action==='next'?1:-1;renderPoints();return;}
    if (action === 'show-planned') {
      const planned = !filters.planned;
      Object.assign(filters,clearDashboardDetailFilters(filters),{planned});
      syncFilterControls();page=1;render();find('points').scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});return;
    }
    if (action?.startsWith('status-')) {filters.status=action.slice(7);container.querySelector('[data-filter="status"]').value=filters.status;page=1;render();return;}
    if (action === 'refresh' && onRefresh) {
      loading=true;error='';renderMessage();
      try {const next=await onRefresh();if(next)setSnapshot(next);} catch(failure) {error=failure.message || 'No se pudo actualizar. Vuelve a intentarlo.';}
      finally {loading=false;renderMessage();}return;
    }
    if (action === 'download-plan' && onDownloadPlanning) {
      try {await onDownloadPlanning();} catch(failure) {error=failure.message || 'No se pudo descargar la planeación.';renderMessage();}return;
    }
    if (action === 'export-progress' || action === 'export-productivity') {
      if (!data || exporting) return;
      const kind=action==='export-progress'?'progress':'productivity';
      const rows=kind==='progress'?currentPoints:currentAuditors;
      const filename=`${kind==='progress'?'AVANCE':'PRODUCTIVIDAD'}_CHILE_${data.period?.month || 'MES'}.csv`;
      const content=kind==='progress'?trackingCsv(rows):productivityCsv(rows);
      exporting=true;error='';renderMessage();
      try {if(onExport)await onExport({kind,rows,filename,content});else download(content,filename);}
      catch(failure) {error=failure.message || 'No se pudo descargar el avance.';}
      finally {exporting=false;renderMessage();}
    }
  }

  listen(container,'click',event => {
    const action=event.target.closest('[data-action]');
    if (action && container.contains(action) && !action.disabled) perform(action.dataset.action,action.dataset);
  });
  listen(container,'input',event => {
    const control=event.target.closest('[data-filter]');
    if (!control) return;
    const key=control.dataset.filter;
    filters[key]=control.type==='checkbox'?control.checked:control.value;
    page=1;
    if (['client','study'].includes(key)) renderOptions();
    render();
  });
  listen(container,'focusin',event=>{const button=event.target.closest('[data-weekly-week]');if(button)selectWeeklyDetail(Number(button.dataset.weeklyWeek));});

  function setSnapshot(next) {
    metadata=next || {};
    data=next?.tracking || (next?.points ? next : null);
    if (!data) {
      Object.assign(filters,DEFAULT_DASHBOARD_FILTERS);
      orders.auditors={...DASHBOARD_SORT_DEFAULTS.auditors};orders.points={...DASHBOARD_SORT_DEFAULTS.points};
      syncFilterControls();currentPoints=[];currentMonthlyPoints=[];currentAuditors=[];weeklySeries=null;selectedWeek=null;weeklyCalendarKey=null;
    }
    page=1;error='';
    if (metadata.lastPlanningAvailable == null) metadata={...metadata,lastPlanningAvailable:Boolean(metadata.planPeriod || data?.planPeriod || data?.points?.some(point => point.plannedCurrentWeek))};
    renderOptions();render();
  }
  setSnapshot(snapshot);
  return {
    setSnapshot,
    setState(state={}) {if('loading' in state)loading=Boolean(state.loading);if('error' in state)error=state.error||'';render();},
    getFilters() {return {...filters};},
    getSort() {return {auditors:{...orders.auditors},points:{...orders.points}};},
    destroy() {controller.abort();container.replaceChildren();container.classList.remove('tracking-dashboard');}
  };
}

