ALTER TABLE public.ai_provider_sync_runs
  ADD COLUMN IF NOT EXISTS period_start timestamptz,
  ADD COLUMN IF NOT EXISTS period_end timestamptz,
  ADD COLUMN IF NOT EXISTS input_tokens bigint,
  ADD COLUMN IF NOT EXISTS output_tokens bigint,
  ADD COLUMN IF NOT EXISTS input_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS output_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS other_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS cost_input_usd_per_million numeric,
  ADD COLUMN IF NOT EXISTS cost_output_usd_per_million numeric,
  ADD COLUMN IF NOT EXISTS price_id uuid;

-- سلسلة سعر ديناميكي واحدة لكل مزوّد، غير مرتبطة بأي اسم نموذج.
INSERT INTO public.ai_models (provider_id, model_code, display_name, is_active, is_default)
SELECT id, '__provider_actual__', 'التكلفة الفعلية للمزوّد (كل النماذج)', true, false
FROM public.ai_providers WHERE code = 'openai'
ON CONFLICT (provider_id, model_code) DO NOTHING;

-- بذرة أولى حتى أول مزامنة ناجحة: نسخ آخر سعر ساري حتى لا تتوقف العمليات.
INSERT INTO public.ai_model_prices (model_id, cost_input_usd_per_million, cost_output_usd_per_million, margin_percent, usd_to_egp, sell_input_egp_per_million, sell_output_egp_per_million, source)
SELECT m.id, p.cost_input_usd_per_million, p.cost_output_usd_per_million, p.margin_percent, p.usd_to_egp, p.sell_input_egp_per_million, p.sell_output_egp_per_million, 'seed'
FROM public.ai_models m
JOIN public.ai_providers pr ON pr.id = m.provider_id AND pr.code = 'openai'
CROSS JOIN LATERAL (
  SELECT * FROM public.ai_model_prices WHERE effective_to IS NULL ORDER BY effective_from DESC LIMIT 1
) p
WHERE m.model_code = '__provider_actual__'
  AND NOT EXISTS (SELECT 1 FROM public.ai_model_prices x WHERE x.model_id = m.id);