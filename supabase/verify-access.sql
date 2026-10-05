-- Run as project owner after schema.sql. Every fixture and data change is rolled back.
begin;
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('98bbd20c-c8b9-4d32-a903-afa6d3cc8301', 'authenticated', 'authenticated', 'chile-db-admin-test@example.invalid', '', now(), '{}', '{}', now(), now()),
 ('98bbd20c-c8b9-4d32-a903-afa6d3cc8302', 'authenticated', 'authenticated', 'chile-db-field-test@example.invalid', '', now(), '{}', '{}', now(), now()),
 ('98bbd20c-c8b9-4d32-a903-afa6d3cc8303', 'authenticated', 'authenticated', 'chile-db-no-access-test@example.invalid', '', now(), '{}', '{}', now(), now());
insert into public.chile_members (user_id, role) values
 ('98bbd20c-c8b9-4d32-a903-afa6d3cc8301', 'admin'),
 ('98bbd20c-c8b9-4d32-a903-afa6d3cc8302', 'field');

do $$ begin
 if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('chile_members','chile_workspace','chile_weekly_plans') and not c.relrowsecurity) then
  raise exception 'FAIL: application table without RLS';
 end if;
 if has_table_privilege('anon','public.chile_workspace','select') or has_table_privilege('anon','public.chile_weekly_plans','select') or has_table_privilege('anon','public.chile_members','select') then
  raise exception 'FAIL: anonymous table privilege';
 end if;
 if has_schema_privilege('anon','chile_private','usage') or has_schema_privilege('authenticated','chile_private','usage') then
  raise exception 'FAIL: private setup exposed';
 end if;
 if has_function_privilege('anon','public.chile_save_workspace(text,bigint,jsonb,jsonb,jsonb,jsonb,jsonb)','execute')
  or has_function_privilege('authenticated','public.chile_claim_setup(text,uuid,text)','execute')
  or has_function_privilege('authenticated','public.chile_validate_setup(text)','execute')
  or has_function_privilege('authenticated','public.chile_remove_access(uuid,uuid)','execute')
  or has_function_privilege('authenticated','public.chile_add_member(uuid,uuid,text,text)','execute') then
  raise exception 'FAIL: privileged function exposed';
 end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"98bbd20c-c8b9-4d32-a903-afa6d3cc8303","role":"authenticated"}';
do $$ begin
 if exists (select 1 from public.chile_workspace) or exists (select 1 from public.chile_weekly_plans) or exists (select 1 from public.chile_members) then
  raise exception 'FAIL: signed-in nonmember can read application data';
 end if;
end $$;

set local request.jwt.claims = '{"sub":"98bbd20c-c8b9-4d32-a903-afa6d3cc8302","role":"authenticated"}';
do $$ begin
 if (select count(*) from public.chile_workspace) <> 1 or (select count(*) from public.chile_members) <> 1 then
  raise exception 'FAIL: field read permissions';
 end if;
 begin
  perform public.chile_save_workspace('9998-01', 0, null, null, '[]');
  raise exception 'FAIL: field member can save';
 exception when insufficient_privilege then null;
 end;
 update public.chile_workspace set revision=revision+1 where id;
 if found then raise exception 'FAIL: field direct update'; end if;
end $$;

set local request.jwt.claims = '{"sub":"98bbd20c-c8b9-4d32-a903-afa6d3cc8301","role":"authenticated"}';
do $$
declare r bigint;
begin
 select revision into r from public.chile_workspace where id;
 perform public.chile_save_workspace('9998-01',r,
  '{"studies":[{"name":"POY"}],"rows":[{"folio":"1"}]}'::jsonb,
  '[{"folio":"1","frequency":2,"client":"EMBONOR"}]'::jsonb,
  '[{"folio":"1","status":"TERMINADO"}]'::jsonb,
  '{"period":{"month":"9998-01","week":1},"files":[{"name":"POY.csv","rows":[]}]}'::jsonb);
 r := r+1;
 perform public.chile_save_workspace('9998-01',r,null,null,null,
  '{"period":{"month":"9998-01","week":2},"files":[{"name":"POY.csv","rows":[]}]}'::jsonb);
 r := r+1;
 perform public.chile_save_workspace('9998-01',r,null,null,'[]');
 r := r+1;
 if (select count(*) from public.chile_weekly_plans where month='9998-01') <> 2
  or (select planning->'rows'->0->>'folio' from public.chile_workspace where id) <> '1' then
  raise exception 'FAIL: report-only update replaced planning or weekly plans';
 end if;
 begin
  perform public.chile_save_workspace('9998-01',r-1,null,null,'[]');
  raise exception 'FAIL: stale revision overwrote current state';
 exception when sqlstate 'PT409' then null;
 end;
 perform public.chile_save_workspace('9998-02',r,
  '{"studies":[{"name":"POY"}],"rows":[{"folio":"2"}]}'::jsonb,
  '[{"folio":"2","frequency":2,"client":"EMBONOR"}]'::jsonb);
 r := r+1;
 if exists (select 1 from public.chile_weekly_plans where month <> '9998-02')
  or (select jsonb_array_length(report) from public.chile_workspace where id) <> 0 then
  raise exception 'FAIL: previous month retained';
 end if;
 begin
  perform public.chile_save_workspace('9998-01',r,null,null,'[]');
  raise exception 'FAIL: older month rollback allowed';
 exception when invalid_parameter_value then null;
 end;
end $$;
reset role;
set local role service_role;
-- A revoked administrator cannot finish granting access after Auth creates a user.
do $$ begin
 begin
  perform public.chile_add_member('98bbd20c-c8b9-4d32-a903-afa6d3cc8303', '98bbd20c-c8b9-4d32-a903-afa6d3cc8303', 'admin', 'No access');
  raise exception 'FAIL: revoked or nonmember actor can create an administrator';
 exception when insufficient_privilege then null;
 end;
 perform public.chile_add_member('98bbd20c-c8b9-4d32-a903-afa6d3cc8301', '98bbd20c-c8b9-4d32-a903-afa6d3cc8303', 'field', 'Temporary');
 if not exists (select 1 from public.chile_members where user_id='98bbd20c-c8b9-4d32-a903-afa6d3cc8303' and role='field') then
  raise exception 'FAIL: current administrator cannot create field access';
 end if;
 perform public.chile_remove_access('98bbd20c-c8b9-4d32-a903-afa6d3cc8303', '98bbd20c-c8b9-4d32-a903-afa6d3cc8301');
 begin
  perform public.chile_add_member('98bbd20c-c8b9-4d32-a903-afa6d3cc8303', '98bbd20c-c8b9-4d32-a903-afa6d3cc8303', 'admin', 'Revoked');
  raise exception 'FAIL: removed actor can create an administrator';
 exception when insufficient_privilege then null;
 end;
end $$;
rollback;
