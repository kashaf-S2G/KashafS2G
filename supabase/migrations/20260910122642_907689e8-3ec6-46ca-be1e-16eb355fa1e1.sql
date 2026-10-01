-- 1) ownership column
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS owner_id uuid DEFAULT auth.uid();
ALTER TABLE public.ads   ADD COLUMN IF NOT EXISTS owner_id uuid DEFAULT auth.uid();

-- 2) updated_at + auto touch
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.ads   ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS pages_touch ON public.pages;
CREATE TRIGGER pages_touch BEFORE UPDATE ON public.pages
FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

DROP TRIGGER IF EXISTS ads_touch ON public.ads;
CREATE TRIGGER ads_touch BEFORE UPDATE ON public.ads
FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

CREATE INDEX IF NOT EXISTS pages_owner_id_idx ON public.pages(owner_id);
CREATE INDEX IF NOT EXISTS ads_owner_id_idx ON public.ads(owner_id);

-- 3) revoke anon access
REVOKE ALL ON public.pages FROM anon;
REVOKE ALL ON public.ads FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ads TO authenticated;
GRANT ALL ON public.pages TO service_role;
GRANT ALL ON public.ads TO service_role;

-- 4) owner-scoped policies
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can manage pages" ON public.pages;
DROP POLICY IF EXISTS "Anyone can manage ads" ON public.ads;

CREATE POLICY "pages_select_own" ON public.pages FOR SELECT TO authenticated
  USING (owner_id = auth.uid());
CREATE POLICY "pages_insert_own" ON public.pages FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pages_update_own" ON public.pages FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "pages_delete_own" ON public.pages FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "ads_select_own" ON public.ads FOR SELECT TO authenticated
  USING (owner_id = auth.uid());
CREATE POLICY "ads_insert_own" ON public.ads FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
  );
CREATE POLICY "ads_update_own" ON public.ads FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "ads_delete_own" ON public.ads FOR DELETE TO authenticated
  USING (owner_id = auth.uid());