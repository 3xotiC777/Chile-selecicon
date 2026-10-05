// Keep the table order independent of pagination and of the source snapshot.
const collator = new Intl.Collator('es', {numeric:true, sensitivity:'base'});
const text = value => value == null || String(value).trim() === '' ? null : String(value);
const numeric = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const value = (row, ...keys) => keys.map(key => row?.[key]).find(entry => entry != null && String(entry).trim() !== '');
const auditorName = row => text(value(row,'auditorName','actualName','auditor'));

export function pointStatusLabel(point) {
  if (point?.target == null) return 'Sin meta configurada';
  if (point.complete) return 'Cumplido';
  if (Number(point.rejected) > 0) return 'Con rechazo';
  if (Number(point.empty) > 0) return 'Con visita vacía';
  return Number(point.validVisits) > 0 ? 'En avance' : 'Sin visita válida';
}

function visitDate(row) {
  const raw = row?.lastVisit;
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw.getTime() : null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(raw)) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return null;
  if (raw.length === 10 && date.toISOString().slice(0,10) !== raw) return null;
  return date.getTime();
}

const definitions = {
  auditors: {
    name: row => [auditorName(row),text(row?.auditor)],
    surveys: row => [numeric(row?.surveys)],
    completedSurveys: row => [numeric(row?.completedSurveys)],
    fieldDays: row => [numeric(row?.fieldDays)],
    surveysPerDay: row => [numeric(row?.surveysPerDay)],
    averageMinutes: row => [numeric(row?.averageMinutes)],
    surveyEmpty: row => [numeric(value(row,'surveyEmpty','empty'))],
    surveyRejected: row => [numeric(value(row,'surveyRejected','rejected'))]
  },
  points: {
    folio: row => [text(row?.folio),text(row?.study)],
    auditor: row => [auditorName(row),text(row?.auditor)],
    status: row => [pointStatusLabel(row)],
    target: row => [numeric(row?.target)],
    fulfilledVisits: row => [numeric(row?.fulfilledVisits)],
    remaining: row => [numeric(row?.remaining)],
    // The displayed pair sorts by empty surveys, then by rejected surveys.
    failures: row => [numeric(row?.empty),numeric(row?.rejected)],
    lastVisit: row => [visitDate(row)],
    // These are three known display states, including an unassigned point.
    planned: row => [row?.plannedCurrentWeek ? row.currentWeekCompleted ? 0 : 1 : 2]
  }
};

export const DASHBOARD_SORT_COLUMNS = Object.freeze({
  auditors: Object.freeze(Object.keys(definitions.auditors)),
  points: Object.freeze(Object.keys(definitions.points))
});
export const DASHBOARD_SORT_DEFAULTS = Object.freeze({
  auditors:Object.freeze({key:'surveys',direction:'desc'}),
  points:Object.freeze({key:'folio',direction:'asc'})
});

function compareValues(a, b, direction) {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const compared = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a),String(b));
  return compared * direction;
}
function compareTuple(a, b, direction) {
  for (let index=0; index<Math.max(a.length,b.length); index++) {
    const compared = compareValues(a[index] ?? null,b[index] ?? null,direction);
    if (compared) return compared;
  }
  return 0;
}

/** Sort all filtered rows before pagination. Missing values stay last in both directions. */
export function sortDashboardRows(rows, table, key, direction='asc') {
  const columns = Object.hasOwn(definitions,table) ? definitions[table] : null;
  const getter = columns && Object.hasOwn(columns,key) ? columns[key] : null;
  if (!getter) throw new RangeError('La columna no admite ordenamiento en esta tabla.');
  if (!Array.isArray(rows)) throw new TypeError('El ordenamiento necesita una lista de filas.');
  const order = direction === 'desc' ? -1 : 1;
  const tie = row => table === 'points' ? [text(row?.folio),text(row?.study),auditorName(row),text(row?.auditor)] : [auditorName(row),text(row?.auditor)];
  return rows.map((row,index) => ({row,index,values:getter(row),tie:tie(row)}))
    .sort((a,b) => compareTuple(a.values,b.values,order) || compareTuple(a.tie,b.tie,1) || a.index-b.index)
    .map(entry => entry.row);
}
