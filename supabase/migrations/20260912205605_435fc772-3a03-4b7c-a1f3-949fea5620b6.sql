
CREATE TABLE public.pcrawl_state (
  owner_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'active',
  paused_reason text,
  paused_at timestamptz,
  cycles integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcrawl_state TO authenticated;
GRANT ALL ON public.pcrawl_state TO service_role;
ALTER TABLE public.pcrawl_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pcrawl_state select" ON public.pcrawl_state FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own pcrawl_state insert" ON public.pcrawl_state FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_state update" ON public.pcrawl_state FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_state delete" ON public.pcrawl_state FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.pcrawl_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  research jsonb NOT NULL DEFAULT '{}'::jsonb,
  built_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcrawl_profiles TO authenticated;
GRANT ALL ON public.pcrawl_profiles TO service_role;
ALTER TABLE public.pcrawl_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pcrawl_profiles select" ON public.pcrawl_profiles FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own pcrawl_profiles insert" ON public.pcrawl_profiles FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_profiles update" ON public.pcrawl_profiles FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_profiles delete" ON public.pcrawl_profiles FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.pcrawl_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  last_targeted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcrawl_targets TO authenticated;
GRANT ALL ON public.pcrawl_targets TO service_role;
ALTER TABLE public.pcrawl_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pcrawl_targets select" ON public.pcrawl_targets FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own pcrawl_targets insert" ON public.pcrawl_targets FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_targets update" ON public.pcrawl_targets FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_targets delete" ON public.pcrawl_targets FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.pcrawl_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  trigger_type text NOT NULL DEFAULT 'manual',
  scope text NOT NULL DEFAULT 'general',
  product_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  lease_expires_at timestamptz,
  profiles_built integer NOT NULL DEFAULT 0,
  keys_total integer NOT NULL DEFAULT 0,
  keys_done integer NOT NULL DEFAULT 0,
  ads_found integer NOT NULL DEFAULT 0,
  ads_new integer NOT NULL DEFAULT 0,
  ads_analyzed integer NOT NULL DEFAULT 0,
  matches integer NOT NULL DEFAULT 0,
  pages_candidates integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcrawl_runs TO authenticated;
GRANT ALL ON public.pcrawl_runs TO service_role;
ALTER TABLE public.pcrawl_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pcrawl_runs select" ON public.pcrawl_runs FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own pcrawl_runs insert" ON public.pcrawl_runs FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_runs update" ON public.pcrawl_runs FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_runs delete" ON public.pcrawl_runs FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE INDEX pcrawl_runs_owner_started_idx ON public.pcrawl_runs (owner_id, started_at DESC);

CREATE TABLE public.pcrawl_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES public.pcrawl_runs(id) ON DELETE CASCADE,
  key_text text NOT NULL,
  key_key text NOT NULL,
  kind text NOT NULL DEFAULT 'term',
  product_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  status text NOT NULL DEFAULT 'pending',
  found integer NOT NULL DEFAULT 0,
  searched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, key_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcrawl_keys TO authenticated;
GRANT ALL ON public.pcrawl_keys TO service_role;
ALTER TABLE public.pcrawl_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pcrawl_keys select" ON public.pcrawl_keys FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own pcrawl_keys insert" ON public.pcrawl_keys FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_keys update" ON public.pcrawl_keys FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_keys delete" ON public.pcrawl_keys FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.pcrawl_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  ad_id text NOT NULL,
  page_id text,
  page_name text NOT NULL DEFAULT '',
  page_url text NOT NULL DEFAULT '',
  ad_text text NOT NULL DEFAULT '',
  image_url text,
  source_url text,
  started_on date,
  is_active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending',
  extracted jsonb,
  extracted_name text,
  target_product_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  via_keys text[] NOT NULL DEFAULT '{}'::text[],
  run_id uuid,
  error text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, ad_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcrawl_ads TO authenticated;
GRANT ALL ON public.pcrawl_ads TO service_role;
ALTER TABLE public.pcrawl_ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pcrawl_ads select" ON public.pcrawl_ads FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own pcrawl_ads insert" ON public.pcrawl_ads FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_ads update" ON public.pcrawl_ads FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_ads delete" ON public.pcrawl_ads FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE INDEX pcrawl_ads_owner_status_idx ON public.pcrawl_ads (owner_id, status, last_seen_at DESC);

CREATE TABLE public.pcrawl_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  pcrawl_ad_id uuid NOT NULL REFERENCES public.pcrawl_ads(id) ON DELETE CASCADE,
  ad_id text NOT NULL,
  page_id text,
  page_name text NOT NULL DEFAULT '',
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  score numeric NOT NULL DEFAULT 0,
  decision text NOT NULL DEFAULT 'no_match',
  reasons text[] NOT NULL DEFAULT '{}'::text[],
  differences text[] NOT NULL DEFAULT '{}'::text[],
  extracted_name text,
  search_key text,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, pcrawl_ad_id, product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcrawl_matches TO authenticated;
GRANT ALL ON public.pcrawl_matches TO service_role;
ALTER TABLE public.pcrawl_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pcrawl_matches select" ON public.pcrawl_matches FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own pcrawl_matches insert" ON public.pcrawl_matches FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_matches update" ON public.pcrawl_matches FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own pcrawl_matches delete" ON public.pcrawl_matches FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE INDEX pcrawl_matches_owner_decision_idx ON public.pcrawl_matches (owner_id, decision, created_at DESC);

CREATE TRIGGER pcrawl_state_touch BEFORE UPDATE ON public.pcrawl_state FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();
CREATE TRIGGER pcrawl_profiles_touch BEFORE UPDATE ON public.pcrawl_profiles FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();
CREATE TRIGGER pcrawl_targets_touch BEFORE UPDATE ON public.pcrawl_targets FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();
CREATE TRIGGER pcrawl_runs_touch BEFORE UPDATE ON public.pcrawl_runs FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();
CREATE TRIGGER pcrawl_ads_touch BEFORE UPDATE ON public.pcrawl_ads FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();
CREATE TRIGGER pcrawl_matches_touch BEFORE UPDATE ON public.pcrawl_matches FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

CREATE OR REPLACE FUNCTION public.acquire_pcrawl_run(_owner_id uuid, _trigger_type text, _scope text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  UPDATE public.pcrawl_runs
     SET status = 'done', finished_at = now()
   WHERE owner_id = _owner_id
     AND status = 'running'
     AND lease_expires_at IS NOT NULL
     AND lease_expires_at < now();

  IF EXISTS (SELECT 1 FROM public.pcrawl_runs WHERE owner_id = _owner_id AND status = 'running') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.pcrawl_runs (owner_id, status, trigger_type, scope, lease_expires_at)
  VALUES (_owner_id, 'running', _trigger_type, _scope, now() + interval '10 minutes')
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;
