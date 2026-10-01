CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- بنك المصطلحات وفئات الصفحات
CREATE TABLE public.discovery_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  kind text NOT NULL DEFAULT 'term',          -- term | category
  term text NOT NULL,
  term_key text NOT NULL,
  source text NOT NULL DEFAULT 'manual',      -- manual | product_name | description | category
  status text NOT NULL DEFAULT 'active',      -- active | deleted
  hits integer NOT NULL DEFAULT 0,
  last_searched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, kind, term_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovery_terms TO authenticated;
GRANT ALL ON public.discovery_terms TO service_role;
ALTER TABLE public.discovery_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY discovery_terms_select_own ON public.discovery_terms FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY discovery_terms_insert_own ON public.discovery_terms FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY discovery_terms_update_own ON public.discovery_terms FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY discovery_terms_delete_own ON public.discovery_terms FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE TRIGGER discovery_terms_touch BEFORE UPDATE ON public.discovery_terms FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

-- الصفحات المكتشفة
CREATE TABLE public.discovered_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  platform text NOT NULL DEFAULT 'Facebook',
  source_page_id text NOT NULL,
  page_name text NOT NULL,
  page_url text NOT NULL,
  fb_categories text[] NOT NULL DEFAULT '{}',
  likes integer,
  active_ads integer NOT NULL DEFAULT 0,
  ads_sample text,
  posts_sample text,
  matched_terms text[] NOT NULL DEFAULT '{}',
  category text,
  confidence numeric,
  classification text NOT NULL DEFAULT 'pending', -- pending | matched | unmatched
  classification_note text,
  times_seen integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  classified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, platform, source_page_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovered_pages TO authenticated;
GRANT ALL ON public.discovered_pages TO service_role;
ALTER TABLE public.discovered_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY discovered_pages_select_own ON public.discovered_pages FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY discovered_pages_insert_own ON public.discovered_pages FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY discovered_pages_update_own ON public.discovered_pages FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY discovered_pages_delete_own ON public.discovered_pages FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE TRIGGER discovered_pages_touch BEFORE UPDATE ON public.discovered_pages FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();
CREATE INDEX discovered_pages_pending_idx ON public.discovered_pages (owner_id, classification, last_seen_at);

-- عمليات البحث
CREATE TABLE public.discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  status text NOT NULL DEFAULT 'running', -- running | done | paused | failed
  trigger_type text NOT NULL DEFAULT 'manual',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  lease_expires_at timestamptz,
  terms_searched integer NOT NULL DEFAULT 0,
  pages_found integer NOT NULL DEFAULT 0,
  pages_new integer NOT NULL DEFAULT 0,
  pages_classified integer NOT NULL DEFAULT 0,
  pages_matched integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovery_runs TO authenticated;
GRANT ALL ON public.discovery_runs TO service_role;
ALTER TABLE public.discovery_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY discovery_runs_select_own ON public.discovery_runs FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY discovery_runs_insert_own ON public.discovery_runs FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY discovery_runs_update_own ON public.discovery_runs FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY discovery_runs_delete_own ON public.discovery_runs FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE UNIQUE INDEX discovery_runs_single_running ON public.discovery_runs (owner_id) WHERE status = 'running';

-- حالة التقدّم لكل مستخدم
CREATE TABLE public.discovery_state (
  owner_id uuid PRIMARY KEY DEFAULT auth.uid(),
  status text NOT NULL DEFAULT 'active', -- active | paused
  paused_reason text,
  paused_at timestamptz,
  cursor_key text NOT NULL DEFAULT '',
  cycles integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  last_bank_built_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovery_state TO authenticated;
GRANT ALL ON public.discovery_state TO service_role;
ALTER TABLE public.discovery_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY discovery_state_select_own ON public.discovery_state FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY discovery_state_insert_own ON public.discovery_state FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY discovery_state_update_own ON public.discovery_state FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY discovery_state_delete_own ON public.discovery_state FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE TRIGGER discovery_state_touch BEFORE UPDATE ON public.discovery_state FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

-- حجز عملية بحث واحدة لكل مستخدم (للمستخدم نفسه أو للخدمة المجدولة)
CREATE OR REPLACE FUNCTION public.acquire_discovery_run(_owner_id uuid, _trigger_type text DEFAULT 'manual')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT (auth.role() = 'service_role' OR auth.uid() = _owner_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.discovery_runs
     SET status = 'failed', finished_at = now(), error = 'انتهت مهلة العملية السابقة.'
   WHERE owner_id = _owner_id AND status = 'running' AND lease_expires_at < now();
  INSERT INTO public.discovery_runs(owner_id, status, trigger_type, lease_expires_at)
  VALUES (_owner_id, 'running', _trigger_type, now() + interval '10 minutes')
  RETURNING id INTO new_id;
  RETURN new_id;
EXCEPTION WHEN unique_violation THEN
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.acquire_discovery_run(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acquire_discovery_run(uuid, text) TO authenticated, service_role;

-- رمز التحقق للمجدول: يُحفظ في الخزنة ويُقرأ من الخادم فقط
SELECT vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'discovery_cron_token', 'Token used by pg_cron to call the discovery endpoint');

CREATE OR REPLACE FUNCTION public.get_discovery_cron_token()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'discovery_cron_token' LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_discovery_cron_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_discovery_cron_token() TO service_role;

-- تشغيل البحث كل 3 ساعات
SELECT cron.schedule(
  'discovery-every-3h',
  '0 */3 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--6766c3b8-ad38-4744-a2b3-950d88671a9f.lovable.app/api/public/discovery/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-discovery-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'discovery_cron_token' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);