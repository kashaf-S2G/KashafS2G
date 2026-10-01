DROP TRIGGER IF EXISTS ads_sync_pb_statements ON public.ads;
DROP FUNCTION IF EXISTS public.ads_sync_pb_statements();
DROP FUNCTION IF EXISTS public.pb_sync_ad_statements(uuid);

ALTER TABLE public.pb_statements ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

ALTER TABLE public.ad_statements DROP CONSTRAINT IF EXISTS ad_statements_source_check;
ALTER TABLE public.ad_statements DROP CONSTRAINT IF EXISTS ad_statements_kind_source_chk;
ALTER TABLE public.ad_statements DROP CONSTRAINT IF EXISTS ad_statements_owner_ad_source_key;
ALTER TABLE public.ad_statements ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE public.ad_statements ADD COLUMN IF NOT EXISTS evidence text NOT NULL DEFAULT '';
ALTER TABLE public.ad_statements ADD COLUMN IF NOT EXISTS confidence numeric;
ALTER TABLE public.ad_statements ADD CONSTRAINT ad_statements_source_check CHECK (source = 'pb_ai');
CREATE UNIQUE INDEX IF NOT EXISTS ad_statements_ad_statement_key ON public.ad_statements (ad_id, statement_id);

ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS pb_status text;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS pb_result jsonb;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS pb_processed_at timestamptz;
ALTER TABLE public.ads ADD CONSTRAINT ads_pb_status_check CHECK (pb_status IS NULL OR pb_status IN ('excluded','done','failed'));
CREATE INDEX IF NOT EXISTS ads_pb_pending_idx ON public.ads (owner_id, created_at) WHERE pb_status IS NULL AND analysis IS NOT NULL;