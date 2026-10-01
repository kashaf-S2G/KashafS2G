CREATE TYPE public.pc_status AS ENUM ('not_started','in_progress','partially_completed','completed','has_issues');

CREATE TABLE public.pc_phases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phase_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  status public.pc_status NOT NULL DEFAULT 'not_started',
  done_summary TEXT NOT NULL DEFAULT '',
  not_done_summary TEXT NOT NULL DEFAULT '',
  partial_summary TEXT NOT NULL DEFAULT '',
  affected_files TEXT[] NOT NULL DEFAULT '{}',
  affected_tables TEXT[] NOT NULL DEFAULT '{}',
  affected_apis TEXT[] NOT NULL DEFAULT '{}',
  last_known_state TEXT NOT NULL DEFAULT '',
  next_actions TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.pc_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phase_id UUID NOT NULL REFERENCES public.pc_phases(id) ON DELETE CASCADE,
  task_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status public.pc_status NOT NULL DEFAULT 'not_started',
  blocked_reason TEXT,
  verification_notes TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.pc_changes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  phase_id UUID REFERENCES public.pc_phases(id) ON DELETE SET NULL,
  task_id UUID REFERENCES public.pc_tasks(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  affected_component TEXT NOT NULL,
  description TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  previous_state TEXT NOT NULL DEFAULT '',
  new_state TEXT NOT NULL DEFAULT '',
  status public.pc_status NOT NULL DEFAULT 'completed',
  author TEXT NOT NULL DEFAULT 'lovable',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.pc_decisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phase_id UUID REFERENCES public.pc_phases(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL,
  alternatives TEXT NOT NULL DEFAULT '',
  consequences TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.pc_issues (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phase_id UUID REFERENCES public.pc_phases(id) ON DELETE SET NULL,
  task_id UUID REFERENCES public.pc_tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pc_tasks_phase_idx ON public.pc_tasks(phase_id);
CREATE INDEX pc_changes_phase_idx ON public.pc_changes(phase_id);
CREATE INDEX pc_changes_occurred_idx ON public.pc_changes(occurred_at DESC);
CREATE INDEX pc_issues_phase_idx ON public.pc_issues(phase_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_phases TO anon, authenticated;
GRANT ALL ON public.pc_phases TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_tasks TO anon, authenticated;
GRANT ALL ON public.pc_tasks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_changes TO anon, authenticated;
GRANT ALL ON public.pc_changes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_decisions TO anon, authenticated;
GRANT ALL ON public.pc_decisions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_issues TO anon, authenticated;
GRANT ALL ON public.pc_issues TO service_role;

ALTER TABLE public.pc_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can manage pc_phases" ON public.pc_phases FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can manage pc_tasks" ON public.pc_tasks FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can manage pc_changes" ON public.pc_changes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can manage pc_decisions" ON public.pc_decisions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can manage pc_issues" ON public.pc_issues FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.pc_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER pc_phases_touch BEFORE UPDATE ON public.pc_phases FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();
CREATE TRIGGER pc_tasks_touch BEFORE UPDATE ON public.pc_tasks FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();
CREATE TRIGGER pc_issues_touch BEFORE UPDATE ON public.pc_issues FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();