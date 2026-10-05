-- Chile planning: only the active month is retained. No raw workbooks or public files.
create schema if not exists chile_private;
revoke all on schema chile_private from public, anon, authenticated;
grant usage on schema chile_private to service_role;

create table if not exists public.chile_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'field')),
  display_name text not null default '',
  created_at timestamptz not null default now()
);
alter table public.chile_members enable row level security;
revoke all on public.chile_members from public, anon, authenticated;
grant select on public.chile_members to authenticated;
grant all on public.chile_members to service_role;
drop policy if exists chile_member_own on public.chile_members;
create policy chile_member_own on public.chile_members for select to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.chile_workspace (
  id boolean primary key default true check (id),
  active_month text check (active_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  planning jsonb,
  universe jsonb not null default '[]'::jsonb,
  report jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (jsonb_typeof(universe) = 'array'),
  check (jsonb_typeof(report) = 'array'),
  check (jsonb_typeof(metadata) = 'object'),
  check (planning is null or jsonb_typeof(planning) = 'object')
);
insert into public.chile_workspace (id) values (true) on conflict (id) do nothing;
alter table public.chile_workspace enable row level security;
revoke all on public.chile_workspace from public, anon, authenticated;
grant select, update on public.chile_workspace to authenticated;
grant all on public.chile_workspace to service_role;
drop policy if exists chile_workspace_read on public.chile_workspace;
create policy chile_workspace_read on public.chile_workspace for select to authenticated
  using (exists (select 1 from public.chile_members m where m.user_id = (select auth.uid())));
drop policy if exists chile_workspace_admin_update on public.chile_workspace;
create policy chile_workspace_admin_update on public.chile_workspace for update to authenticated
  using (exists (select 1 from public.chile_members m where m.user_id = (select auth.uid()) and m.role = 'admin'))
  with check (exists (select 1 from public.chile_members m where m.user_id = (select auth.uid()) and m.role = 'admin'));

create table if not exists public.chile_weekly_plans (
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  week smallint not null check (week between 1 and 5),
  selection jsonb not null check (jsonb_typeof(selection) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  saved_at timestamptz not null default now(),
  saved_by uuid references auth.users(id) on delete set null,
  primary key (month, week)
);
alter table public.chile_weekly_plans enable row level security;
revoke all on public.chile_weekly_plans from public, anon, authenticated;
grant select, insert, update, delete on public.chile_weekly_plans to authenticated;
grant all on public.chile_weekly_plans to service_role;
drop policy if exists chile_plans_read on public.chile_weekly_plans;
create policy chile_plans_read on public.chile_weekly_plans for select to authenticated
  using (exists (select 1 from public.chile_members m where m.user_id = (select auth.uid())));
drop policy if exists chile_plans_admin_insert on public.chile_weekly_plans;
create policy chile_plans_admin_insert on public.chile_weekly_plans for insert to authenticated
  with check (
    exists (select 1 from public.chile_members m where m.user_id = (select auth.uid()) and m.role = 'admin')
    and month = (select w.active_month from public.chile_workspace w where w.id)
  );
drop policy if exists chile_plans_admin_update on public.chile_weekly_plans;
create policy chile_plans_admin_update on public.chile_weekly_plans for update to authenticated
  using (exists (select 1 from public.chile_members m where m.user_id = (select auth.uid()) and m.role = 'admin'))
  with check (
    exists (select 1 from public.chile_members m where m.user_id = (select auth.uid()) and m.role = 'admin')
    and month = (select w.active_month from public.chile_workspace w where w.id)
  );
drop policy if exists chile_plans_admin_delete on public.chile_weekly_plans;
create policy chile_plans_admin_delete on public.chile_weekly_plans for delete to authenticated
  using (exists (select 1 from public.chile_members m where m.user_id = (select auth.uid()) and m.role = 'admin'));

-- Security invoker is deliberate: RLS and membership remain in force inside the RPC.
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

-- The one-time bootstrap token hash never appears in the Data API or browser.
create table if not exists chile_private.initial_setup (
  id boolean primary key default true check (id),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id) on delete set null
);
alter table chile_private.initial_setup enable row level security;
revoke all on chile_private.initial_setup from public, anon, authenticated;
grant all on chile_private.initial_setup to service_role;
drop policy if exists chile_setup_no_client_access on chile_private.initial_setup;
create policy chile_setup_no_client_access on chile_private.initial_setup for all to anon, authenticated
  using (false) with check (false);
create or replace function public.chile_claim_setup(p_token_hash text, p_user_id uuid, p_display_name text default '')
returns void
language plpgsql security invoker set search_path = ''
as $$
declare claimed boolean;
begin
  -- Serializes bootstrap against all other bootstrap calls and workspace commits.
  perform 1 from public.chile_workspace where id for update;
  if exists (select 1 from public.chile_members where role = 'admin') then
    raise exception 'El administrador inicial ya fue creado.' using errcode = '42501';
  end if;
  update chile_private.initial_setup set claimed_at = now(), claimed_by = p_user_id
    where id and claimed_at is null and expires_at > now() and token_hash = p_token_hash
    returning id into claimed;
  if claimed is distinct from true then
    raise exception 'El enlace de configuración es inválido, venció o ya fue utilizado.' using errcode = '42501';
  end if;
  insert into public.chile_members (user_id, role, display_name) values (p_user_id, 'admin', left(p_display_name, 160));
end;
$$;
revoke all on function public.chile_claim_setup(text,uuid,text) from public, anon, authenticated;
grant execute on function public.chile_claim_setup(text,uuid,text) to service_role;

create or replace function public.chile_validate_setup(p_token_hash text)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select not exists (select 1 from public.chile_members where role = 'admin')
    and exists (select 1 from chile_private.initial_setup where id and claimed_at is null
      and expires_at > now() and token_hash = p_token_hash);
$$;
revoke all on function public.chile_validate_setup(text) from public, anon, authenticated;
grant execute on function public.chile_validate_setup(text) to service_role;

-- Called only by the server after JWT verification. Serializing membership removals
-- prevents two simultaneous requests from deleting the final administrators.
create or replace function public.chile_remove_access(p_user_id uuid, p_actor_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare target_role text;
begin
  perform 1 from public.chile_workspace where id for update;
  if not exists (select 1 from public.chile_members where user_id = p_actor_id and role = 'admin') then
    raise exception 'Solo un administrador puede eliminar usuarios.' using errcode = '42501';
  end if;
  if p_user_id = p_actor_id then
    raise exception 'No puedes eliminar tu propio acceso.' using errcode = '22023';
  end if;
  select role into target_role from public.chile_members where user_id = p_user_id;
  if target_role is null then
    raise exception 'Ese usuario no pertenece al proyecto Chile.' using errcode = '22023';
  end if;
  if target_role = 'admin' and (select count(*) from public.chile_members where role = 'admin') <= 1 then
    raise exception 'Debe quedar al menos un administrador.' using errcode = '22023';
  end if;
  delete from public.chile_members where user_id = p_user_id;
end;
$$;
revoke all on function public.chile_remove_access(uuid,uuid) from public, anon, authenticated;
grant execute on function public.chile_remove_access(uuid,uuid) to service_role;

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

comment on table public.chile_workspace is 'Chile app: compact current-month planning, frequencies and latest export only.';
comment on table public.chile_weekly_plans is 'Chile app: at most five current-month weekly selections, used to regenerate CSV ZIP downloads.';
