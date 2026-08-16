-- GFC V1 Phase 5B -- fixes a real regression caught by the non-régression
-- security test (test-security-rls.sql): earlier this phase,
-- get_commercial_sale_financial_summary needed DROP FUNCTION + CREATE
-- FUNCTION instead of CREATE OR REPLACE (Postgres refuses to change a
-- RETURNS TABLE(...) column set in place). DROP FUNCTION silently strips
-- every existing GRANT/REVOKE on that function -- the fresh CREATE landed
-- back on Postgres' own default privilege (EXECUTE granted to PUBLIC),
-- exposing this SECURITY DEFINER function to the anon role. Restores the
-- same lockdown every other SECURITY DEFINER function in this schema
-- already has.

REVOKE ALL ON FUNCTION public.get_commercial_sale_financial_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commercial_sale_financial_summary(uuid) TO authenticated;
