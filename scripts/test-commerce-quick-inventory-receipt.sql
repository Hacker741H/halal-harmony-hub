-- CM-08 regression checks. This test is transaction scoped and writes no data.
BEGIN;

DO $test$
DECLARE
  v_function regprocedure := 'public.receive_commerce_inventory_item(jsonb)'::regprocedure;
  v_catalogue_function regprocedure := 'public.get_commerce_inventory_catalogue(uuid)'::regprocedure;
  v_allocation_function regprocedure := 'public.configure_commerce_location_item(jsonb)'::regprocedure;
  v_is_security_definer boolean;
  v_search_path text[];
  v_catalogue_definition text;
  v_allocation_definition text;
BEGIN
  SELECT procedure.prosecdef, procedure.proconfig
  INTO v_is_security_definer, v_search_path
  FROM pg_proc procedure
  WHERE procedure.oid = v_function;

  IF NOT v_is_security_definer THEN
    RAISE EXCEPTION 'La reception Commerce doit etre executee de maniere transactionnelle et securisee.';
  END IF;

  IF v_search_path IS NULL
    OR NOT EXISTS (SELECT 1 FROM unnest(v_search_path) AS setting WHERE setting = 'search_path=public, auth, pg_temp') THEN
    RAISE EXCEPTION 'La RPC de reception Commerce doit fixer un search_path securise.';
  END IF;

  IF has_function_privilege('anon', v_function, 'EXECUTE')
    OR has_function_privilege('public', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'La reception Commerce ne doit jamais etre accessible a anon ou PUBLIC.';
  END IF;

  IF NOT has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'Les utilisateurs authentifies autorises doivent pouvoir appeler la RPC Commerce.';
  END IF;

  SELECT pg_get_functiondef(v_catalogue_function), pg_get_functiondef(v_allocation_function)
  INTO v_catalogue_definition, v_allocation_definition;

  IF position('is_active' IN v_catalogue_definition) > 0
    OR position('is_active' IN v_allocation_definition) > 0 THEN
    RAISE EXCEPTION 'Le catalogue Commerce ne doit pas referencer une colonne is_active absente de inventory_items.';
  END IF;

  IF has_function_privilege('anon', v_catalogue_function, 'EXECUTE')
    OR has_function_privilege('public', v_catalogue_function, 'EXECUTE')
    OR has_function_privilege('anon', v_allocation_function, 'EXECUTE')
    OR has_function_privilege('public', v_allocation_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'Les RPC de catalogue et de mise en rayon ne doivent pas etre accessibles a anon ou PUBLIC.';
  END IF;
END;
$test$;

ROLLBACK;
