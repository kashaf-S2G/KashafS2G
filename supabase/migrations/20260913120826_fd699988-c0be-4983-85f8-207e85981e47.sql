ALTER TABLE public.competitors ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.seed_demo_data(_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  p_watch uuid; p_buds uuid; p_kitchen uuid; p_lamp uuid;
  c_trendy uuid; c_elegance uuid; c_gadget uuid;
  suffix text := replace(_uid::text, '-', '');
BEGIN
  IF EXISTS (SELECT 1 FROM public.competitors WHERE owner_id = _uid)
     OR EXISTS (SELECT 1 FROM public.products WHERE owner_id = _uid) THEN
    RETURN;
  END IF;

  INSERT INTO public.products (owner_id, canonical_name, canonical_key, code, profile, is_demo)
  VALUES (_uid, 'ساعة ذكية T900 Pro', 'ساعة ذكية t900 pro', 'P-DEMO1', '{}'::jsonb, true)
  RETURNING id INTO p_watch;
  INSERT INTO public.products (owner_id, canonical_name, canonical_key, code, profile, is_demo)
  VALUES (_uid, 'سماعات بلوتوث لاسلكية', 'سماعات بلوتوث لاسلكية', 'P-DEMO2', '{}'::jsonb, true)
  RETURNING id INTO p_buds;
  INSERT INTO public.products (owner_id, canonical_name, canonical_key, code, profile, is_demo)
  VALUES (_uid, 'منظم أدوات المطبخ', 'منظم أدوات المطبخ', 'P-DEMO3', '{}'::jsonb, true)
  RETURNING id INTO p_kitchen;
  INSERT INTO public.products (owner_id, canonical_name, canonical_key, code, profile, is_demo)
  VALUES (_uid, 'مصباح مكتب LED قابل للطي', 'مصباح مكتب led قابل للطي', 'P-DEMO4', '{}'::jsonb, true)
  RETURNING id INTO p_lamp;

  INSERT INTO public.competitors (owner_id, competitor_name, competitor_url, platform, niche, is_demo)
  VALUES (_uid, 'تريندي ستور (تجريبي)', 'https://www.facebook.com/demo-trendy-store-' || suffix, 'Facebook', 'إكسسوارات وأجهزة ذكية', true)
  RETURNING id INTO c_trendy;
  INSERT INTO public.competitors (owner_id, competitor_name, competitor_url, platform, niche, is_demo)
  VALUES (_uid, 'سوق الأناقة (تجريبي)', 'https://www.instagram.com/demo-elegance-souq-' || suffix, 'Instagram', 'منتجات منزلية', true)
  RETURNING id INTO c_elegance;
  INSERT INTO public.competitors (owner_id, competitor_name, competitor_url, platform, niche, is_demo)
  VALUES (_uid, 'جادجت هب (تجريبي)', 'https://www.tiktok.com/@demo-gadget-hub-' || suffix, 'TikTok', 'إلكترونيات', true)
  RETURNING id INTO c_gadget;

  INSERT INTO public.ads (owner_id, competitor_id, product_id, product_name, product_description, creation_date, end_date, status, source_platform, is_demo)
  VALUES
    (_uid, c_trendy, p_watch, 'ساعة ذكية T900 Pro', 'إعلان تجريبي: ساعة ذكية بشاشة كبيرة ومتابعة للياقة، عرض شحن مجاني.', (now() - interval '62 days')::date, NULL, 'active', 'Facebook', true),
    (_uid, c_trendy, p_buds, 'سماعات بلوتوث لاسلكية', 'إعلان تجريبي: سماعات بعزل ضوضاء وبطارية ٣٠ ساعة.', (now() - interval '28 days')::date, NULL, 'active', 'Facebook', true),
    (_uid, c_trendy, p_kitchen, 'منظم أدوات المطبخ', 'إعلان تجريبي: منظم متعدد الطبقات لتوفير مساحة المطبخ.', (now() - interval '90 days')::date, (now() - interval '45 days')::date, 'inactive', 'Facebook', true),
    (_uid, c_elegance, p_kitchen, 'منظم أدوات المطبخ', 'إعلان تجريبي: عرض قطعتين بسعر واحدة.', (now() - interval '41 days')::date, NULL, 'active', 'Instagram', true),
    (_uid, c_elegance, p_lamp, 'مصباح مكتب LED قابل للطي', 'إعلان تجريبي: إضاءة ٣ درجات وشحن USB.', (now() - interval '17 days')::date, NULL, 'active', 'Instagram', true),
    (_uid, c_elegance, p_watch, 'ساعة ذكية T900 Pro', 'إعلان تجريبي: نسخة بسوار معدني مع خصم ٢٠٪.', (now() - interval '75 days')::date, (now() - interval '20 days')::date, 'inactive', 'Instagram', true),
    (_uid, c_gadget, p_buds, 'سماعات بلوتوث لاسلكية', 'إعلان تجريبي: فيديو تجربة استخدام مع كود خصم.', (now() - interval '120 days')::date, NULL, 'active', 'TikTok', true),
    (_uid, c_gadget, p_lamp, 'مصباح مكتب LED قابل للطي', 'إعلان تجريبي: مناسب للطلاب والمكاتب المنزلية.', (now() - interval '9 days')::date, NULL, 'active', 'TikTok', true),
    (_uid, c_gadget, p_watch, 'ساعة ذكية T900 Pro', 'إعلان تجريبي: مقارنة بين موديلين مع عرض الدفع عند الاستلام.', (now() - interval '150 days')::date, (now() - interval '96 days')::date, 'inactive', 'TikTok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''))
  ON CONFLICT (id) DO NOTHING;

  BEGIN
    PERFORM public.seed_demo_data(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_demo_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  DELETE FROM public.ads WHERE owner_id = uid AND is_demo;
  DELETE FROM public.products WHERE owner_id = uid AND is_demo;
  DELETE FROM public.competitors WHERE owner_id = uid AND is_demo;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_demo_data(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_demo_data() TO authenticated;