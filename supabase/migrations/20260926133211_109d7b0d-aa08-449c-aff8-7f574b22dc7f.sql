ALTER TABLE public.competitor_raw_ads ADD COLUMN IF NOT EXISTS is_new boolean NOT NULL DEFAULT false;
UPDATE public.competitor_raw_ads SET seen_state = 'stopped' WHERE seen_state = 'not_seen';

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
  -- الغياب دليل موثوق فقط بعد جولة مكتملة: الإعلان غير المرئي يصبح stopped ويُخفى من الإعلانات الحالية.
  IF st = 'completed' AND prev <> 'completed' THEN
    WITH s AS (
      UPDATE competitor_raw_ads a SET seen_state = 'stopped', is_active = false, last_checked_at = now(), updated_at = now()
      WHERE a.competitor_id IN (SELECT competitor_id FROM competitor_collection_coverage WHERE run_id = _run_id AND status = 'complete')
        AND a.last_run_id IS DISTINCT FROM _run_id AND a.seen_state <> 'stopped'
      RETURNING a.owner_id, a.source_ad_id
    ), u AS (
      UPDATE ads x SET status = 'inactive', end_date = coalesce(x.end_date, current_date), updated_at = now()
      FROM s WHERE x.owner_id = s.owner_id AND x.source_ad_id = s.source_ad_id AND x.status = 'active'
      RETURNING 1
    )
    SELECT count(*) INTO ns FROM s;
  END IF;
  UPDATE competitor_collection_runs SET jobs_total = t, jobs_done = d, jobs_failed = f, ads_found = af, ads_new = an,
    ads_duplicate = dup, ads_changed = chg, ads_not_seen = CASE WHEN ns > 0 THEN ns ELSE ads_not_seen END,
    status = st, error = CASE WHEN open_ = 0 AND st NOT IN ('completed','stopped') THEN format('%s منافس بتغطية ناقصة أو فارغة، %s مهمة فشلت', cov_partial, f) ELSE NULL END,
    finished_at = CASE WHEN open_ = 0 THEN coalesce(finished_at, now()) ELSE NULL END, updated_at = now()
  WHERE id = _run_id;
  RETURN st;
END; $function$;