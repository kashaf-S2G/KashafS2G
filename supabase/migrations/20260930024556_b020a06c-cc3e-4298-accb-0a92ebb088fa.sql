CREATE TABLE public.pb_link_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  link_id uuid NOT NULL,
  statement_id uuid NOT NULL,
  product_id uuid NOT NULL,
  verdict text NOT NULL,
  reason text NOT NULL DEFAULT '',
  confidence text NOT NULL DEFAULT 'low',
  suggested_problem_id uuid,
  suggested_reason text,
  create_new_problem boolean NOT NULL DEFAULT false,
  new_problem_description text,
  new_problem_reason text,
  status text NOT NULL DEFAULT 'pending',
  status_note text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pb_link_reviews TO authenticated;
GRANT ALL ON public.pb_link_reviews TO service_role;
ALTER TABLE public.pb_link_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY pb_link_reviews_select_own ON public.pb_link_reviews FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE INDEX pb_link_reviews_owner_status_idx ON public.pb_link_reviews (owner_id, status, reviewed_at DESC);
CREATE TRIGGER pb_link_reviews_touch BEFORE UPDATE ON public.pb_link_reviews FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();