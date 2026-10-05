-- One bounded status row: no accumulated history, credentials or raw files.
create table public.chile_sql_sync (
  id boolean primary key default true check (id),
  run_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  month text,
  expected_revision bigint,
  range_start date,
  range_end date,
  status text not null default 'idle' check (status in ('idle','running','success','failed')),
  started_at timestamptz,
  finished_at timestamptz,
  last_success_at timestamptz,
  row_count integer not null default 0 check (row_count between 0 and 100000),
  error_code text,
  trigger_method text check (trigger_method in ('cron','manual'))
);
insert into public.chile_sql_sync(id) values(true);
alter table public.chile_sql_sync enable row level security;
revoke all on public.chile_sql_sync from public,anon,authenticated;
grant select on public.chile_sql_sync to authenticated;
grant all on public.chile_sql_sync to service_role;
create policy chile_sql_sync_member_read on public.chile_sql_sync for select to authenticated
  using (exists(select 1 from public.chile_members m where m.user_id=(select auth.uid())));

create function public.chile_begin_sql_sync(p_run_id uuid,p_actor_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  w public.chile_workspace%rowtype;
  s public.chile_sql_sync%rowtype;
  first_day date;
  last_day date;
begin
  select * into w from public.chile_workspace where id for update;
  if p_actor_id is not null and not exists(select 1 from public.chile_members where user_id=p_actor_id and role='admin') then
    raise exception 'Acceso no autorizado.' using errcode='42501';
  end if;
  if p_run_id is null or w.active_month is null or w.planning is null then
    raise exception 'Primero guarda una base mensual.' using errcode='22023';
  end if;
  first_day:=coalesce(w.metadata#>>'{options,monthRange,start}',w.metadata#>>'{options,operationalStart}')::date;
  last_day:=coalesce(w.metadata#>>'{options,monthRange,end}',w.metadata#>>'{options,operationalEnd}')::date;
  if first_day is null or last_day is null or last_day<first_day or last_day-first_day>41 then
    raise exception 'Confirma el rango operativo del mes.' using errcode='22023';
  end if;
  select * into s from public.chile_sql_sync where id for update;
  if s.status='running' and s.started_at>now()-interval '5 minutes' then
    return jsonb_build_object('started',false,'reason','busy');
  end if;
  if s.month=w.active_month and s.expected_revision=w.revision and s.finished_at>now()-interval '1 minute' then
    return jsonb_build_object('started',false,'reason','cooldown');
  end if;
  update public.chile_sql_sync set run_id=p_run_id,actor_id=p_actor_id,month=w.active_month,
    expected_revision=w.revision,range_start=first_day,range_end=last_day,status='running',
    started_at=now(),finished_at=null,error_code=null,trigger_method=case when p_actor_id is null then 'cron' else 'manual' end,
    last_success_at=case when s.month=w.active_month then s.last_success_at else null end,
    row_count=case when s.month=w.active_month then s.row_count else 0 end where id;
  return jsonb_build_object('started',true,'month',w.active_month,'start',first_day,'end',last_day,'revision',w.revision);
end;
$$;
revoke all on function public.chile_begin_sql_sync(uuid,uuid) from public,anon,authenticated;
grant execute on function public.chile_begin_sql_sync(uuid,uuid) to service_role;

create function public.chile_finish_sql_sync(p_run_id uuid,p_report jsonb default null,p_error_code text default null)
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
    or (s.actor_id is not null and not exists(select 1 from public.chile_members where user_id=s.actor_id and role='admin')) then
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
