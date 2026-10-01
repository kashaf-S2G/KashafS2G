-- lovable-cron-fallback-reviewed: armed on enqueue only, unschedules itself after the queue drains; recovers lost self-wakeups
ALTER TABLE public.competitor_collection_jobs
  ADD COLUMN IF NOT EXISTS cursor text,
  ADD COLUMN IF NOT EXISTS has_more boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
ALTER TABLE public.competitor_collection_runs ADD COLUMN IF NOT EXISTS wake_base text;

CREATE TABLE IF NOT EXISTS public.competitor_collection_coverage (
  run_id uuid NOT NULL REFERENCES public.competitor_collection_runs(id) ON DELETE CASCADE,
  competitor_id uuid NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  jobs_total integer NOT NULL DEFAULT 0,
  jobs_done integer NOT NULL DEFAULT 0,
  jobs_failed integer NOT NULL DEFAULT 0,
  jobs_open integer NOT NULL DEFAULT 0,
  batches_max integer NOT NULL DEFAULT 0,
  paths_exhausted integer NOT NULL DEFAULT 0,
  paths_total integer NOT NULL DEFAULT 0,
  ads_found integer NOT NULL DEFAULT 0,
  ads_new integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, competitor_id)
);
GRANT SELECT ON public.competitor_collection_coverage TO authenticated;
GRANT ALL ON public.competitor_collection_coverage TO service_role;
ALTER TABLE public.competitor_collection_coverage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own coverage read" ON public.competitor_collection_coverage FOR SELECT TO authenticated USING (owner_id = auth.uid());

-- حجز مهام مع قفل لكل منافس: لا تعمل مهمتان لنفس المنافس في الوقت نفسه.
CREATE OR REPLACE FUNCTION public.claim_competitor_jobs(_limit integer, _lease_seconds integer DEFAULT 90)
RETURNS SETOF public.competitor_collection_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE competitor_collection_jobs SET status = 'failed', error = coalesce(error, 'انتهت المهلة بعد آخر محاولة'),
    finished_at = now(), updated_at = now()
  WHERE status = 'running' AND lease_expires_at < now() AND attempts >= max_attempts;

  RETURN QUERY
  UPDATE competitor_collection_jobs j SET status = 'running', attempts = j.attempts + 1,
    lease_expires_at = now() + make_interval(secs => _lease_seconds), heartbeat_at = now(),
    started_at = coalesce(j.started_at, now()), updated_at = now()
  WHERE j.id IN (
    SELECT DISTINCT ON (c.competitor_id) c.id FROM (
      SELECT id, competitor_id, next_attempt_at, batch FROM competitor_collection_jobs x
      WHERE ((x.status = 'pending' AND x.next_attempt_at <= now())
          OR (x.status = 'running' AND x.lease_expires_at < now() AND x.attempts < x.max_attempts))
        AND NOT EXISTS (SELECT 1 FROM competitor_collection_jobs y
          WHERE y.competitor_id = x.competitor_id AND y.status = 'running' AND y.lease_expires_at >= now() AND y.id <> x.id)
      ORDER BY next_attempt_at, batch
      LIMIT _limit * 10
      FOR UPDATE SKIP LOCKED
    ) c ORDER BY c.competitor_id, c.next_attempt_at, c.batch
    LIMIT _limit
  )
  RETURNING j.*;
END; $$;
REVOKE ALL ON FUNCTION public.claim_competitor_jobs(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_competitor_jobs(integer, integer) TO service_role;

-- نبض: تمديد مهلة المهمة أثناء تنفيذها حتى لا يلتقطها عامل آخر.
CREATE OR REPLACE FUNCTION public.heartbeat_competitor_job(_job_id uuid, _lease_seconds integer DEFAULT 90)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE competitor_collection_jobs SET lease_expires_at = now() + make_interval(secs => _lease_seconds),
    heartbeat_at = now(), updated_at = now()
  WHERE id = _job_id AND status = 'running' RETURNING true;
$$;
REVOKE ALL ON FUNCTION public.heartbeat_competitor_job(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_competitor_job(uuid, integer) TO service_role;

-- عدّادات الجولة + تغطية كل منافس.
CREATE OR REPLACE FUNCTION public.refresh_competitor_run(_run_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t int; d int; f int; open_ int; af int; an int; st text; cov_partial int;
BEGIN
  INSERT INTO competitor_collection_coverage AS cv (run_id, competitor_id, owner_id, jobs_total, jobs_done, jobs_failed, jobs_open,
      batches_max, paths_total, paths_exhausted, ads_found, ads_new, status, last_error, updated_at)
  SELECT _run_id, j.competitor_id, min(j.owner_id::text)::uuid, count(*),
    count(*) FILTER (WHERE status='done'), count(*) FILTER (WHERE status='failed'),
    count(*) FILTER (WHERE status IN ('pending','running')), max(batch),
    count(DISTINCT path),
    count(DISTINCT path) FILTER (WHERE status='done' AND NOT has_more AND NOT EXISTS (
      SELECT 1 FROM competitor_collection_jobs z WHERE z.run_id = _run_id AND z.competitor_id = j.competitor_id AND z.path = j.path AND z.batch > j.batch)),
    coalesce(sum(ads_found),0), coalesce(sum(ads_new),0),
    CASE WHEN count(*) FILTER (WHERE status IN ('pending','running')) > 0 THEN 'running'
         WHEN count(*) FILTER (WHERE status='failed') = count(*) THEN 'failed'
         WHEN count(*) FILTER (WHERE status='failed') > 0 THEN 'partial'
         WHEN coalesce(sum(ads_found),0) = 0 THEN 'empty'
         ELSE 'complete' END,
    (array_agg(error ORDER BY updated_at DESC) FILTER (WHERE error IS NOT NULL))[1], now()
  FROM competitor_collection_jobs j WHERE j.run_id = _run_id GROUP BY j.competitor_id
  ON CONFLICT (run_id, competitor_id) DO UPDATE SET jobs_total = EXCLUDED.jobs_total, jobs_done = EXCLUDED.jobs_done,
    jobs_failed = EXCLUDED.jobs_failed, jobs_open = EXCLUDED.jobs_open, batches_max = EXCLUDED.batches_max,
    paths_total = EXCLUDED.paths_total, paths_exhausted = EXCLUDED.paths_exhausted, ads_found = EXCLUDED.ads_found,
    ads_new = EXCLUDED.ads_new, status = EXCLUDED.status, last_error = EXCLUDED.last_error, updated_at = now();

  SELECT count(*), count(*) FILTER (WHERE status='done'), count(*) FILTER (WHERE status='failed'),
         count(*) FILTER (WHERE status IN ('pending','running')), coalesce(sum(ads_found),0), coalesce(sum(ads_new),0)
    INTO t, d, f, open_, af, an FROM competitor_collection_jobs WHERE run_id = _run_id;
  SELECT count(*) INTO cov_partial FROM competitor_collection_coverage WHERE run_id = _run_id AND status IN ('failed','partial','empty');
  SELECT status INTO st FROM competitor_collection_runs WHERE id = _run_id;
  IF st = 'cancelled' THEN RETURN st; END IF;
  st := CASE WHEN open_ > 0 THEN 'running'
             WHEN t = 0 OR f = t OR af = 0 THEN 'failed'
             WHEN f > 0 OR cov_partial > 0 THEN 'partial'
             ELSE 'completed' END;
  UPDATE competitor_collection_runs SET jobs_total = t, jobs_done = d, jobs_failed = f, ads_found = af, ads_new = an,
    status = st, error = CASE WHEN open_ = 0 AND st <> 'completed' THEN format('%s منافس بتغطية ناقصة أو فارغة، %s مهمة فشلت', cov_partial, f) ELSE NULL END,
    finished_at = CASE WHEN open_ = 0 THEN coalesce(finished_at, now()) ELSE NULL END, updated_at = now()
  WHERE id = _run_id;
  RETURN st;
END; $$;
REVOKE ALL ON FUNCTION public.refresh_competitor_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_competitor_run(uuid) TO service_role;

-- احتياطي إيقاظ: يعمل فقط أثناء وجود مهام مفتوحة، ويُلغى تلقائيًا بعد انتهائها.
CREATE OR REPLACE FUNCTION public.competitor_collect_backstop()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM competitor_collection_jobs WHERE status IN ('pending','running')) THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'competitor-collect-backstop';
    RETURN;
  END IF;
  -- لا نوقظ إن كان عامل ينبض حاليًا.
  IF EXISTS (SELECT 1 FROM competitor_collection_jobs WHERE status = 'running' AND heartbeat_at > now() - interval '60 seconds') THEN RETURN; END IF;
  SELECT wake_base INTO b FROM competitor_collection_runs WHERE status IN ('queued','running') ORDER BY created_at DESC LIMIT 1;
  PERFORM public.call_app_at(b, '/api/public/competitor-collect/tick');
END; $$;
REVOKE ALL ON FUNCTION public.competitor_collect_backstop() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competitor_collect_backstop() TO service_role;

CREATE OR REPLACE FUNCTION public.arm_competitor_collect_backstop()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'competitor-collect-backstop') THEN
    PERFORM cron.schedule('competitor-collect-backstop', '*/2 * * * *', 'SELECT public.competitor_collect_backstop()');
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.arm_competitor_collect_backstop() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arm_competitor_collect_backstop() TO service_role;