create or replace function public.chile_finish_sql_sync(p_run_id uuid,p_report jsonb default null,p_error_code text default null)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  w public.chile_workspace%rowtype;
  s public.chile_sql_sync%rowtype;
  failure text;
begin
  select * into w from public.chile_workspace where id for update;
  select * into s from public.chile_sql_sync where id for update;
  if p_run_id is null or p_run_id is distinct from s.run_id or s.status<>'running' then
    return jsonb_build_object('ok',false,'errorCode','CONFLICT');
  end if;
  failure:=case when p_error_code in ('SQL_UNAVAILABLE','SQL_CERTIFICATE','REPORT_INVALID','REPORT_LIMIT','CONFLICT') then p_error_code end;
  if w.active_month is distinct from s.month or w.revision<>s.expected_revision
    or coalesce(w.metadata#>>'{options,monthRange,start}',w.metadata#>>'{options,operationalStart}') is distinct from s.range_start::text
    or coalesce(w.metadata#>>'{options,monthRange,end}',w.metadata#>>'{options,operationalEnd}') is distinct from s.range_end::text
    or (s.trigger_method='manual' and (s.actor_id is null or not exists(select 1 from public.chile_members where user_id=s.actor_id and role='admin'))) then
    failure:='CONFLICT';
  end if;
  if failure is null then
    if p_report is null or jsonb_typeof(p_report) is distinct from 'array' then
      failure:='REPORT_INVALID';
    elsif jsonb_array_length(p_report)>100000 then
      failure:='REPORT_LIMIT';
    elsif exists(select 1 from jsonb_array_elements(p_report) row where
      jsonb_typeof(row) is distinct from 'object' or coalesce(row->>'day','')!~'^\d{4}-\d{2}-\d{2}$'
      or row->>'day'<s.range_start::text or row->>'day'>s.range_end::text) then
      failure:='REPORT_INVALID';
    elsif octet_length(coalesce(w.planning,'{}'::jsonb)::text)+octet_length(w.universe::text)+octet_length(p_report::text)>26214400 then
      failure:='REPORT_LIMIT';
    -- An empty successful SELECT at the start of a month is valid. A suddenly
    -- empty source must not wipe previously loaded visits.
    elsif jsonb_array_length(p_report)=0 and jsonb_array_length(w.report)>0 then
      failure:='REPORT_INVALID';
    end if;
  end if;
  if failure is not null then
    update public.chile_sql_sync set status='failed',finished_at=now(),error_code=failure where id;
    return jsonb_build_object('ok',false,'errorCode',failure);
  end if;
  update public.chile_workspace set report=p_report,revision=revision+1,updated_at=now(),updated_by=s.actor_id,
    metadata=metadata||jsonb_build_object('reportName','SQL Server · sincronización automática',
      'reportSource','sqlserver','reportUpdatedAt',now()) where id;
  update public.chile_sql_sync set status='success',finished_at=now(),last_success_at=now(),
    row_count=jsonb_array_length(p_report),error_code=null,expected_revision=w.revision+1 where id;
  return jsonb_build_object('ok',true,'syncedAt',now(),'revision',w.revision+1,'rows',jsonb_array_length(p_report));
end;
$$;
revoke all on function public.chile_finish_sql_sync(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.chile_finish_sql_sync(uuid,jsonb,text) to service_role;
