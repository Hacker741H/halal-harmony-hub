-- POS-03B regression checks. This script is transaction-scoped and read-only:
-- it never creates a sale, stock movement, finance operation or wallet entry.
BEGIN;

DO $test$
DECLARE
  v_function_definition text;
  v_line_type_not_null boolean;
  v_service_note_exists boolean;
BEGIN
  SELECT attribute.attnotnull
  INTO v_line_type_not_null
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.commercial_sale_lines'::regclass
    AND attribute.attname = 'line_type'
    AND NOT attribute.attisdropped;

  SELECT EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.commercial_sale_lines'::regclass
      AND attribute.attname = 'service_note'
      AND NOT attribute.attisdropped
  ) INTO v_service_note_exists;

  IF NOT coalesce(v_line_type_not_null, false) OR NOT v_service_note_exists THEN
    RAISE EXCEPTION 'POS services schema missing: line_type and service_note are required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.commercial_sale_lines'::regclass
      AND conname = 'commercial_sale_lines_line_type_check'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.commercial_sale_lines'::regclass
      AND conname = 'commercial_sale_lines_service_source_check'
  ) THEN
    RAISE EXCEPTION 'POS services constraints are missing.';
  END IF;

  SELECT pg_get_functiondef('public.create_commerce_cash_sale(jsonb)'::regprocedure)
  INTO v_function_definition;

  IF position('v_line_type = ''SERVICE''' IN v_function_definition) = 0
    OR position('service_note' IN v_function_definition) = 0
    OR position('line_type, description, quantity, unit, unit_price, line_total, service_note' IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'The POS sale RPC does not persist service lines explicitly.';
  END IF;

  IF position('ELSIF v_line_type = ''SERVICE''' IN v_function_definition) = 0
    OR position('IF v_line_type = ''ARTICLE'' THEN' IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'The POS sale RPC does not separate ARTICLE and SERVICE flows.';
  END IF;

  IF has_function_privilege('anon', 'public.create_commerce_cash_sale(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous users must not execute POS checkout.';
  END IF;
END;
$test$;

ROLLBACK;
