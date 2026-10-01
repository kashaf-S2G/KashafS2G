DO $$
DECLARE
  target_job_id bigint;
BEGIN
  SELECT jobid INTO target_job_id
  FROM cron.job
  WHERE jobname = 'discovery-every-3h'
  LIMIT 1;

  IF target_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(target_job_id);
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.acquire_discovery_run(uuid, text);
DROP TABLE IF EXISTS public.discovery_runs;
DROP TABLE IF EXISTS public.discovery_state;