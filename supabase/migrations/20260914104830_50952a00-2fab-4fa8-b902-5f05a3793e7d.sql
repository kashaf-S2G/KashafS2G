CREATE TABLE public.openai_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_usd numeric NOT NULL CHECK (amount_usd >= 0),
  credited_at timestamptz NOT NULL DEFAULT now(),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.openai_topups TO authenticated;
GRANT ALL ON public.openai_topups TO service_role;

ALTER TABLE public.openai_topups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view topups" ON public.openai_topups
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert topups" ON public.openai_topups
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update topups" ON public.openai_topups
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete topups" ON public.openai_topups
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_openai_topups_updated_at
  BEFORE UPDATE ON public.openai_topups
  FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

INSERT INTO public.openai_topups (amount_usd, credited_at, note)
SELECT s.openai_credit_usd, s.openai_credit_since, 'شحنة مُرحّلة من الإعداد السابق'
FROM public.ai_pricing_settings s
WHERE s.openai_credit_usd > 0 AND s.openai_credit_since IS NOT NULL;