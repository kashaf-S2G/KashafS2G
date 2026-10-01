CREATE TABLE public.ccrawl_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  control text NOT NULL DEFAULT 'none',
  trigger_type text NOT NULL DEFAULT 'manual',
  scope text NOT NULL DEFAULT 'general',
  category_ids uuid[] NOT NULL DEFAULT '{}',
  categories text[] NOT NULL DEFAULT '{}',
  keys_total integer NOT NULL DEFAULT 0,
  keys_done integer NOT NULL DEFAULT 0,
  pages_found integer NOT NULL DEFAULT 0,
  pages_analyzed integer NOT NULL DEFAULT 0,
  matches integer NOT NULL DEFAULT 0,
  note text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  deadline_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ccrawl_runs TO authenticated;
GRANT ALL ON public.ccrawl_runs TO service_role;
ALTER TABLE public.ccrawl_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ccrawl runs" ON public.ccrawl_runs FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE UNIQUE INDEX ccrawl_runs_one_running ON public.ccrawl_runs(owner_id) WHERE status = 'running';
CREATE TRIGGER ccrawl_runs_touch BEFORE UPDATE ON public.ccrawl_runs FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

CREATE TABLE public.ccrawl_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES public.ccrawl_runs(id) ON DELETE CASCADE,
  key_text text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  found integer NOT NULL DEFAULT 0,
  searched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ccrawl_keys TO authenticated;
GRANT ALL ON public.ccrawl_keys TO service_role;
ALTER TABLE public.ccrawl_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ccrawl keys" ON public.ccrawl_keys FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX ccrawl_keys_run ON public.ccrawl_keys(run_id, status);

CREATE TABLE public.ccrawl_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  run_id uuid,
  page_id text NOT NULL,
  page_name text NOT NULL DEFAULT '',
  page_url text NOT NULL DEFAULT '',
  image_url text,
  ads_sample text[] NOT NULL DEFAULT '{}',
  ad_ids text[] NOT NULL DEFAULT '{}',
  search_key text,
  status text NOT NULL DEFAULT 'pending',
  score numeric NOT NULL DEFAULT 0,
  decision text,
  matched_categories text[] NOT NULL DEFAULT '{}',
  reasons text[] NOT NULL DEFAULT '{}',
  differences text[] NOT NULL DEFAULT '{}',
  error text,
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, page_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ccrawl_pages TO authenticated;
GRANT ALL ON public.ccrawl_pages TO service_role;
ALTER TABLE public.ccrawl_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ccrawl pages" ON public.ccrawl_pages FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX ccrawl_pages_run ON public.ccrawl_pages(run_id, status);
CREATE TRIGGER ccrawl_pages_touch BEFORE UPDATE ON public.ccrawl_pages FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();