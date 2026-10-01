create table public.pb_test_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  label text not null,
  ad_ids uuid[] not null,
  status text not null default 'prepared',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.pb_test_runs to authenticated;
grant all on public.pb_test_runs to service_role;
alter table public.pb_test_runs enable row level security;
create policy "owner reads test runs" on public.pb_test_runs for select to authenticated using (owner_id = auth.uid());

create table public.pb_test_run_ads (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pb_test_runs(id) on delete cascade,
  owner_id uuid not null,
  ad_id uuid not null,
  status text not null default 'pending',
  result jsonb,
  summary jsonb,
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, ad_id)
);
grant select on public.pb_test_run_ads to authenticated;
grant all on public.pb_test_run_ads to service_role;
alter table public.pb_test_run_ads enable row level security;
create policy "owner reads test run ads" on public.pb_test_run_ads for select to authenticated using (owner_id = auth.uid());

alter table public.pb_statements add column test_run_id uuid references public.pb_test_runs(id);
alter table public.ad_statements add column test_run_id uuid references public.pb_test_runs(id);
create index on public.pb_statements(test_run_id);
create index on public.ad_statements(test_run_id);