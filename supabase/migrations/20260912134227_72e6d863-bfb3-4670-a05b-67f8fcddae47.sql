ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS products_owner_updated_idx
  ON public.products (owner_id, updated_at DESC);