create or replace function public.call_app(_path text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare base text; rid bigint;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'app_base_url' limit 1;
  base := coalesce(nullif(base, ''), 'https://id-preview--a1c713b3-4e4c-4db5-99f5-bcd9b5d738d9.lovable.app');
  select net.http_post(
    url := base || _path,
    headers := jsonb_build_object('content-type','application/json',
      'x-discovery-token', (select decrypted_secret from vault.decrypted_secrets where name = 'discovery_cron_token' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000) into rid;
  return rid;
end; $function$;
select public.call_app_at('https://id-preview--a1c713b3-4e4c-4db5-99f5-bcd9b5d738d9.lovable.app', '/api/public/raw-ads-analyze/tick') as wake_request_id;