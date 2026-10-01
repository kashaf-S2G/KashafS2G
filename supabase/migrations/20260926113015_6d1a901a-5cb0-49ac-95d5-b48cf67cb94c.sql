ALTER TABLE public.competitor_collection_jobs
  ADD COLUMN IF NOT EXISTS error_type text,
  ADD COLUMN IF NOT EXISTS ads_duplicate integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ads_changed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debug jsonb;
ALTER TABLE public.competitor_collection_runs
  ADD COLUMN IF NOT EXISTS control text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS ads_duplicate integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ads_changed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ads_not_seen integer NOT NULL DEFAULT 0;
ALTER TABLE public.competitor_collection_coverage
  ADD COLUMN IF NOT EXISTS ads_duplicate integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_batch_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_batch_at timestamptz;
ALTER TABLE public.competitor_raw_ads
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS seen_state text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS first_run_id uuid,
  ADD COLUMN IF NOT EXISTS source_path text;

CREATE OR REPLACE FUNCTION public.claim_competitor_jobs(_limit integer, _lease_seconds integer DEFAULT 90)
 RETURNS SETOF competitor_collection_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE competitor_collection_jobs SET status = 'failed', error_type = coalesce(error_type,'timeout'),
    error = coalesce(error, 'انتهت المهلة بعد آخر محاولة'), finished_at = now(), updated_at = now()
  WHERE status = 'running' AND lease_expires_at < now() AND attempts >= max_attempts;

  RETURN QUERY
  UPDATE competitor_collection_jobs j SET status = 'running', attempts = j.attempts + 1,
    lease_expires_at = now() + make_interval(secs => _lease_seconds), heartbeat_at = now(),
    started_at = coalesce(j.started_at, now()), updated_at = now()
  WHERE j.id IN (
    SELECT DISTINCT ON (c.competitor_id) c.id FROM (
      SELECT x.id, x.competitor_id, x.next_attempt_at, x.batch FROM competitor_collection_jobs x
      JOIN competitor_collection_runs r ON r.id = x.run_id AND r.control = 'active' AND r.status IN ('queued','running')
      WHERE ((x.status = 'pending' AND x.next_attempt_at <= now())
          OR (x.status = 'running' AND x.lease_expires_at < now() AND x.attempts < x.max_attempts))
        AND NOT EXISTS (SELECT 1 FROM competitor_collection_jobs y
          WHERE y.competitor_id = x.competitor_id AND y.status = 'running' AND y.lease_expires_at >= now() AND y.id <> x.id)
      ORDER BY x.next_attempt_at, x.batch
      LIMIT _limit * 10
      FOR UPDATE OF x SKIP LOCKED
    ) c ORDER BY c.competitor_id, c.next_attempt_at, c.batch
    LIMIT _limit
  )
  RETURNING j.*;
END; $function$;

CREATE OR REPLACE FUNCTION public.refresh_competitor_run(_run_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t int; d int; f int; open_ int; stopped_ int; af int; an int; dup int; chg int; st text; prev text; ctl text; cov_partial int; ns int := 0;
BEGIN
  INSERT INTO competitor_collection_coverage AS cv (run_id, competitor_id, owner_id, jobs_total, jobs_done, jobs_failed, jobs_open,
      batches_max, paths_total, paths_exhausted, ads_found, ads_new, ads_duplicate, first_batch_at, last_batch_at, status, last_error, updated_at)
  SELECT _run_id, j.competitor_id, min(j.owner_id::text)::uuid, count(*),
    count(*) FILTER (WHERE status='done'), count(*) FILTER (WHERE status='failed'),
    count(*) FILTER (WHERE status IN ('pending','running','stopped')), max(batch),
    count(DISTINCT path),
    count(DISTINCT path) FILTER (WHERE status='done' AND NOT has_more AND NOT EXISTS (
      SELECT 1 FROM competitor_collection_jobs z WHERE z.run_id = _run_id AND z.competitor_id = j.competitor_id AND z.path = j.path AND z.batch > j.batch)),
    coalesce(sum(ads_found),0), coalesce(sum(ads_new),0), coalesce(sum(ads_duplicate),0),
    min(finished_at) FILTER (WHERE status='done'), max(finished_at) FILTER (WHERE status='done'),
    CASE WHEN count(*) FILTER (WHERE status IN ('pending','running')) > 0 THEN 'running'
         WHEN count(*) FILTER (WHERE status='stopped') > 0 THEN 'partial'
         WHEN count(*) FILTER (WHERE status='failed') = count(*) THEN 'failed'
         WHEN count(*) FILTER (WHERE status='failed') > 0 THEN 'partial'
         WHEN coalesce(sum(ads_found),0) = 0 THEN 'empty'
         ELSE 'complete' END,
    (array_agg(error ORDER BY updated_at DESC) FILTER (WHERE error IS NOT NULL))[1], now()
  FROM competitor_collection_jobs j WHERE j.run_id = _run_id GROUP BY j.competitor_id
  ON CONFLICT (run_id, competitor_id) DO UPDATE SET jobs_total = EXCLUDED.jobs_total, jobs_done = EXCLUDED.jobs_done,
    jobs_failed = EXCLUDED.jobs_failed, jobs_open = EXCLUDED.jobs_open, batches_max = EXCLUDED.batches_max,
    paths_total = EXCLUDED.paths_total, paths_exhausted = EXCLUDED.paths_exhausted, ads_found = EXCLUDED.ads_found,
    ads_new = EXCLUDED.ads_new, ads_duplicate = EXCLUDED.ads_duplicate, first_batch_at = EXCLUDED.first_batch_at,
    last_batch_at = EXCLUDED.last_batch_at, status = EXCLUDED.status, last_error = EXCLUDED.last_error, updated_at = now();

  SELECT count(*), count(*) FILTER (WHERE status='done'), count(*) FILTER (WHERE status='failed'),
         count(*) FILTER (WHERE status IN ('pending','running')), count(*) FILTER (WHERE status='stopped'),
         coalesce(sum(ads_found),0), coalesce(sum(ads_new),0), coalesce(sum(ads_duplicate),0), coalesce(sum(ads_changed),0)
    INTO t, d, f, open_, stopped_, af, an, dup, chg FROM competitor_collection_jobs WHERE run_id = _run_id;
  SELECT count(*) INTO cov_partial FROM competitor_collection_coverage WHERE run_id = _run_id AND status IN ('failed','partial','empty');
  SELECT status, control INTO prev, ctl FROM competitor_collection_runs WHERE id = _run_id;
  IF prev = 'cancelled' THEN RETURN prev; END IF;
  st := CASE WHEN open_ > 0 THEN 'running'
             WHEN stopped_ > 0 THEN 'stopped'
             WHEN t = 0 OR f = t OR af = 0 THEN 'failed'
             WHEN f > 0 OR cov_partial > 0 THEN 'partial'
             ELSE 'completed' END;
  -- الغياب دليل موثوق فقط بعد جولة مكتملة: نعلّم الإعلانات غير المرئية لهذه الجولة.
  IF st = 'completed' AND prev <> 'completed' THEN
    UPDATE competitor_raw_ads a SET seen_state = 'not_seen', is_active = false, last_checked_at = now(), updated_at = now()
    WHERE a.competitor_id IN (SELECT competitor_id FROM competitor_collection_coverage WHERE run_id = _run_id AND status = 'complete')
      AND a.last_run_id IS DISTINCT FROM _run_id AND a.seen_state <> 'not_seen';
    GET DIAGNOSTICS ns = ROW_COUNT;
  END IF;
  UPDATE competitor_collection_runs SET jobs_total = t, jobs_done = d, jobs_failed = f, ads_found = af, ads_new = an,
    ads_duplicate = dup, ads_changed = chg, ads_not_seen = CASE WHEN ns > 0 THEN ns ELSE ads_not_seen END,
    status = st, error = CASE WHEN open_ = 0 AND st NOT IN ('completed','stopped') THEN format('%s منافس بتغطية ناقصة أو فارغة، %s مهمة فشلت', cov_partial, f) ELSE NULL END,
    finished_at = CASE WHEN open_ = 0 THEN coalesce(finished_at, now()) ELSE NULL END, updated_at = now()
  WHERE id = _run_id;
  RETURN st;
END; $function$;