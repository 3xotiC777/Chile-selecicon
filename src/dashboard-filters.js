export const DEFAULT_DASHBOARD_FILTERS = Object.freeze({client:'',study:'',auditor:'',region:'',status:'',search:'',planned:false});

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Monthly totals and point-detail filters have separate scopes. Productivity follows the actual export auditor. */
export function dashboardScopes(data, filters = {}) {
  const matches = row => (!filters.client || row.client === filters.client)
    && (!filters.study || row.study === filters.study)
    && (!filters.auditor || String(row.auditor) === String(filters.auditor));
  const productivityPoints = (data?.points || []).filter(matches);
  const monthlyPoints = productivityPoints.filter(point => !filters.region || normalize(point.region) === normalize(filters.region));
  const points = monthlyPoints.filter(point => {
    if (filters.planned && !point.plannedCurrentWeek) return false;
    if (filters.status === 'complete' && !point.complete) return false;
    if (filters.status === 'pending' && (point.complete || point.target == null)) return false;
    if (filters.status === 'unvisited' && point.validVisits > 0) return false;
    if (filters.status === 'empty' && !point.empty) return false;
    if (filters.status === 'rejected' && !point.rejected) return false;
    if (filters.status === 'unknown' && point.target != null) return false;
    if (filters.status === 'planned-pending' && (!point.plannedCurrentWeek || !point.plannedPending)) return false;
    if (filters.status === 'planned-complete' && (!point.plannedCurrentWeek || !point.currentWeekCompleted)) return false;
    if (filters.search && !normalize([point.folio,point.auditor,point.auditorName,point.location,point.region,point.commune,point.client,point.study].join(' ')).includes(normalize(filters.search))) return false;
    return true;
  });
  return {monthlyPoints,points,productivityPoints,daily:(data?.daily || []).filter(matches)};
}

export function clearDashboardDetailFilters(filters) {
  return {...filters,status:'',search:'',planned:false};
}
