ALTER TABLE public.discovery_terms ADD COLUMN IF NOT EXISTS removed_at timestamptz;
UPDATE public.discovery_terms SET removed_at = now() WHERE status = 'removed' AND removed_at IS NULL;