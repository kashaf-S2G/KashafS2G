CREATE TABLE public.pb_review_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('fit','merge')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','paused','finished','stopped','cancelled')),
  problem_ids uuid[] NOT NULL DEFAULT '{}',
  cursor int NOT NULL DEFAULT 0,
  total int NOT NULL DEFAULT 0,
  reviewed int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  current_text text NOT NULL DEFAULT '',
  log jsonb NOT NULL DEFAULT '[]'::jsonb,
  wake_base text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pb_review_jobs TO authenticated;
GRANT ALL ON public.pb_review_jobs TO service_role;
ALTER TABLE public.pb_review_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners read review jobs" ON public.pb_review_jobs FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE INDEX pb_review_jobs_owner_idx ON public.pb_review_jobs (owner_id, created_at DESC);
CREATE INDEX pb_review_jobs_running_idx ON public.pb_review_jobs (status) WHERE status = 'running';