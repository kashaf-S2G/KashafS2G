CREATE TABLE public.payment_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'vodafone_cash',
  label text NOT NULL DEFAULT '',
  number text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_numbers TO authenticated;
GRANT ALL ON public.payment_numbers TO service_role;

ALTER TABLE public.payment_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_numbers_select" ON public.payment_numbers
  FOR SELECT TO authenticated
  USING (is_active OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "payment_numbers_admin_insert" ON public.payment_numbers
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "payment_numbers_admin_update" ON public.payment_numbers
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "payment_numbers_admin_delete" ON public.payment_numbers
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER payment_numbers_touch
  BEFORE UPDATE ON public.payment_numbers
  FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

INSERT INTO public.payment_numbers (provider, label, number, is_active, sort_order)
VALUES ('vodafone_cash', 'فودافون كاش', '01044137287', true, 1);