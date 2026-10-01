CREATE TABLE public.product_code_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  product_key text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, product_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_code_overrides TO authenticated;
GRANT ALL ON public.product_code_overrides TO service_role;
ALTER TABLE public.product_code_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_code_overrides_select_own" ON public.product_code_overrides FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "product_code_overrides_insert_own" ON public.product_code_overrides FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "product_code_overrides_update_own" ON public.product_code_overrides FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "product_code_overrides_delete_own" ON public.product_code_overrides FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE TRIGGER product_code_overrides_touch BEFORE UPDATE ON public.product_code_overrides FOR EACH ROW EXECUTE FUNCTION pc_touch_updated_at();