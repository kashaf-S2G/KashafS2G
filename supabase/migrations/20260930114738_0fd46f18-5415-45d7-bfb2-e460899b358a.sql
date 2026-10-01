CREATE TABLE public.emergency_recheck_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  total integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  completed integer NOT NULL DEFAULT 0,
  needs_review integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  last_raw_ad_id uuid,
  cutoff_at timestamptz NOT NULL DEFAULT now(),
  stop_reason text,
  lease_until timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.emergency_recheck_runs TO authenticated;
GRANT ALL ON public.emergency_recheck_runs TO service_role;
ALTER TABLE public.emergency_recheck_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own emergency rechecks" ON public.emergency_recheck_runs FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE UNIQUE INDEX emergency_recheck_one_active ON public.emergency_recheck_runs (owner_id) WHERE status IN ('running','paused','interrupted');
CREATE TRIGGER emergency_recheck_touch BEFORE UPDATE ON public.emergency_recheck_runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();