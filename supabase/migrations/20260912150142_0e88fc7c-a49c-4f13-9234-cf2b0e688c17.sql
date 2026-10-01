ALTER TABLE public.competitors ADD COLUMN IF NOT EXISTS source_page_id text;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS source_page_id text;
ALTER TABLE public.crawl_competitor_items ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.crawl_competitor_items ADD COLUMN IF NOT EXISTS has_more boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS competitors_source_page_id_idx ON public.competitors (owner_id, source_page_id);
CREATE INDEX IF NOT EXISTS ads_source_page_id_idx ON public.ads (owner_id, source_page_id);

-- تعبئة معرّف الصفحة للمنافسين الموجودين من الصفحات المكتشفة سابقًا (مطابقة الرابط أولًا ثم الاسم)
UPDATE public.competitors c
   SET source_page_id = d.source_competitor_id
  FROM public.discovered_competitors d
 WHERE c.source_page_id IS NULL
   AND d.owner_id = c.owner_id
   AND (
     c.competitor_url = d.competitor_url
     OR position(d.source_competitor_id in c.competitor_url) > 0
     OR lower(btrim(c.competitor_name)) = lower(btrim(d.competitor_name))
   );

-- استخراج معرّف الصفحة من الرابط نفسه إن كان رابطًا رقميًا
UPDATE public.competitors
   SET source_page_id = substring(competitor_url from 'facebook\.com/(?:profile\.php\?id=)?([0-9]{6,})')
 WHERE source_page_id IS NULL
   AND competitor_url ~ 'facebook\.com/(?:profile\.php\?id=)?[0-9]{6,}';