CREATE TABLE public.pcrawl_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  trigger_type text NOT NULL DEFAULT 'manual',
  scope text NOT NULL DEFAULT 'general',
  product_filter uuid[],
  products_targeted integer NOT NULL DEFAULT 0,
  products_profiled integer NOT NULL DEFAULT 0,
  keys_total integer NOT NULL DEFAULT 0,
  keys_searched integer NOT NULL DEFAULT 0,
  pages_found integer NOT NULL DEFAULT 0,
  pages_new integer NOT NULL DEFAULT 0,
  pages_examined integer NOT NULL DEFAULT 0,
  pages_matched integer NOT NULL DEFAULT 0,
  ads_analyzed integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pcrawl_runs_one_running ON public.pcrawl_runs (owner_id) WHERE status = 'running';
CREATE INDEX pcrawl_runs_owner_started ON public.pcrawl_runs (owner_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcrawl_runs TO authenticated;
GRANT ALL ON public.pcrawl_runs TO service_role;
ALTER TABLE public.pcrawl_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pcrawl_runs_select" ON public.pcrawl_runs FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "pcrawl_runs_insert" ON public.pcrawl_runs FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pcrawl_runs_update" ON public.pcrawl_runs FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pcrawl_runs_delete" ON public.pcrawl_runs FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.pcrawl_state (
  owner_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'active',
  paused_reason text,
  paused_at timestamptz,
  cycles integer NOT NULL DEFAULT 0,
  cycle_started_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcrawl_state TO authenticated;
GRANT ALL ON public.pcrawl_state TO service_role;
ALTER TABLE public.pcrawl_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pcrawl_state_select" ON public.pcrawl_state FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "pcrawl_state_insert" ON public.pcrawl_state FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pcrawl_state_update" ON public.pcrawl_state FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pcrawl_state_delete" ON public.pcrawl_state FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE TRIGGER pcrawl_state_touch BEFORE UPDATE ON public.pcrawl_state FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

CREATE TABLE public.pcrawl_product_cursor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  last_crawled_at timestamptz,
  runs integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcrawl_product_cursor TO authenticated;
GRANT ALL ON public.pcrawl_product_cursor TO service_role;
ALTER TABLE public.pcrawl_product_cursor ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pcrawl_cursor_select" ON public.pcrawl_product_cursor FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "pcrawl_cursor_insert" ON public.pcrawl_product_cursor FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pcrawl_cursor_update" ON public.pcrawl_product_cursor FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pcrawl_cursor_delete" ON public.pcrawl_product_cursor FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE TRIGGER pcrawl_cursor_touch BEFORE UPDATE ON public.pcrawl_product_cursor FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

CREATE TABLE public.pcrawl_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES public.pcrawl_runs(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  research jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, product_id)
);
CREATE INDEX pcrawl_profiles_run ON public.pcrawl_profiles (run_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcrawl_profiles TO authenticated;
GRANT ALL ON public.pcrawl_profiles TO service_role;
ALTER TABLE public.pcrawl_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pcrawl_profiles_select" ON public.pcrawl_profiles FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "pcrawl_profiles_insert" ON public.pcrawl_profiles FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pcrawl_profiles_update" ON public.pcrawl_profiles FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pcrawl_profiles_delete" ON public.pcrawl_profiles FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.pcrawl_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES public.pcrawl_runs(id) ON DELETE CASCADE,
  key_text text NOT NULL,
  key_norm text NOT NULL,
  kind text NOT NULL DEFAULT 'product',
  product_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  status text NOT NULL DEFAULT 'pending',
  hits integer NOT NULL DEFAULT 0,
  searched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, key_norm)
);
CREATE INDEX pcrawl_keys_run_status ON public.pcrawl_keys (run_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcrawl_keys TO authenticated;
GRANT ALL ON public.pcrawl_keys TO service_role;
ALTER TABLE public.pcrawl_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pcrawl_keys_select" ON public.pcrawl_keys FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "pcrawl_keys_insert" ON public.pcrawl_keys FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pcrawl_keys_update" ON public.pcrawl_keys FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pcrawl_keys_delete" ON public.pcrawl_keys FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.pcrawl_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  run_id uuid REFERENCES public.pcrawl_runs(id) ON DELETE SET NULL,
  page_row_id uuid NOT NULL REFERENCES public.discovered_competitors(id) ON DELETE CASCADE,
  source_page_id text,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  source_ad_id text NOT NULL,
  source_url text,
  ad_text text,
  ad_image_url text,
  extracted_product jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_score numeric NOT NULL DEFAULT 0,
  decision text NOT NULL DEFAULT 'different',
  reasons text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_row_id, product_id, source_ad_id)
);
CREATE INDEX pcrawl_evidence_page ON public.pcrawl_evidence (page_row_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pcrawl_evidence TO authenticated;
GRANT ALL ON public.pcrawl_evidence TO service_role;
ALTER TABLE public.pcrawl_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pcrawl_evidence_select" ON public.pcrawl_evidence FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "pcrawl_evidence_insert" ON public.pcrawl_evidence FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pcrawl_evidence_update" ON public.pcrawl_evidence FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pcrawl_evidence_delete" ON public.pcrawl_evidence FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.acquire_pcrawl_run(_owner_id uuid, _trigger_type text DEFAULT 'manual', _scope text DEFAULT 'general')
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT (auth.role() = 'service_role' OR auth.uid() = _owner_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.pcrawl_runs
     SET status = 'failed', finished_at = now(), error = 'انتهت مهلة العملية السابقة.'
   WHERE owner_id = _owner_id AND status = 'running' AND lease_expires_at < now();
  INSERT INTO public.pcrawl_runs(owner_id, status, trigger_type, scope, lease_expires_at)
  VALUES (_owner_id, 'running', _trigger_type, _scope, now() + interval '12 minutes')
  RETURNING id INTO new_id;
  RETURN new_id;
EXCEPTION WHEN unique_violation THEN
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.acquire_pcrawl_run(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acquire_pcrawl_run(uuid, text, text) TO authenticated, service_role;

SELECT cron.schedule(
  'product-crawl-every-3h',
  '30 */3 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--c91e58df-5901-49fc-8236-72b7beb77fba.lovable.app/api/public/product-crawl/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-discovery-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'discovery_cron_token' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);