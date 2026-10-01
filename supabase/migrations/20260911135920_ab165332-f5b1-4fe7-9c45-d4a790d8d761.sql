-- 1) pc_* tables: authenticated-only access, no anon
DROP POLICY IF EXISTS "Anyone can manage pc_changes" ON public.pc_changes;
DROP POLICY IF EXISTS "Anyone can manage pc_component_map" ON public.pc_component_map;
DROP POLICY IF EXISTS "Anyone can manage pc_decisions" ON public.pc_decisions;
DROP POLICY IF EXISTS "Anyone can manage pc_issues" ON public.pc_issues;
DROP POLICY IF EXISTS "Anyone can manage pc_phases" ON public.pc_phases;
DROP POLICY IF EXISTS "Anyone can manage pc_tasks" ON public.pc_tasks;
DROP POLICY IF EXISTS "Anyone can read pc_db_snapshot" ON public.pc_db_snapshot;

REVOKE ALL ON public.pc_changes FROM anon;
REVOKE ALL ON public.pc_component_map FROM anon;
REVOKE ALL ON public.pc_decisions FROM anon;
REVOKE ALL ON public.pc_issues FROM anon;
REVOKE ALL ON public.pc_phases FROM anon;
REVOKE ALL ON public.pc_tasks FROM anon;
REVOKE ALL ON public.pc_db_snapshot FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_changes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_component_map TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_decisions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_issues TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_phases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_tasks TO authenticated;
GRANT ALL ON public.pc_changes TO service_role;
GRANT ALL ON public.pc_component_map TO service_role;
GRANT ALL ON public.pc_decisions TO service_role;
GRANT ALL ON public.pc_issues TO service_role;
GRANT ALL ON public.pc_phases TO service_role;
GRANT ALL ON public.pc_tasks TO service_role;
GRANT ALL ON public.pc_db_snapshot TO service_role;

CREATE POLICY "pc_changes_authenticated_manage" ON public.pc_changes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "pc_component_map_authenticated_manage" ON public.pc_component_map
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "pc_decisions_authenticated_manage" ON public.pc_decisions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "pc_issues_authenticated_manage" ON public.pc_issues
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "pc_phases_authenticated_manage" ON public.pc_phases
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "pc_tasks_authenticated_manage" ON public.pc_tasks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2) SECURITY DEFINER internal functions: server-side (service_role) only
REVOKE ALL ON FUNCTION public.pc_log_external_change(text, text, text, text, text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pc_resolve_component(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pc_scan_supabase_changes(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pc_log_external_change(text, text, text, text, text, text, text, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.pc_resolve_component(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pc_scan_supabase_changes(boolean) TO service_role;

-- claim_legacy_records stays callable by signed-in users: it verifies auth.uid()
-- is the primary account and raises otherwise.
REVOKE ALL ON FUNCTION public.claim_legacy_records() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_legacy_records() TO authenticated, service_role;