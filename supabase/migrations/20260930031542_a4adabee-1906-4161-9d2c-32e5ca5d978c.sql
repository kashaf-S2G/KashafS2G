CREATE TABLE public.pb_merge_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_statement_id UUID NOT NULL REFERENCES public.pb_statements(id) ON DELETE CASCADE,
  target_statement_id UUID NOT NULL REFERENCES public.pb_statements(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('merge','separate','uncertain')),
  reason TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'low' CHECK (confidence IN ('high','medium','low')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','stale')),
  status_note TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  decided_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX pb_merge_reviews_owner_status_idx ON public.pb_merge_reviews (owner_id, status, reviewed_at DESC);
GRANT SELECT ON public.pb_merge_reviews TO authenticated;
GRANT ALL ON public.pb_merge_reviews TO service_role;
ALTER TABLE public.pb_merge_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads own merge reviews" ON public.pb_merge_reviews FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_pb_merge_reviews_updated_at BEFORE UPDATE ON public.pb_merge_reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();