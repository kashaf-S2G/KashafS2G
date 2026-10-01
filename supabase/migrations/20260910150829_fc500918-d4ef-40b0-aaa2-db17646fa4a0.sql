
-- 1) mapping table: component -> phase/task
CREATE TABLE IF NOT EXISTS public.pc_component_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id uuid NOT NULL REFERENCES public.pc_phases(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.pc_tasks(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'any',
  kind text NOT NULL DEFAULT 'any',
  match_type text NOT NULL DEFAULT 'exact',
  pattern text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_component_map TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_component_map TO anon;
GRANT ALL ON public.pc_component_map TO service_role;
ALTER TABLE public.pc_component_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can manage pc_component_map" ON public.pc_component_map;
CREATE POLICY "Anyone can manage pc_component_map" ON public.pc_component_map
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS pc_component_map_touch ON public.pc_component_map;
CREATE TRIGGER pc_component_map_touch BEFORE UPDATE ON public.pc_component_map
  FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS pc_component_map_unique
  ON public.pc_component_map (source, kind, match_type, lower(pattern));

-- 2) database structure snapshot (for deterministic diffing)
CREATE TABLE IF NOT EXISTS public.pc_db_snapshot (
  object_kind text NOT NULL,
  object_key text NOT NULL,
  fingerprint text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object_kind, object_key)
);

GRANT SELECT ON public.pc_db_snapshot TO authenticated, anon;
GRANT ALL ON public.pc_db_snapshot TO service_role;
ALTER TABLE public.pc_db_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read pc_db_snapshot" ON public.pc_db_snapshot;
CREATE POLICY "Anyone can read pc_db_snapshot" ON public.pc_db_snapshot
  FOR SELECT TO anon, authenticated USING (true);

-- 3) extend pc_changes (additive only; existing rows preserved as 'manual')
CREATE SEQUENCE IF NOT EXISTS public.pc_change_ref_seq;

ALTER TABLE public.pc_changes
  ADD COLUMN IF NOT EXISTS change_ref text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS target_kind text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_ref text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS external_ref text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS external_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS matched_pattern text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS detected_at timestamptz NOT NULL DEFAULT now();

UPDATE public.pc_changes
SET change_ref = 'CHG-' || lpad(nextval('public.pc_change_ref_seq')::text, 6, '0')
WHERE change_ref IS NULL;

ALTER TABLE public.pc_changes
  ALTER COLUMN change_ref SET DEFAULT 'CHG-' || lpad(nextval('public.pc_change_ref_seq')::text, 6, '0');
ALTER TABLE public.pc_changes ALTER COLUMN change_ref SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pc_changes_change_ref_key ON public.pc_changes (change_ref);
CREATE UNIQUE INDEX IF NOT EXISTS pc_changes_external_unique
  ON public.pc_changes (source, external_ref, target_ref)
  WHERE source <> 'manual' AND external_ref <> '';
CREATE INDEX IF NOT EXISTS pc_changes_source_idx ON public.pc_changes (source, occurred_at DESC);

-- 4) resolver: component -> phase/task
CREATE OR REPLACE FUNCTION public.pc_resolve_component(_source text, _kind text, _target text)
RETURNS TABLE(phase_id uuid, task_id uuid, matched_pattern text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.phase_id, m.task_id, m.pattern
  FROM public.pc_component_map m
  WHERE (m.source = _source OR m.source = 'any')
    AND (m.kind = _kind OR m.kind = 'any')
    AND (
      (m.match_type = 'exact'  AND lower(_target) = lower(m.pattern))
      OR (m.match_type = 'prefix' AND lower(_target) LIKE lower(m.pattern) || '%')
      OR (m.match_type = 'glob'  AND lower(_target) LIKE lower(replace(m.pattern, '*', '%')))
    )
  ORDER BY m.priority ASC, length(m.pattern) DESC
  LIMIT 1;
$$;

-- 5) deterministic external change logger (no AI, no status mutation)
CREATE OR REPLACE FUNCTION public.pc_log_external_change(
  _source text,
  _kind text,
  _target text,
  _action_type text,
  _description text,
  _external_ref text DEFAULT '',
  _external_url text DEFAULT '',
  _previous_state text DEFAULT '',
  _new_state text DEFAULT '',
  _author text DEFAULT 'system:auto',
  _occurred_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  new_id uuid;
BEGIN
  IF _source NOT IN ('github', 'supabase') THEN
    RAISE EXCEPTION 'pc_log_external_change: unsupported source %', _source;
  END IF;

  SELECT * INTO r FROM public.pc_resolve_component(_source, _kind, _target);

  INSERT INTO public.pc_changes (
    phase_id, task_id, action_type, affected_component, description, reason,
    previous_state, new_state, status, author,
    source, target_kind, target_ref, external_ref, external_url, matched_pattern,
    occurred_at, detected_at
  ) VALUES (
    r.phase_id, r.task_id, _action_type, _target, _description,
    CASE WHEN r.phase_id IS NULL
      THEN 'تغيير مكتشف تلقائيًا بدون ربط مسبق بمرحلة'
      ELSE 'تغيير مكتشف تلقائيًا عبر خريطة الربط' END,
    _previous_state, _new_state,
    'in_progress', _author,
    _source, _kind, _target, COALESCE(_external_ref, ''), COALESCE(_external_url, ''),
    COALESCE(r.matched_pattern, ''), COALESCE(_occurred_at, now()), now()
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pc_log_external_change(text,text,text,text,text,text,text,text,text,text,timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pc_log_external_change(text,text,text,text,text,text,text,text,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.pc_resolve_component(text,text,text) TO anon, authenticated, service_role;

-- 6) Supabase structure scanner (snapshot diff, deterministic)
CREATE OR REPLACE FUNCTION public.pc_scan_supabase_changes(_baseline boolean DEFAULT false)
RETURNS TABLE(created integer, updated integer, deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c integer := 0;
  u integer := 0;
  d integer := 0;
  rec record;
BEGIN
  CREATE TEMP TABLE _pc_now (object_kind text, object_key text, fingerprint text, target text) ON COMMIT DROP;

  INSERT INTO _pc_now
  SELECT 'table', c2.relname,
         md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' ORDER BY a.attnum)),
         c2.relname
  FROM pg_class c2
  JOIN pg_namespace n ON n.oid = c2.relnamespace
  JOIN pg_attribute a ON a.attrelid = c2.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE n.nspname = 'public' AND c2.relkind IN ('r', 'p')
  GROUP BY c2.relname;

  INSERT INTO _pc_now
  SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(COALESCE(p.prosrc, '')), p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public';

  INSERT INTO _pc_now
  SELECT 'policy', pol.tablename || '.' || pol.policyname,
         md5(COALESCE(pol.cmd, '') || COALESCE(pol.qual, '') || COALESCE(pol.with_check, '') || COALESCE(array_to_string(pol.roles, ','), '')),
         pol.tablename
  FROM pg_policies pol
  WHERE pol.schemaname = 'public';

  IF NOT _baseline THEN
    FOR rec IN
      SELECT n.object_kind, n.object_key, n.target, s.fingerprint AS old_fp, n.fingerprint AS new_fp
      FROM _pc_now n LEFT JOIN public.pc_db_snapshot s
        ON s.object_kind = n.object_kind AND s.object_key = n.object_key
      WHERE s.fingerprint IS DISTINCT FROM n.fingerprint
    LOOP
      PERFORM public.pc_log_external_change(
        'supabase', rec.object_kind, rec.object_key,
        CASE
          WHEN rec.old_fp IS NULL AND rec.object_kind = 'table' THEN 'schema_create'
          WHEN rec.object_kind = 'table' THEN 'schema_update'
          WHEN rec.object_kind = 'policy' THEN 'rls_update'
          ELSE 'logic_change'
        END,
        CASE WHEN rec.old_fp IS NULL
          THEN 'إنشاء ' || rec.object_kind || ': ' || rec.object_key
          ELSE 'تعديل ' || rec.object_kind || ': ' || rec.object_key END,
        rec.new_fp, '', COALESCE(rec.old_fp, ''), rec.new_fp, 'system:supabase-scan', now()
      );
      IF rec.old_fp IS NULL THEN c := c + 1; ELSE u := u + 1; END IF;
    END LOOP;

    FOR rec IN
      SELECT s.object_kind, s.object_key, s.fingerprint AS old_fp
      FROM public.pc_db_snapshot s LEFT JOIN _pc_now n
        ON s.object_kind = n.object_kind AND s.object_key = n.object_key
      WHERE n.object_key IS NULL
    LOOP
      PERFORM public.pc_log_external_change(
        'supabase', rec.object_kind, rec.object_key, 'delete',
        'حذف ' || rec.object_kind || ': ' || rec.object_key,
        'deleted:' || rec.object_key, '', rec.old_fp, '', 'system:supabase-scan', now()
      );
      d := d + 1;
    END LOOP;
  END IF;

  DELETE FROM public.pc_db_snapshot s
  WHERE NOT EXISTS (
    SELECT 1 FROM _pc_now n WHERE n.object_kind = s.object_kind AND n.object_key = s.object_key
  );

  INSERT INTO public.pc_db_snapshot (object_kind, object_key, fingerprint, captured_at)
  SELECT object_kind, object_key, fingerprint, now() FROM _pc_now
  ON CONFLICT (object_kind, object_key)
  DO UPDATE SET fingerprint = EXCLUDED.fingerprint, captured_at = now();

  created := c; updated := u; deleted := d;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.pc_scan_supabase_changes(boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pc_scan_supabase_changes(boolean) TO service_role;

-- capture the initial baseline so the first real scan only reports genuine diffs
SELECT public.pc_scan_supabase_changes(true);
