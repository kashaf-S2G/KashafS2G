ALTER TABLE public.crawl_runs ADD COLUMN IF NOT EXISTS deadline_at timestamptz, ADD COLUMN IF NOT EXISTS control text NOT NULL DEFAULT 'none', ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.pcrawl_runs ADD COLUMN IF NOT EXISTS deadline_at timestamptz, ADD COLUMN IF NOT EXISTS control text NOT NULL DEFAULT 'none', ADD COLUMN IF NOT EXISTS note text;

CREATE TABLE IF NOT EXISTS public.bank_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  control text NOT NULL DEFAULT 'none',
  phase text NOT NULL DEFAULT 'categories',
  added_ids uuid[] NOT NULL DEFAULT '{}',
  categories_added integer NOT NULL DEFAULT 0,
  terms_added integer NOT NULL DEFAULT 0,
  note text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  finished_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.bank_jobs TO authenticated;
GRANT ALL ON public.bank_jobs TO service_role;
ALTER TABLE public.bank_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own bank jobs select" ON public.bank_jobs FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "own bank jobs insert" ON public.bank_jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "own bank jobs update" ON public.bank_jobs FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX IF NOT EXISTS bank_jobs_owner_status ON public.bank_jobs(owner_id, status);
CREATE TRIGGER bank_jobs_touch BEFORE UPDATE ON public.bank_jobs FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.job_worker_lease (
  id boolean PRIMARY KEY DEFAULT true,
  lease_expires_at timestamptz,
  last_tick_at timestamptz,
  last_result text
);
GRANT ALL ON public.job_worker_lease TO service_role;
ALTER TABLE public.job_worker_lease ENABLE ROW LEVEL SECURITY;
INSERT INTO public.job_worker_lease(id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.acquire_worker_lease(_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  UPDATE public.job_worker_lease
     SET lease_expires_at = now() + make_interval(secs => _seconds), last_tick_at = now()
   WHERE id = true AND (lease_expires_at IS NULL OR lease_expires_at < now())
  RETURNING true INTO ok;
  RETURN coalesce(ok, false);
END; $$;
REVOKE ALL ON FUNCTION public.acquire_worker_lease(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_worker_lease(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.release_worker_lease(_result text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.job_worker_lease SET lease_expires_at = NULL, last_result = left(_result, 500) WHERE id = true;
$$;
REVOKE ALL ON FUNCTION public.release_worker_lease(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_worker_lease(text) TO service_role;

CREATE OR REPLACE FUNCTION public.call_app(_path text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE base text; rid bigint;
BEGIN
  SELECT decrypted_secret INTO base FROM vault.decrypted_secrets WHERE name = 'app_base_url' LIMIT 1;
  base := coalesce(nullif(base, ''), 'https://project--1cbd2ed5-2462-4852-b9ae-3017b3730edf.lovable.app');
  SELECT net.http_post(
    url := base || _path,
    headers := jsonb_build_object('Content-Type','application/json',
      'x-discovery-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'discovery_cron_token' LIMIT 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000) INTO rid;
  RETURN rid;
END; $$;
REVOKE ALL ON FUNCTION public.call_app(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.call_app(text) TO service_role;

SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('jobs-tick-hourly','product-crawl-every-3h','ai-pricing-sync-every-12h');
SELECT cron.schedule('jobs-tick-hourly', '5 * * * *', $$SELECT public.call_app('/api/public/jobs/tick');$$);
SELECT cron.schedule('ai-pricing-sync-every-12h', '15 */12 * * *', $$SELECT public.call_app('/api/public/pricing/sync');$$);