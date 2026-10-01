CREATE TABLE public.project_source_info (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  repo_full_name text,
  repo_url text,
  repo_owner text,
  default_branch text,
  last_branch text,
  last_commit_sha text,
  last_commit_message text,
  last_commit_at timestamptz,
  last_pusher text,
  push_count integer NOT NULL DEFAULT 0,
  last_event text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.project_source_info TO authenticated;
GRANT ALL ON public.project_source_info TO service_role;
ALTER TABLE public.project_source_info ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view project source info" ON public.project_source_info
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));