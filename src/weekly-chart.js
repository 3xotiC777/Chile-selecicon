import './weekly-chart.css';

const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const number=value=>Number(value||0).toLocaleString('es-CL');
const percentage=value=>`${Number(value||0).toLocaleString('es-CL',{maximumFractionDigits:1})} %`;
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):'—';
const shortDate=value=>date(value).slice(0,5);

export function weeklyDetailText(series,week){
  if(!week)return '';
  const label=`Semana ${week.week} · ${date(week.start)} al ${date(week.end)}.`;
  const weekly=week.hasRecords?`${number(week.fulfilledVisits)} mediciones cumplidas · aportan ${percentage(week.progress)} de la meta mensual.`:'Sin registros del export para esta semana.';
  return `${label} ${weekly} Acumulado: ${number(week.cumulativeVisits)} de ${number(series.target)} mediciones · ${percentage(week.cumulativeProgress)} del mes.`;
}

function scaleMaximum(value){
  if(value<=1)return 2;
  const magnitude=10**Math.floor(Math.log10(value));
  return Math.ceil(Math.ceil(value/magnitude)*magnitude/2)*2;
}

/** A native-button bar chart keeps the same information available by mouse, touch and keyboard. */
export function weeklyChartMarkup(series,{pointCount=0,selectedWeek}={}){
  if(!pointCount)return '<div class="tracking-no-results">No hay puntos para estos filtros. Cambia cliente, estudio, auditor o región para ver su avance semanal.</div>';
  if(!series.target)return '<div class="tracking-no-results">Estos puntos no tienen una meta mensual configurada. Revisa sus frecuencias para calcular el avance semanal.</div>';
  if(!series.hasWeeklyData||!series.weeks.length)return '<div class="tracking-no-results">Actualiza la vista con el export del mes para calcular cómo se distribuyen las mediciones por semana.</div>';
  const selected=series.weeks.find(week=>week.week===selectedWeek)||series.weeks.findLast(week=>week.hasRecords)||series.weeks[0];
  const maximum=scaleMaximum(Math.max(...series.weeks.map(week=>Number(week.fulfilledVisits)||0)));
  return `<div class="weekly-chart-legend"><span><i aria-hidden="true"></i>Mediciones cumplidas en cada semana</span><strong>Meta del mes: ${number(series.target)}</strong></div>
    <div class="weekly-chart-plot" role="group" aria-label="Gráfica de mediciones cumplidas por semana">
      <div class="weekly-chart-axis" aria-hidden="true"><span>${number(maximum)}</span><span>${number(maximum/2)}</span><span>0</span></div>
      <div class="weekly-chart-scroll"><div class="weekly-chart-columns" style="--weekly-weeks:${series.weeks.length}">
        ${series.weeks.map(week=>`<button type="button" class="weekly-chart-week${week.week===selected.week?' is-active':''}${!week.hasRecords?' is-unreported':''}" data-action="weekly-detail" data-weekly-week="${week.week}" data-fulfilled="${Number(week.fulfilledVisits)||0}" data-progress="${Number(week.progress)||0}" aria-pressed="${week.week===selected.week}" aria-label="Ver semana ${week.week}: ${week.hasRecords?`${number(week.fulfilledVisits)} mediciones cumplidas, ${percentage(week.progress)} de la meta mensual`:'sin registros del export'}" title="${escape(weeklyDetailText(series,week))}">
          <span class="weekly-chart-value">${week.hasRecords?number(week.fulfilledVisits):'<small>Sin<br>registros</small>'}</span>
          <span class="weekly-chart-column" aria-hidden="true"><span class="weekly-chart-bar${week.fulfilledVisits?'':' is-zero'}" style="height:${Math.max(0,Number(week.fulfilledVisits)||0)/maximum*100}%"></span></span>
          <span class="weekly-chart-week-label">Semana ${week.week}</span>
          <span class="weekly-chart-dates"><span>${shortDate(week.start)}</span><span>– ${shortDate(week.end)}</span></span>
        </button>`).join('')}
      </div></div>
    </div>
    <p class="weekly-chart-detail" data-dashboard="weekly-detail" aria-live="polite">${escape(weeklyDetailText(series,selected))}</p>
    <p class="weekly-chart-note">Selecciona una barra para ver sus fechas y el avance acumulado. Sin registros indica que el export todavía no cubre esa semana.</p>`;
}
