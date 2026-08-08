-- Préproduction : aucune fonction SECURITY DEFINER publique ne doit être
-- invoquable sans session. Les droits explicitement accordés à authenticated
-- et service_role sont conservés.
DO $revoke_anonymous_security_definer_execution$
DECLARE
  function_record record;
BEGIN
  FOR function_record IN
    SELECT procedure.oid::regprocedure AS identity
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prosecdef
      AND has_function_privilege('anon', procedure.oid, 'EXECUTE')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',
      function_record.identity
    );
  END LOOP;
END;
$revoke_anonymous_security_definer_execution$;
