CREATE TABLE public.product_term_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES public.discovery_terms(id) ON DELETE CASCADE,
  related boolean NOT NULL DEFAULT false,
  score numeric,
  source text NOT NULL DEFAULT 'ai',
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, product_id, term_id)
);

CREATE INDEX product_term_links_owner_related_idx ON public.product_term_links (owner_id, related);
CREATE INDEX product_term_links_product_idx ON public.product_term_links (product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_term_links TO authenticated;
GRANT ALL ON public.product_term_links TO service_role;

ALTER TABLE public.product_term_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_term_links_select_own ON public.product_term_links FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY product_term_links_insert_own ON public.product_term_links FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY product_term_links_update_own ON public.product_term_links FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY product_term_links_delete_own ON public.product_term_links FOR DELETE TO authenticated USING (owner_id = auth.uid());