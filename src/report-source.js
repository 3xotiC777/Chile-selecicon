// Only use saved visits when they cover the entire selected operational month.
export function sharedReportFor(workspace,month,range){
  if(!workspace||workspace.month!==month||!Array.isArray(workspace.report)||!workspace.metadata?.reportName||!range)return null;
  const saved=workspace.metadata.options?.monthRange||{start:workspace.metadata.options?.operationalStart,end:workspace.metadata.options?.operationalEnd};
  if(!saved.start||!saved.end||range.start<saved.start||range.end>saved.end)return null;
  return {rows:workspace.report,name:workspace.metadata.reportName,source:workspace.metadata.reportSource||'shared',revision:workspace.revision};
}
