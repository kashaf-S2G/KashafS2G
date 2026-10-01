ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS source_ad_id text;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS source_url text;
CREATE UNIQUE INDEX IF NOT EXISTS ads_owner_source_ad_id_key ON public.ads (owner_id, source_ad_id) WHERE source_ad_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.crawl_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  pages_scanned integer NOT NULL DEFAULT 0,
  found integer NOT NULL DEFAULT 0,
  saved integer NOT NULL DEFAULT 0,
  error text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crawl_runs TO authenticated;
GRANT ALL ON public.crawl_runs TO service_role;
ALTER TABLE public.crawl_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY crawl_runs_select_own ON public.crawl_runs FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY crawl_runs_insert_own ON public.crawl_runs FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY crawl_runs_update_own ON public.crawl_runs FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY crawl_runs_delete_own ON public.crawl_runs FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE INDEX IF NOT EXISTS crawl_runs_owner_started_idx ON public.crawl_runs (owner_id, started_at DESC);