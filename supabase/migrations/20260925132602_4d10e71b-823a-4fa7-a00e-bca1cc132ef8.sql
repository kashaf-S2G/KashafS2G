CREATE OR REPLACE FUNCTION public.call_app_at(_base text, _path text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid bigint;
BEGIN
  IF _base IS NULL OR _base !~ '^https://[a-z0-9.-]+$' THEN
    RETURN public.call_app(_path);
  END IF;
  SELECT net.http_post(
    url := _base || _path,
    headers := jsonb_build_object('Content-Type','application/json',
      'x-discovery-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'discovery_cron_token' LIMIT 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000) INTO rid;
  RETURN rid;
END; $$;
REVOKE ALL ON FUNCTION public.call_app_at(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.call_app_at(text, text) TO service_role;