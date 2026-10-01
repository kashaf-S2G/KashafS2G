ALTER TABLE public.pb_statements ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public.pb_statements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.ad_statements DROP CONSTRAINT IF EXISTS ad_statements_source_check;
ALTER TABLE public.ad_statements ADD CONSTRAINT ad_statements_source_check CHECK (source = ANY (ARRAY['pb_ai','unified','review']));

CREATE TABLE public.pb_statement_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  statement_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'unified',
  evidence text NOT NULL DEFAULT '',
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pb_statement_products_statement_fk FOREIGN KEY (statement_id, owner_id) REFERENCES public.pb_statements(id, owner_id) ON DELETE CASCADE,
  CONSTRAINT pb_statement_products_unique UNIQUE (statement_id, product_id),
  CONSTRAINT pb_statement_products_source_check CHECK (source = ANY (ARRAY['unified','review','backfill']))
);
CREATE INDEX pb_statement_products_product_idx ON public.pb_statement_products(owner_id, product_id);
GRANT SELECT ON public.pb_statement_products TO authenticated;
GRANT ALL ON public.pb_statement_products TO service_role;
ALTER TABLE public.pb_statement_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY pb_statement_products_select_own ON public.pb_statement_products FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE TRIGGER pb_statement_products_touch BEFORE UPDATE ON public.pb_statement_products FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

-- دمج آمن: ينقل روابط الإعلانات والمنتجات إلى المشكلة الأساسية ثم يؤرشف المكررات (بدون حذف).
CREATE OR REPLACE FUNCTION public.merge_pb_statements(_owner_id uuid, _canonical uuid, _duplicates uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pb_statements WHERE id = _canonical AND owner_id = _owner_id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'canonical problem not found';
  END IF;
  _duplicates := ARRAY(SELECT id FROM pb_statements WHERE id = ANY(_duplicates) AND id <> _canonical
    AND owner_id = _owner_id AND archived_at IS NULL AND kind = (SELECT kind FROM pb_statements WHERE id = _canonical));
  n := coalesce(array_length(_duplicates, 1), 0);
  IF n = 0 THEN RETURN 0; END IF;
  DELETE FROM ad_statements d WHERE d.statement_id = ANY(_duplicates) AND d.owner_id = _owner_id
    AND EXISTS (SELECT 1 FROM ad_statements c WHERE c.statement_id = _canonical AND c.ad_id = d.ad_id);
  DELETE FROM ad_statements d WHERE d.statement_id = ANY(_duplicates) AND d.owner_id = _owner_id
    AND d.id NOT IN (SELECT DISTINCT ON (ad_id) id FROM ad_statements WHERE statement_id = ANY(_duplicates) ORDER BY ad_id, created_at);
  UPDATE ad_statements SET statement_id = _canonical, normalized_key = _canonical::text, updated_at = now()
    WHERE statement_id = ANY(_duplicates) AND owner_id = _owner_id;
  INSERT INTO pb_statement_products (owner_id, statement_id, product_id, source, evidence, confidence)
    SELECT DISTINCT ON (product_id) _owner_id, _canonical, product_id, source, evidence, confidence
    FROM pb_statement_products WHERE statement_id = ANY(_duplicates) AND owner_id = _owner_id
    ORDER BY product_id, confidence DESC NULLS LAST
    ON CONFLICT (statement_id, product_id) DO NOTHING;
  DELETE FROM pb_statement_products WHERE statement_id = ANY(_duplicates) AND owner_id = _owner_id;
  UPDATE pb_statements SET merged_into = _canonical, archived_at = now(), updated_at = now()
    WHERE id = ANY(_duplicates) AND owner_id = _owner_id;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.merge_pb_statements(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_pb_statements(uuid, uuid, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.get_pb_statements_page(_kind text DEFAULT NULL::text, _search text DEFAULT ''::text, _sort text DEFAULT 'newest'::text, _limit integer DEFAULT 50, _page integer DEFAULT 1)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
WITH s AS (
  SELECT p.id, p.kind, p.display_text, p.normalized_key, p.description
  FROM public.pb_statements p WHERE (_kind IS NULL OR p.kind = _kind) AND p.archived_at IS NULL
),
occ AS (
  SELECT DISTINCT o.statement_id, a.id AS ad_id, a.status, a.competitor_id, a.creation_date
  FROM public.ad_statements o JOIN public.ads a ON a.id = o.ad_id AND a.owner_id = o.owner_id
  WHERE o.statement_id IN (SELECT id FROM s)
),
agg AS (
  SELECT statement_id, count(DISTINCT ad_id) AS total_ads,
    count(DISTINCT ad_id) FILTER (WHERE status = 'active') AS active_ads,
    count(DISTINCT ad_id) FILTER (WHERE status IS DISTINCT FROM 'active') AS stopped_ads,
    count(DISTINCT competitor_id) AS competitors,
    min(creation_date) AS first_seen, max(creation_date) AS last_seen
  FROM occ GROUP BY statement_id
),
pr AS (
  SELECT statement_id, count(DISTINCT product_id) AS products FROM public.pb_statement_products
  WHERE statement_id IN (SELECT id FROM s) GROUP BY statement_id
),
items AS (
  SELECT s.*, coalesce(g.total_ads,0) AS total_ads, coalesce(g.active_ads,0) AS active_ads,
    coalesce(g.stopped_ads,0) AS stopped_ads, coalesce(pr.products,0) AS products,
    coalesce(g.competitors,0) AS competitors, g.first_seen, g.last_seen
  FROM s LEFT JOIN agg g ON g.statement_id = s.id LEFT JOIN pr ON pr.statement_id = s.id
),
filtered AS (
  SELECT i.*, row_number() OVER (ORDER BY
    CASE WHEN _sort = 'newest' THEN i.last_seen END DESC NULLS LAST,
    CASE WHEN _sort = 'oldest' THEN i.first_seen END ASC NULLS LAST,
    CASE WHEN _sort = 'ads' THEN i.total_ads END DESC,
    CASE WHEN _sort = 'active_ads' THEN i.active_ads END DESC,
    CASE WHEN _sort = 'products' THEN i.products END DESC,
    CASE WHEN _sort = 'text' THEN i.display_text END COLLATE "ar-x-icu" ASC,
    i.id) AS pos
  FROM items i
  WHERE coalesce(_search,'') = '' OR strpos(lower(i.display_text), lower(_search)) > 0 OR strpos(lower(i.description), lower(_search)) > 0
),
cnt AS (SELECT count(*) AS total FROM filtered),
bounds AS (
  SELECT total, (least(greatest(coalesce(_page,1),1), greatest(1, ceil(total::numeric / _limit)::int)) - 1) * _limit AS start FROM cnt
)
SELECT jsonb_build_object(
  'total', (SELECT total FROM cnt), 'allTotal', (SELECT count(*) FROM items),
  'items', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'kind', f.kind, 'text', f.display_text, 'key', f.normalized_key, 'description', f.description,
      'totalAds', f.total_ads, 'activeAds', f.active_ads, 'stoppedAds', f.stopped_ads,
      'products', f.products, 'competitors', f.competitors, 'firstSeen', f.first_seen, 'lastSeen', f.last_seen
    ) ORDER BY f.pos)
    FROM filtered f, bounds b WHERE f.pos > b.start AND f.pos <= b.start + _limit
  ), '[]'::jsonb)
)
$function$;