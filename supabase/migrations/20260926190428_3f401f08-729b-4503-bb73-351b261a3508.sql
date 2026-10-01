CREATE TABLE public.competitor_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  name_key text NOT NULL,
  description text NOT NULL DEFAULT '',
  keywords text[] NOT NULL DEFAULT '{}',
  criteria text[] NOT NULL DEFAULT '{}',
  description_updated_at timestamptz,
  keywords_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitor_domains TO authenticated;
GRANT ALL ON public.competitor_domains TO service_role;
ALTER TABLE public.competitor_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own domains" ON public.competitor_domains FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TABLE public.domain_discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  domain_id uuid NOT NULL REFERENCES public.competitor_domains(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  phase text NOT NULL DEFAULT 'search',
  control text NOT NULL DEFAULT 'run',
  keywords text[] NOT NULL DEFAULT '{}',
  keys_total integer NOT NULL DEFAULT 0,
  keys_done integer NOT NULL DEFAULT 0,
  keys_failed integer NOT NULL DEFAULT 0,
  ads_found integer NOT NULL DEFAULT 0,
  ads_new integer NOT NULL DEFAULT 0,
  pages_found integer NOT NULL DEFAULT 0,
  pages_analyzed integer NOT NULL DEFAULT 0,
  suggested integer NOT NULL DEFAULT 0,
  rejected_skipped integer NOT NULL DEFAULT 0,
  existing integer NOT NULL DEFAULT 0,
  note text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  deadline_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.domain_discovery_runs (owner_id, domain_id, started_at DESC);
GRANT SELECT ON public.domain_discovery_runs TO authenticated;
GRANT ALL ON public.domain_discovery_runs TO service_role;
ALTER TABLE public.domain_discovery_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own runs read" ON public.domain_discovery_runs FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.domain_discovery_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  domain_id uuid NOT NULL REFERENCES public.competitor_domains(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.domain_discovery_runs(id) ON DELETE SET NULL,
  page_id text NOT NULL,
  page_name text NOT NULL DEFAULT '',
  page_url text NOT NULL DEFAULT '',
  image_url text,
  ads_count integer NOT NULL DEFAULT 0,
  last_ad_at date,
  search_keys text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  decision text,
  activity text,
  reason text,
  ai_result jsonb,
  user_status text NOT NULL DEFAULT 'pending',
  competitor_id uuid REFERENCES public.competitors(id) ON DELETE SET NULL,
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, domain_id, page_id)
);
CREATE INDEX ON public.domain_discovery_pages (run_id, status);
GRANT SELECT ON public.domain_discovery_pages TO authenticated;
GRANT ALL ON public.domain_discovery_pages TO service_role;
ALTER TABLE public.domain_discovery_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pages read" ON public.domain_discovery_pages FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.domain_page_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  domain_id uuid NOT NULL REFERENCES public.competitor_domains(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, domain_id, page_id)
);
GRANT SELECT ON public.domain_page_rejections TO authenticated;
GRANT ALL ON public.domain_page_rejections TO service_role;
ALTER TABLE public.domain_page_rejections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rejections read" ON public.domain_page_rejections FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE TRIGGER t_domains_upd BEFORE UPDATE ON public.competitor_domains FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();
CREATE TRIGGER t_druns_upd BEFORE UPDATE ON public.domain_discovery_runs FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();
CREATE TRIGGER t_dpages_upd BEFORE UPDATE ON public.domain_discovery_pages FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

ALTER TABLE public.competitor_raw_ads ALTER COLUMN competitor_id DROP NOT NULL;
ALTER TABLE public.competitor_raw_ads
  ADD COLUMN discovery_run_id uuid,
  ADD COLUMN discovery_domain_id uuid,
  ADD COLUMN discovery_keys text[] NOT NULL DEFAULT '{}',
  ADD COLUMN discovered_at timestamptz;

CREATE OR REPLACE FUNCTION public.enqueue_raw_ad_analyses(_limit integer DEFAULT 500)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  IF auth.role() <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  INSERT INTO raw_ad_analyses (owner_id, raw_ad_id, source_ad_id)
  SELECT r.owner_id, r.id, r.source_ad_id FROM competitor_raw_ads r
  WHERE r.is_new AND r.competitor_id IS NOT NULL AND r.source_ad_id IS NOT NULL AND btrim(r.source_ad_id) <> ''
    AND NOT EXISTS (SELECT 1 FROM raw_ad_analyses x WHERE x.owner_id = r.owner_id AND x.source_ad_id = r.source_ad_id)
    AND NOT EXISTS (SELECT 1 FROM ads a WHERE a.owner_id = r.owner_id AND a.source_ad_id = r.source_ad_id)
  ORDER BY r.first_seen_at LIMIT _limit
  ON CONFLICT (owner_id, source_ad_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $function$;