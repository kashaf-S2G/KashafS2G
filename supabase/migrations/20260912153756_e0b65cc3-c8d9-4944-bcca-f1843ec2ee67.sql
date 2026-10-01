-- 1) توسيع الصفحات المكتشفة والمنتجات
ALTER TABLE public.discovered_competitors
  ADD COLUMN IF NOT EXISTS discovery_source text NOT NULL DEFAULT 'bank',
  ADD COLUMN IF NOT EXISTS matched_product_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS discovery_last_searched_at timestamptz;

-- 2) حالة منظومة زحف المنتجات
CREATE TABLE public.product_discovery_state (
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_discovery_state TO authenticated;
GRANT ALL ON public.product_discovery_state TO service_role;
ALTER TABLE public.product_discovery_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own product discovery state select" ON public.product_discovery_state
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own product discovery state insert" ON public.product_discovery_state
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own product discovery state update" ON public.product_discovery_state
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own product discovery state delete" ON public.product_discovery_state
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TRIGGER product_discovery_state_touch
  BEFORE UPDATE ON public.product_discovery_state
  FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

-- 3) عمليات زحف المنتجات
CREATE TABLE public.product_discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  trigger_type text NOT NULL DEFAULT 'manual',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  lease_expires_at timestamptz,
  products_searched integer NOT NULL DEFAULT 0,
  pages_found integer NOT NULL DEFAULT 0,
  pages_verified integer NOT NULL DEFAULT 0,
  pages_new integer NOT NULL DEFAULT 0,
  pages_classified integer NOT NULL DEFAULT 0,
  pages_matched integer NOT NULL DEFAULT 0,
  error text,
  product_filter uuid[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX product_discovery_runs_one_running
  ON public.product_discovery_runs (owner_id) WHERE status = 'running';
CREATE INDEX product_discovery_runs_owner_started
  ON public.product_discovery_runs (owner_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_discovery_runs TO authenticated;
GRANT ALL ON public.product_discovery_runs TO service_role;
ALTER TABLE public.product_discovery_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own product discovery runs select" ON public.product_discovery_runs
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own product discovery runs insert" ON public.product_discovery_runs
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own product discovery runs update" ON public.product_discovery_runs
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own product discovery runs delete" ON public.product_discovery_runs
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- 4) بدء عملية واحدة فقط لكل حساب
CREATE OR REPLACE FUNCTION public.acquire_product_discovery_run(_owner_id uuid, _trigger_type text DEFAULT 'manual')
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE new_id uuid;
BEGIN
  IF NOT (auth.role() = 'service_role' OR auth.uid() = _owner_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.product_discovery_runs
     SET status = 'failed', finished_at = now(), error = 'انتهت مهلة العملية السابقة.'
   WHERE owner_id = _owner_id AND status = 'running' AND lease_expires_at < now();
  INSERT INTO public.product_discovery_runs(owner_id, status, trigger_type, lease_expires_at)
  VALUES (_owner_id, 'running', _trigger_type, now() + interval '10 minutes')
  RETURNING id INTO new_id;
  RETURN new_id;
EXCEPTION WHEN unique_violation THEN
  RETURN NULL;
END;
$function$;