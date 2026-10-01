CREATE OR REPLACE FUNCTION public.ads_require_resolved_product()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  prod_owner uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.product_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_RESOLVED: كل إعلان يجب أن يمر على فلتر توحيد المنتجات قبل حفظه.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.product_id IS NOT NULL AND NEW.product_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_RESOLVED: لا يمكن فصل الإعلان عن منتجه الموحّد.';
  END IF;

  IF NEW.product_id IS NOT NULL THEN
    SELECT p.owner_id INTO prod_owner FROM public.products p WHERE p.id = NEW.product_id;
    IF prod_owner IS NULL THEN
      RAISE EXCEPTION 'PRODUCT_NOT_RESOLVED: المنتج الموحّد غير موجود.';
    END IF;
    IF NEW.owner_id IS NOT NULL AND prod_owner <> NEW.owner_id THEN
      RAISE EXCEPTION 'PRODUCT_NOT_RESOLVED: المنتج الموحّد يخص حسابًا آخر.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ads_require_resolved_product ON public.ads;
CREATE TRIGGER ads_require_resolved_product
BEFORE INSERT OR UPDATE ON public.ads
FOR EACH ROW EXECUTE FUNCTION public.ads_require_resolved_product();