UPDATE public.metrics SET default_scoring_method = 'binary';

UPDATE public.user_metric_settings SET scoring_method = 'binary';

WITH avail AS (
  SELECT count(*)::numeric AS n FROM public.metrics WHERE is_available AND is_active
)
UPDATE public.metrics m
SET default_weight = CASE WHEN m.is_available AND m.is_active AND (SELECT n FROM avail) > 0
  THEN round(100 / (SELECT n FROM avail), 2) ELSE 0 END;

UPDATE public.metrics
SET description = 'عدد الأشهر التي ظهر فيها للمنتج نشاط إعلاني خلال آخر 12 شهرًا ÷ 12 × 100.',
    calculation_definition = coalesce(calculation_definition, '{}'::jsonb) || '{"window_months": 12, "unit": "%"}'::jsonb,
    value_type = 'percent'
WHERE metric_key = 'demand_stability';

UPDATE public.metrics
SET description = 'أكبر نسبة نشاط إعلاني في شهر واحد ÷ إجمالي النشاط خلال آخر 12 شهرًا × 100. كلما انخفضت النسبة كان المنتج أقل موسمية.',
    calculation_definition = coalesce(calculation_definition, '{}'::jsonb) || '{"window_months": 12, "unit": "%"}'::jsonb,
    value_type = 'percent'
WHERE metric_key = 'seasonality';

UPDATE public.metrics
SET description = 'نسبة الصفحات التي استمرت في الإعلان عن المنتج 30 يومًا على الأقل من تاريخ أول ظهور.'
WHERE metric_key = 'advertiser_retention';

UPDATE public.metrics
SET description = 'معدل زيادة الصفحات الجديدة التي بدأت الإعلان عن المنتج خلال آخر 30 يومًا مقارنة بالـ30 يومًا السابقة مباشرة.'
WHERE metric_key = 'advertiser_growth';