CREATE TABLE public.pb_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('problem','benefit')),
  normalized_key text NOT NULL CHECK (normalized_key <> ''),
  display_text text NOT NULL,
  normalizer_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pb_statements_owner_kind_key UNIQUE (owner_id, kind, normalized_key),
  CONSTRAINT pb_statements_id_owner_key UNIQUE (id, owner_id)
);
GRANT SELECT ON public.pb_statements TO authenticated;
GRANT ALL ON public.pb_statements TO service_role;
ALTER TABLE public.pb_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY pb_statements_select_own ON public.pb_statements FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.ad_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  ad_id uuid NOT NULL REFERENCES public.ads(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('problem','benefit')),
  source text NOT NULL CHECK (source IN ('ad.problem_solved','product.problem_solved','ad.main_benefit')),
  raw_text text NOT NULL,
  normalized_key text NOT NULL,
  normalizer_version integer NOT NULL DEFAULT 1,
  analysis_version text,
  statement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_statements_owner_ad_source_key UNIQUE (owner_id, ad_id, source),
  CONSTRAINT ad_statements_kind_source_chk CHECK (
    (source = 'ad.main_benefit' AND kind = 'benefit') OR (source <> 'ad.main_benefit' AND kind = 'problem')),
  -- composite FK: a statement can only link to a pb_statement of the same owner
  CONSTRAINT ad_statements_statement_fk FOREIGN KEY (statement_id, owner_id)
    REFERENCES public.pb_statements(id, owner_id) ON DELETE SET NULL (statement_id)
);
CREATE INDEX ad_statements_ad_idx ON public.ad_statements(ad_id);
CREATE INDEX ad_statements_statement_idx ON public.ad_statements(statement_id);
CREATE INDEX ad_statements_owner_kind_key_idx ON public.ad_statements(owner_id, kind, normalized_key);
GRANT SELECT ON public.ad_statements TO authenticated;
GRANT ALL ON public.ad_statements TO service_role;
ALTER TABLE public.ad_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY ad_statements_select_own ON public.ad_statements FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE TRIGGER pb_statements_touch BEFORE UPDATE ON public.pb_statements FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();
CREATE TRIGGER ad_statements_touch BEFORE UPDATE ON public.ad_statements FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

-- Deterministic normalization v1 (no Arabic letter folding, no fuzzy matching)
CREATE OR REPLACE FUNCTION public.pb_normalize_v1(_s text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(_s,''), '[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]', '', 'g'),
          '\u0640', '', 'g'),
        '\s+', ' ', 'g'),
      '\s*([,.;:!?\u060C\u061B\u061F])\s*', '\1 ', 'g'),
    '[\s,.;:!?\u060C\u061B\u061F\u2026]+$', '', 'g')
  ) COLLATE "C"
$$;
CREATE OR REPLACE FUNCTION public.pb_normalize_key_v1(_s text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT translate(public.pb_normalize_v1(_s), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
$$;

-- Sync one ad's statements with its current analysis
CREATE OR REPLACE FUNCTION public.pb_sync_ad_statements(_ad_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a record; src record; k text; sid uuid;
BEGIN
  SELECT id, owner_id, analysis INTO a FROM ads WHERE id = _ad_id;
  IF NOT FOUND THEN RETURN; END IF;
  FOR src IN SELECT * FROM (VALUES
      ('ad.problem_solved','problem', a.analysis #>> '{ad,problem_solved}'),
      ('product.problem_solved','problem', a.analysis #>> '{product,problem_solved}'),
      ('ad.main_benefit','benefit', a.analysis #>> '{ad,main_benefit}')) v(source, kind, raw)
  LOOP
    k := CASE WHEN a.owner_id IS NULL THEN '' ELSE public.pb_normalize_key_v1(src.raw) END;
    IF k = '' THEN
      DELETE FROM ad_statements WHERE ad_id = a.id AND source = src.source;
      CONTINUE;
    END IF;
    INSERT INTO pb_statements(owner_id, kind, normalized_key, display_text, normalizer_version)
    VALUES (a.owner_id, src.kind, k, public.pb_normalize_v1(src.raw), 1)
    ON CONFLICT (owner_id, kind, normalized_key) DO UPDATE SET normalized_key = EXCLUDED.normalized_key
      WHERE false
    RETURNING id INTO sid;
    IF sid IS NULL THEN
      SELECT id INTO sid FROM pb_statements WHERE owner_id = a.owner_id AND kind = src.kind AND normalized_key = k;
    END IF;
    INSERT INTO ad_statements(owner_id, ad_id, kind, source, raw_text, normalized_key, normalizer_version, analysis_version, statement_id)
    VALUES (a.owner_id, a.id, src.kind, src.source, src.raw, k, 1, a.analysis->>'version', sid)
    ON CONFLICT (owner_id, ad_id, source) DO UPDATE SET
      raw_text = EXCLUDED.raw_text, normalized_key = EXCLUDED.normalized_key,
      normalizer_version = EXCLUDED.normalizer_version, analysis_version = EXCLUDED.analysis_version,
      statement_id = EXCLUDED.statement_id
    WHERE (ad_statements.raw_text, ad_statements.normalized_key, ad_statements.analysis_version, ad_statements.statement_id)
      IS DISTINCT FROM (EXCLUDED.raw_text, EXCLUDED.normalized_key, EXCLUDED.analysis_version, EXCLUDED.statement_id);
  END LOOP;
  -- rows left from an older owner (should not happen) are removed so data reflects current state
  DELETE FROM ad_statements WHERE ad_id = a.id AND owner_id IS DISTINCT FROM a.owner_id;
END; $$;
REVOKE ALL ON FUNCTION public.pb_sync_ad_statements(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ads_sync_pb_statements()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.pb_sync_ad_statements(NEW.id);
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.ads_sync_pb_statements() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ads_sync_pb_statements AFTER INSERT OR UPDATE OF analysis, owner_id ON public.ads
FOR EACH ROW EXECUTE FUNCTION public.ads_sync_pb_statements();

-- Backfill (idempotent)
SELECT public.pb_sync_ad_statements(id) FROM public.ads WHERE analysis IS NOT NULL;