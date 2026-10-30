-- The growing monthly report can exceed PostgREST's inherited 8s limit while
-- validating and storing its JSON snapshot. Keep all other RPC/role limits.
alter function public.chile_finish_sql_sync(uuid, jsonb, text)
  set statement_timeout = '30s';

notify pgrst, 'reload schema';
