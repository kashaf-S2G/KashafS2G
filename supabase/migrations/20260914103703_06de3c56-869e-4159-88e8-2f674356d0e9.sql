ALTER TABLE public.ai_pricing_settings
  ADD COLUMN IF NOT EXISTS openai_credit_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS openai_credit_since timestamptz;