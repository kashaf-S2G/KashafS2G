CREATE TABLE public.raw_ad_analysis_control (
  owner_id uuid PRIMARY KEY,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','paused','idle')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.raw_ad_analysis_control TO authenticated;
GRANT ALL ON public.raw_ad_analysis_control TO service_role;
ALTER TABLE public.raw_ad_analysis_control ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their analysis control" ON public.raw_ad_analysis_control FOR SELECT TO authenticated USING (auth.uid() = owner_id);

ALTER TABLE public.raw_ad_analyses DROP CONSTRAINT IF EXISTS raw_ad_analyses_status_check;
ALTER TABLE public.raw_ad_analyses ADD CONSTRAINT raw_ad_analyses_status_check CHECK (status IN ('pending','processing','completed','failed','needs_review','cancelled'));

CREATE OR REPLACE FUNCTION public.claim_raw_ad_analyses(_limit integer, _lease_seconds integer DEFAULT 180)
RETURNS SETOF public.raw_ad_analyses LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE raw_ad_analyses SET status = 'failed', lease_expires_at = NULL, last_error = coalesce(last_error, 'انتهت المهلة بعد آخر محاولة')
   WHERE status = 'processing' AND lease_expires_at < now() AND attempts >= max_attempts;
  RETURN QUERY
  UPDATE raw_ad_analyses j SET status = 'processing', attempts = j.attempts + 1,
    lease_expires_at = now() + make_interval(secs => _lease_seconds),
    processing_started_at = now(), updated_at = now()
  WHERE j.id IN (
    SELECT x.id FROM raw_ad_analyses x
    WHERE ((x.status = 'pending' AND x.next_attempt_at <= now())
       OR (x.status = 'failed' AND x.attempts < x.max_attempts AND x.next_attempt_at <= now())
       OR (x.status = 'processing' AND x.lease_expires_at < now() AND x.attempts < x.max_attempts))
      AND NOT EXISTS (SELECT 1 FROM raw_ad_analysis_control c WHERE c.owner_id = x.owner_id AND c.state <> 'active')
    ORDER BY x.next_attempt_at LIMIT _limit FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
END; $$;
REVOKE EXECUTE ON FUNCTION public.claim_raw_ad_analyses(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_raw_ad_analyses(integer, integer) TO service_role;