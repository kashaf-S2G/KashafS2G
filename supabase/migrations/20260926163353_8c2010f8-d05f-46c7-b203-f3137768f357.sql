DROP INDEX IF EXISTS public.ads_owner_platform_source_key;
ALTER TABLE public.ads ADD CONSTRAINT ads_owner_platform_source_key UNIQUE (owner_id, source_platform, source_ad_id);

CREATE OR REPLACE FUNCTION public.sync_ad_status_from_raw()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE act boolean := NEW.is_active AND coalesce(NEW.seen_state,'') <> 'stopped';
BEGIN
  UPDATE ads SET status = CASE WHEN act THEN 'active' ELSE 'inactive' END,
    end_date = CASE WHEN act THEN NULL ELSE coalesce(ads.end_date, NEW.end_date, current_date) END,
    last_seen_at = NEW.last_seen_at, updated_at = now()
  WHERE ads.owner_id = NEW.owner_id AND ads.source_ad_id = NEW.source_ad_id
    AND (ads.status IS DISTINCT FROM CASE WHEN act THEN 'active' ELSE 'inactive' END OR ads.last_seen_at IS DISTINCT FROM NEW.last_seen_at);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS raw_ads_sync_ad_status ON public.competitor_raw_ads;
CREATE TRIGGER raw_ads_sync_ad_status AFTER UPDATE OF is_active, seen_state, last_seen_at ON public.competitor_raw_ads
FOR EACH ROW EXECUTE FUNCTION public.sync_ad_status_from_raw();

CREATE OR REPLACE FUNCTION public.call_app(_path text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare base text; rid bigint;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'app_base_url' limit 1;
  base := coalesce(nullif(base, ''), 'https://project--f1984698-4c63-46d1-81b7-2cc35fb89204-dev.lovable.app');
  select net.http_post(url := base || _path,
    headers := jsonb_build_object('content-type','application/json',
      'x-discovery-token', (select decrypted_secret from vault.decrypted_secrets where name = 'discovery_cron_token' limit 1)),
    body := '{}'::jsonb, timeout_milliseconds := 120000) into rid;
  return rid;
end; $function$;

UPDATE public.raw_ad_analyses SET status='pending', attempts=0, next_attempt_at=now(), last_error=NULL
WHERE status='failed' AND last_error='[object Object]';