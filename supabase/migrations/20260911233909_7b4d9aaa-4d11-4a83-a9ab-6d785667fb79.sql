CREATE TABLE public.metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  data_source text NOT NULL,
  value_type text NOT NULL,
  condition_type text NOT NULL DEFAULT 'gte',
  default_target numeric,
  default_min numeric,
  default_max numeric,
  default_weight numeric NOT NULL DEFAULT 1,
  default_scoring_method text NOT NULL DEFAULT 'threshold_linear',
  higher_is_better boolean NOT NULL DEFAULT true,
  is_available boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  calculation_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.metrics TO authenticated;
GRANT ALL ON public.metrics TO service_role;
ALTER TABLE public.metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY metrics_select_all ON public.metrics FOR SELECT TO authenticated USING (true);
CREATE TRIGGER metrics_touch BEFORE UPDATE ON public.metrics FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

CREATE TABLE public.user_metric_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  metric_id uuid NOT NULL REFERENCES public.metrics(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  target_value numeric,
  minimum_value numeric,
  maximum_value numeric,
  weight numeric NOT NULL DEFAULT 1,
  scoring_method text NOT NULL DEFAULT 'threshold_linear',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, metric_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_metric_settings TO authenticated;
GRANT ALL ON public.user_metric_settings TO service_role;
ALTER TABLE public.user_metric_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ums_select_own ON public.user_metric_settings FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY ums_insert_own ON public.user_metric_settings FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY ums_update_own ON public.user_metric_settings FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY ums_delete_own ON public.user_metric_settings FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE TRIGGER user_metric_settings_touch BEFORE UPDATE ON public.user_metric_settings FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

INSERT INTO public.metrics (metric_key, name, description, data_source, value_type, condition_type, default_target, default_min, default_max, default_weight, default_scoring_method, higher_is_better, sort_order, calculation_definition) VALUES
('ad_longevity','استمرارية الإعلان','عدد الأيام التي ظل فيها المنتج نشطًا في الإعلانات، من تاريخ أول ظهور حتى آخر تاريخ نشاط.','ads','days','gte',60,NULL,NULL,1,'threshold_linear',true,1,'{"unit":"يوم"}'),
('current_spread','الانتشار الحالي','عدد الصفحات المختلفة التي تعلن عن المنتج حاليًا.','ads','count','gte',3,NULL,NULL,1,'threshold_linear',true,2,'{"unit":"صفحة"}'),
('historical_spread','الانتشار التاريخي','عدد الصفحات المختلفة التي أعلنت عن المنتج خلال الفترة الزمنية المرصودة.','ads','count','gte',5,NULL,NULL,1,'threshold_linear',true,3,'{"unit":"صفحة"}'),
('advertiser_growth','نمو المعلنين','معدل زيادة عدد الصفحات الجديدة التي بدأت الإعلان عن المنتج خلال فترة مقارنة بالفترة السابقة.','ads','percent','gte',15,NULL,NULL,1,'threshold_linear',true,4,'{"unit":"%","window_days":30}'),
('advertiser_retention','استمرارية المعلنين','نسبة الصفحات التي استمرت في الإعلان عن المنتج بعد مرور فترة محددة من بداية إعلانها.','ads','percent','gte',50,NULL,NULL,1,'threshold_linear',true,5,'{"unit":"%","retention_days":30}'),
('activity_strength','قوة النشاط الإعلاني','نسبة الإعلانات النشطة حاليًا إلى إجمالي الإعلانات التي تم رصدها للمنتج.','ads','percent','gte',50,NULL,NULL,1,'threshold_linear',true,6,'{"unit":"%"}'),
('demand_stability','ثبات الطلب','مدى استمرار ظهور نشاط إعلاني للمنتج عبر فترات زمنية متتابعة بدلًا من ظهوره في فترة قصيرة فقط.','ads','score','gte',60,NULL,NULL,1,'threshold_linear',true,7,'{"unit":"درجة","scale":100}'),
('seasonality','الموسمية','مدى تركّز نشاط المنتج في أشهر أو فترات زمنية محددة مقارنة بتوزيع نشاطه على مدار العام. الأفضل هو الأقل موسمية.','ads','percent','lte',40,NULL,NULL,1,'threshold_linear',false,8,'{"unit":"%"}');