-- CM-03 schema and security regression checks.  The test is read-only and
-- transaction-scoped: it leaves no Commerce or financial test data behind.
BEGIN;

DO $test$
DECLARE
  v_cashier_permissions integer;
  v_forbidden_finance boolean;
  v_sales_client_required boolean;
  v_invoices_client_required boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'L’activité COMMERCE n’est pas disponible.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role')
    OR NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::public.app_role)) AS role_value WHERE role_value::text = 'caissier') THEN
    RAISE EXCEPTION 'Le rôle caissier est absent.';
  END IF;
  SELECT count(*) INTO v_cashier_permissions
  FROM public.role_permissions
  WHERE role = 'caissier'
    AND permission_code IN ('commerce.pos.read', 'commerce.pos.sell', 'commerce.stock.read', 'commerce.cash.read', 'commerce.cash.close');
  IF v_cashier_permissions <> 5 THEN
    RAISE EXCEPTION 'Les permissions de caisse sont incomplètes (% sur 5).', v_cashier_permissions;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.role_permissions WHERE role = 'caissier' AND permission_code IN ('finance.create', 'finance.update', 'finance.cancel')
  ) INTO v_forbidden_finance;
  IF v_forbidden_finance THEN
    RAISE EXCEPTION 'Le rôle caissier ne doit pas obtenir une permission Finance générique.';
  END IF;

  SELECT attribute.attnotnull
  INTO v_sales_client_required
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.commercial_sales'::regclass
    AND attribute.attname = 'client_id'
    AND NOT attribute.attisdropped;

  SELECT attribute.attnotnull
  INTO v_invoices_client_required
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.commercial_invoices'::regclass
    AND attribute.attname = 'client_id'
    AND NOT attribute.attisdropped;

  IF v_sales_client_required OR v_invoices_client_required THEN
    RAISE EXCEPTION 'Les ventes comptoir doivent pouvoir être facturées sans client nominatif.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_commerce_cash_sale')
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_commerce_pos_workspace')
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_commerce_inventory_catalogue')
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_commerce_management_dashboard')
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'configure_commerce_location_item')
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_commerce_location')
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_commerce_location_assignments')
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'end_commerce_location_assignment') THEN
    RAISE EXCEPTION 'Les RPC Commerce POS requises sont absentes.';
  END IF;

  IF has_function_privilege('anon', 'public.update_commerce_location(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'La gestion d''un magasin ne doit jamais être accessible à anon.';
  END IF;
  IF has_function_privilege('anon', 'public.get_commerce_location_assignments(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.end_commerce_location_assignment(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Les affectations Commerce ne doivent jamais etre accessibles a anon.';
  END IF;
  IF has_function_privilege('anon', 'public.get_commerce_management_dashboard(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Le pilotage Commerce ne doit jamais etre accessible a anon.';
  END IF;
END;
$test$;

ROLLBACK;
