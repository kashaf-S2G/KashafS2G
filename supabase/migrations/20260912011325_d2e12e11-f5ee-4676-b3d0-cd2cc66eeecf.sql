alter table public.discovery_runs add column if not exists term_filter uuid[];

comment on column public.discovery_runs.term_filter is 'عند التعبئة: يقتصر التشغيل اليدوي على عناصر البنك (مصطلحات/فئات) المحددة فقط.';