CREATE TABLE public.raw_ad_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  raw_ad_id uuid NOT NULL REFERENCES public.competitor_raw_ads(id) ON DELETE CASCADE,
  source_ad_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','needs_review')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  processing_started_at timestamptz,
  processing_completed_at timestamptz,
  last_error text,
  model text,
  analysis_version text,
  result jsonb,
  match_status text CHECK (match_status IN ('MATCHED','NEW_PRODUCT','UNCERTAIN')),
  match_score numeric,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ad_id uuid REFERENCES public.ads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, source_ad_id)
);
GRANT SELECT ON public.raw_ad_analyses TO authenticated;
GRANT ALL ON public.raw_ad_analyses TO service_role;
ALTER TABLE public.raw_ad_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their ad analyses" ON public.raw_ad_analyses FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE INDEX raw_ad_analyses_queue_idx ON public.raw_ad_analyses (status, next_attempt_at);
CREATE TRIGGER raw_ad_analyses_touch BEFORE UPDATE ON public.raw_ad_analyses FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS raw_ad_id uuid REFERENCES public.competitor_raw_ads(id) ON DELETE SET NULL;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS analysis jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS created_from_source_ad_id text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS created_from_ad_id uuid;

-- إدراج الإعلانات الخام الجديدة غير المعالجة في الطابور. الإعلان الذي له سجل في ads مسبقًا لا يدخل AI.
CREATE OR REPLACE FUNCTION public.enqueue_raw_ad_analyses(_limit integer DEFAULT 500)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n integer;
BEGIN
  IF auth.role() <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  INSERT INTO raw_ad_analyses (owner_id, raw_ad_id, source_ad_id)
  SELECT r.owner_id, r.id, r.source_ad_id FROM competitor_raw_ads r
  WHERE r.is_new AND r.source_ad_id IS NOT NULL AND btrim(r.source_ad_id) <> ''
    AND NOT EXISTS (SELECT 1 FROM raw_ad_analyses x WHERE x.owner_id = r.owner_id AND x.source_ad_id = r.source_ad_id)
    AND NOT EXISTS (SELECT 1 FROM ads a WHERE a.owner_id = r.owner_id AND a.source_ad_id = r.source_ad_id)
  ORDER BY r.first_seen_at LIMIT _limit
  ON CONFLICT (owner_id, source_ad_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;

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
    WHERE (x.status = 'pending' AND x.next_attempt_at <= now())
       OR (x.status = 'failed' AND x.attempts < x.max_attempts AND x.next_attempt_at <= now())
       OR (x.status = 'processing' AND x.lease_expires_at < now() AND x.attempts < x.max_attempts)
    ORDER BY x.next_attempt_at LIMIT _limit FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
END; $$;
REVOKE EXECUTE ON FUNCTION public.enqueue_raw_ad_analyses(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_raw_ad_analyses(integer, integer) FROM anon, authenticated;