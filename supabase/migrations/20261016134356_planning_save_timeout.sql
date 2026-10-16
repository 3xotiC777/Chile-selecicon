-- Monthly JSON validation and the atomic weekly save can exceed the default 8s.
-- PostgREST uses the function setting for this RPC; other requests keep their limits.
alter function public.chile_save_workspace(text, bigint, jsonb, jsonb, jsonb, jsonb, jsonb)
  set statement_timeout = '30s';

notify pgrst, 'reload schema';
