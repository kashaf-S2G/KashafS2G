CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  canonical_name text NOT NULL,
  canonical_key text NOT NULL,
  code text NOT NULL,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, canonical_key),
  UNIQUE (owner_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_select_own ON public.products FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY products_insert_own ON public.products FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY products_update_own ON public.products FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY products_delete_own ON public.products FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE TRIGGER products_touch BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

CREATE TABLE public.product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  alias_name text NOT NULL,
  alias_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, alias_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_aliases TO authenticated;
GRANT ALL ON public.product_aliases TO service_role;
ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_aliases_select_own ON public.product_aliases FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY product_aliases_insert_own ON public.product_aliases FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY product_aliases_update_own ON public.product_aliases FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY product_aliases_delete_own ON public.product_aliases FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.crawl_settings (
  owner_id uuid PRIMARY KEY DEFAULT auth.uid(),
  status text NOT NULL DEFAULT 'active',
  paused_reason text,
  paused_at timestamptz,
  last_scheduled_at timestamptz,
  consecutive_rate_limits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crawl_settings TO authenticated;
GRANT ALL ON public.crawl_settings TO service_role;
ALTER TABLE public.crawl_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY crawl_settings_select_own ON public.crawl_settings FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY crawl_settings_insert_own ON public.crawl_settings FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY crawl_settings_update_own ON public.crawl_settings FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY crawl_settings_delete_own ON public.crawl_settings FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE TRIGGER crawl_settings_touch BEFORE UPDATE ON public.crawl_settings FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS last_crawled_at timestamptz;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS crawl_status text;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS crawl_error text;

ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS source_platform text;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

ALTER TABLE public.crawl_runs ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'manual';
ALTER TABLE public.crawl_runs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE public.crawl_runs ADD COLUMN IF NOT EXISTS updated integer NOT NULL DEFAULT 0;
ALTER TABLE public.crawl_runs ADD COLUMN IF NOT EXISTS unsupported integer NOT NULL DEFAULT 0;

CREATE TABLE public.crawl_page_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  run_id uuid NOT NULL REFERENCES public.crawl_runs(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  found integer NOT NULL DEFAULT 0,
  saved integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, page_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crawl_page_items TO authenticated;
GRANT ALL ON public.crawl_page_items TO service_role;
ALTER TABLE public.crawl_page_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY crawl_page_items_select_own ON public.crawl_page_items FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY crawl_page_items_insert_own ON public.crawl_page_items FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY crawl_page_items_update_own ON public.crawl_page_items FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY crawl_page_items_delete_own ON public.crawl_page_items FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE INDEX crawl_page_items_run_status_idx ON public.crawl_page_items (run_id, status, created_at);

DROP INDEX IF EXISTS public.ads_owner_source_ad_id_key;
CREATE UNIQUE INDEX ads_owner_platform_source_key ON public.ads (owner_id, source_platform, source_ad_id) WHERE source_ad_id IS NOT NULL;
CREATE UNIQUE INDEX crawl_runs_one_running_per_owner ON public.crawl_runs (owner_id) WHERE status = 'running';

CREATE OR REPLACE FUNCTION public.acquire_crawl_run(_trigger_type text DEFAULT 'manual')
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  new_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  UPDATE public.crawl_runs
     SET status = 'failed', finished_at = now(), error = 'انتهت مهلة العملية السابقة.'
   WHERE owner_id = uid AND status = 'running' AND lease_expires_at < now();
  INSERT INTO public.crawl_runs(owner_id, status, trigger_type, lease_expires_at)
  VALUES (uid, 'running', _trigger_type, now() + interval '12 minutes')
  RETURNING id INTO new_id;
  RETURN new_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'CRAWL_ALREADY_RUNNING';
END;
$$;
GRANT EXECUTE ON FUNCTION public.acquire_crawl_run(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_crawl_run(text) TO service_role;

CREATE OR REPLACE FUNCTION public.acquire_crawl_run_for(_owner_id uuid, _trigger_type text DEFAULT 'scheduled')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE public.crawl_runs
     SET status = 'failed', finished_at = now(), error = 'انتهت مهلة العملية السابقة.'
   WHERE owner_id = _owner_id AND status = 'running' AND lease_expires_at < now();
  INSERT INTO public.crawl_runs(owner_id, status, trigger_type, lease_expires_at)
  VALUES (_owner_id, 'running', _trigger_type, now() + interval '12 minutes')
  RETURNING id INTO new_id;
  RETURN new_id;
EXCEPTION WHEN unique_violation THEN
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.acquire_crawl_run_for(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_crawl_run_for(uuid, text) TO service_role;

CREATE INDEX products_owner_name_idx ON public.products(owner_id, canonical_name);
CREATE INDEX product_aliases_product_idx ON public.product_aliases(product_id);
CREATE INDEX pages_owner_last_crawled_idx ON public.pages(owner_id, last_crawled_at NULLS FIRST);
CREATE INDEX ads_owner_product_idx ON public.ads(owner_id, product_id);
