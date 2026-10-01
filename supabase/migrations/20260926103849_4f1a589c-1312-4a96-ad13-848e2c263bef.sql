CREATE TABLE public.competitor_collection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number bigserial,
  owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  trigger_type text NOT NULL DEFAULT 'manual',
  competitors_total integer NOT NULL DEFAULT 0,
  jobs_total integer NOT NULL DEFAULT 0,
  jobs_done integer NOT NULL DEFAULT 0,
  jobs_failed integer NOT NULL DEFAULT 0,
  ads_found integer NOT NULL DEFAULT 0,
  ads_new integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.competitor_collection_runs TO authenticated;
GRANT ALL ON public.competitor_collection_runs TO service_role;
ALTER TABLE public.competitor_collection_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own runs read" ON public.competitor_collection_runs FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE INDEX ON public.competitor_collection_runs (owner_id, created_at DESC);

CREATE TABLE public.competitor_collection_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.competitor_collection_runs(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  competitor_id uuid NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  path text NOT NULL,
  batch integer NOT NULL DEFAULT 1,
  url text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  ads_found integer NOT NULL DEFAULT 0,
  ads_new integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, competitor_id, path, batch)
);
GRANT SELECT ON public.competitor_collection_jobs TO authenticated;
GRANT ALL ON public.competitor_collection_jobs TO service_role;
ALTER TABLE public.competitor_collection_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own jobs read" ON public.competitor_collection_jobs FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE INDEX ON public.competitor_collection_jobs (status, next_attempt_at);
CREATE INDEX ON public.competitor_collection_jobs (run_id, status);

CREATE TABLE public.competitor_raw_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  competitor_id uuid NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  source_ad_id text NOT NULL,
  source_page_id text,
  page_name text NOT NULL DEFAULT '',
  source_url text,
  ad_text text NOT NULL DEFAULT '',
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  start_date date,
  end_date date,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, source_ad_id)
);
GRANT SELECT ON public.competitor_raw_ads TO authenticated;
GRANT ALL ON public.competitor_raw_ads TO service_role;
ALTER TABLE public.competitor_raw_ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own raw ads read" ON public.competitor_raw_ads FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE INDEX ON public.competitor_raw_ads (owner_id, competitor_id);

-- يحجز دفعة مهام جاهزة بأمان (بدون تداخل بين عمّال متوازين)، ويستعيد المهام العالقة بعد انقطاع.
CREATE OR REPLACE FUNCTION public.claim_competitor_jobs(_limit integer, _lease_seconds integer DEFAULT 90)
RETURNS SETOF public.competitor_collection_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- مهام انتهت مهلتها بلا محاولات متبقية → فاشلة
  UPDATE competitor_collection_jobs SET status = 'failed', error = coalesce(error, 'انتهت المهلة بعد آخر محاولة'),
    finished_at = now(), updated_at = now()
  WHERE status = 'running' AND lease_expires_at < now() AND attempts >= max_attempts;

  RETURN QUERY
  UPDATE competitor_collection_jobs j SET status = 'running', attempts = j.attempts + 1,
    lease_expires_at = now() + make_interval(secs => _lease_seconds),
    started_at = coalesce(j.started_at, now()), updated_at = now()
  WHERE j.id IN (
    SELECT id FROM competitor_collection_jobs
    WHERE (status = 'pending' AND next_attempt_at <= now())
       OR (status = 'running' AND lease_expires_at < now() AND attempts < max_attempts)
    ORDER BY next_attempt_at, batch
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING j.*;
END; $$;
REVOKE ALL ON FUNCTION public.claim_competitor_jobs(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_competitor_jobs(integer, integer) TO service_role;

-- يعيد حساب عدّادات الجولة وحالتها النهائية من مهامها (قابل للتكرار بأمان).
CREATE OR REPLACE FUNCTION public.refresh_competitor_run(_run_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t int; d int; f int; open_ int; af int; an int; st text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status='done'), count(*) FILTER (WHERE status='failed'),
         count(*) FILTER (WHERE status IN ('pending','running')), coalesce(sum(ads_found),0), coalesce(sum(ads_new),0)
    INTO t, d, f, open_, af, an FROM competitor_collection_jobs WHERE run_id = _run_id;
  SELECT status INTO st FROM competitor_collection_runs WHERE id = _run_id;
  IF st = 'cancelled' THEN RETURN st; END IF;
  st := CASE WHEN open_ > 0 THEN 'running'
             WHEN t = 0 OR f = t THEN 'failed'
             WHEN f > 0 THEN 'partial'
             ELSE 'completed' END;
  UPDATE competitor_collection_runs SET jobs_total = t, jobs_done = d, jobs_failed = f, ads_found = af, ads_new = an,
    status = st, finished_at = CASE WHEN open_ = 0 THEN coalesce(finished_at, now()) ELSE NULL END, updated_at = now()
  WHERE id = _run_id;
  RETURN st;
END; $$;
REVOKE ALL ON FUNCTION public.refresh_competitor_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_competitor_run(uuid) TO service_role;