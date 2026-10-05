create or replace function public.chile_save_workspace(
  p_month text,
  p_expected_revision bigint,
  p_planning jsonb default null,
  p_universe jsonb default null,
  p_report jsonb default null,
  p_selection jsonb default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_workspace public.chile_workspace%rowtype;
  new_revision bigint;
  selection_week integer;
  month_changed boolean;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.chile_members m where m.user_id = (select auth.uid()) and m.role = 'admin'
  ) then
    raise exception 'Solo un administrador puede guardar la planeación o actualizar el export.' using errcode = '42501';
  end if;
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Mes de selección inválido.' using errcode = '22023';
  end if;
  select * into current_workspace from public.chile_workspace where id for update;
  if not found then
    raise exception 'No se encontró el espacio de Chile.' using errcode = 'P0001';
  end if;
  if p_expected_revision is null or p_expected_revision <> current_workspace.revision then
    raise exception 'Otra persona actualizó el seguimiento. Recarga los datos antes de guardar.' using errcode = 'PT409';
  end if;
  if current_workspace.active_month is not null and p_month < current_workspace.active_month then
    raise exception 'No se puede reemplazar el mes activo con un mes anterior.' using errcode = '22023';
  end if;
  month_changed := current_workspace.active_month is distinct from p_month;
  if month_changed and (p_planning is null or p_universe is null) then
    raise exception 'Para iniciar un mes debes guardar su planeación y universo.' using errcode = '22023';
  end if;
  if p_planning is not null and (
    jsonb_typeof(p_planning) is distinct from 'object'
    or jsonb_typeof(p_planning -> 'rows') is distinct from 'array'
    or jsonb_typeof(p_planning -> 'studies') is distinct from 'array'
  ) then
    raise exception 'La planeación guardada no tiene el formato esperado.' using errcode = '22023';
  end if;
  if p_planning is not null and (jsonb_array_length(p_planning -> 'rows') = 0 or jsonb_array_length(p_planning -> 'rows') > 100000) then
    raise exception 'La planeación está vacía o excede el límite de puntos.' using errcode = '22023';
  end if;
  if p_universe is not null and jsonb_typeof(p_universe) is distinct from 'array' then
    raise exception 'El universo debe ser una lista.' using errcode = '22023';
  end if;
  if p_universe is not null and (jsonb_array_length(p_universe) = 0 or jsonb_array_length(p_universe) > 100000) then
    raise exception 'El universo está vacío o excede el límite de puntos.' using errcode = '22023';
  end if;
  if p_report is not null and jsonb_typeof(p_report) is distinct from 'array' then
    raise exception 'El export debe ser una lista.' using errcode = '22023';
  end if;
  if p_report is not null and jsonb_array_length(p_report) > 100000 then
    raise exception 'El export excede el límite de encuestas del mes.' using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) is distinct from 'object' or octet_length(p_metadata::text) > 65536 then
    raise exception 'Metadatos inválidos.' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_planning, current_workspace.planning, '{}'::jsonb)::text)
    + octet_length(coalesce(p_universe, current_workspace.universe, '[]'::jsonb)::text)
    + octet_length(coalesce(p_report, case when month_changed then '[]'::jsonb else current_workspace.report end)::text) > 26214400 then
    raise exception 'Los datos del mes exceden 25 MB. Reduce el export al mes actual.' using errcode = '22023';
  end if;
  if p_selection is not null then
    if jsonb_typeof(p_selection) is distinct from 'object'
      or jsonb_typeof(p_selection -> 'files') is distinct from 'array'
      or p_selection -> 'period' ->> 'month' is distinct from p_month
      or coalesce(p_selection -> 'period' ->> 'week', '') !~ '^[1-5]$'
      or octet_length(p_selection::text) > 10485760 then
      raise exception 'La selección semanal no corresponde al mes o tiene un formato inválido.' using errcode = '22023';
    end if;
    selection_week := (p_selection -> 'period' ->> 'week')::integer;
  end if;
  new_revision := current_workspace.revision + 1;
  update public.chile_workspace set
    active_month = p_month,
    planning = coalesce(p_planning, current_workspace.planning),
    universe = coalesce(p_universe, current_workspace.universe),
    report = coalesce(p_report, case when month_changed then '[]'::jsonb else current_workspace.report end),
    metadata = case when month_changed then p_metadata else current_workspace.metadata || p_metadata end,
    revision = new_revision,
    updated_at = now(),
    updated_by = (select auth.uid())
  where id;
  if month_changed then
    delete from public.chile_weekly_plans where month <> p_month;
  end if;
  if p_selection is not null then
    insert into public.chile_weekly_plans (month, week, selection, metadata, saved_at, saved_by)
      values (p_month, selection_week, p_selection, p_metadata, now(), (select auth.uid()))
      on conflict (month, week) do update set
        selection = excluded.selection, metadata = excluded.metadata,
        saved_at = excluded.saved_at, saved_by = excluded.saved_by;
  end if;
  return jsonb_build_object('month', p_month, 'revision', new_revision, 'replacedMonth',
    case when month_changed then current_workspace.active_month else null end);
end;
$$;
revoke all on function public.chile_save_workspace(text,bigint,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.chile_save_workspace(text,bigint,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

-- Auth creation happens outside Postgres; re-check the actor before granting access.
create or replace function public.chile_add_member(p_actor_id uuid, p_user_id uuid, p_role text, p_display_name text default '')
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  perform 1 from public.chile_workspace where id for update;
  if not exists (select 1 from public.chile_members where user_id = p_actor_id and role = 'admin') then
    raise exception 'El administrador ya no tiene acceso para crear usuarios.' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'field') or p_role is null then
    raise exception 'Rol de usuario inválido.' using errcode = '22023';
  end if;
  insert into public.chile_members (user_id, role, display_name)
    values (p_user_id, p_role, left(coalesce(p_display_name, ''), 160));
end;
$$;
revoke all on function public.chile_add_member(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.chile_add_member(uuid,uuid,text,text) to service_role;

-- Enforce bounds even if an administrator writes directly through the Data API.
alter table public.chile_workspace drop constraint if exists chile_workspace_size;
alter table public.chile_workspace add constraint chile_workspace_size check (
  octet_length(coalesce(planning, '{}'::jsonb)::text) + octet_length(universe::text) + octet_length(report::text) <= 26214400
);
alter table public.chile_weekly_plans drop constraint if exists chile_selection_size;
alter table public.chile_weekly_plans add constraint chile_selection_size check (octet_length(selection::text) <= 10485760);

-- Explicitly document and enforce that setup state is server-only.
drop policy if exists chile_setup_no_client_access on chile_private.initial_setup;
create policy chile_setup_no_client_access on chile_private.initial_setup for all to anon, authenticated
  using (false) with check (false);


