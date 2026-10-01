ALTER TABLE public.discovery_terms
  ADD COLUMN IF NOT EXISTS product_discovery_last_searched_at timestamptz;

CREATE INDEX IF NOT EXISTS discovery_terms_product_discovery_order
  ON public.discovery_terms (owner_id, product_discovery_last_searched_at NULLS FIRST);