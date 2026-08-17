-- Security fix: newly-created functions default to EXECUTE granted to
-- PUBLIC in Postgres unless explicitly revoked. The two aggregate RPCs
-- added in 20260822170000 were missed -- caught immediately by
-- scripts/test-security-rls.sql ("Fonctions SECURITY DEFINER accessibles a
-- anon"), which re-ran clean before this fix and failed after, exactly as
-- that regression test is designed to catch. Both functions already
-- self-check auth.uid()/permission_require() internally, so this was not
-- an actual data-exposure path, but every other SECURITY DEFINER function
-- in this schema is locked down the same way as defense in depth, and
-- these two must match.

REVOKE ALL ON FUNCTION public.get_finance_operation_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_finance_operation_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_finance_operation_stats() TO authenticated;

REVOKE ALL ON FUNCTION public.get_notification_summary_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_notification_summary_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_notification_summary_counts() TO authenticated;
