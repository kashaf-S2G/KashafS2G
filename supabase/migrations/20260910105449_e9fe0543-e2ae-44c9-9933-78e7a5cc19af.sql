CREATE TABLE public.pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  page_name TEXT NOT NULL,
  page_url TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  niche TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.ads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  creation_date DATE NOT NULL,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ads_page_id_idx ON public.ads(page_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pages TO anon, authenticated;
GRANT ALL ON public.pages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ads TO anon, authenticated;
GRANT ALL ON public.ads TO service_role;

ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can manage pages" ON public.pages FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can manage ads" ON public.ads FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);