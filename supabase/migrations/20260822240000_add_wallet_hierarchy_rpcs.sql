-- Sections 5, 7, 15, 45 : lecture consolidee (UX Wallets) + reaffectation
-- controlee + archivage. Reaffectation : ne touche que wallets.module/
-- asset_kind/*_id -- finance_operations garde son wallet_id d'origine,
-- l'historique reste rattache a son contexte d'epoque (section 5, "une
-- reaffectation ne vaut que pour les operations futures").

INSERT INTO public.permissions (code, module, action, description, sensitivity)
VALUES ('wallets.hierarchy.manage', 'wallets', 'hierarchy.manage', 'Réaffecter ou archiver un sous-wallet de la hiérarchie Finance V2.', 'CRITICAL')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_code)
VALUES
  ('gestionnaire', 'wallets.read'),
  ('super_admin', 'wallets.hierarchy.manage'),
  ('admin', 'wallets.hierarchy.manage'),
  ('gestionnaire', 'wallets.hierarchy.manage')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public._internal_require_wallet_read()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_any_permission(ARRAY['wallets.read', 'wallets.manage']::text[]) THEN
    RAISE EXCEPTION 'Vous n''avez pas la permission de consulter les wallets.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public._internal_require_wallet_hierarchy_manage()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_any_permission(ARRAY['wallets.hierarchy.manage', 'wallets.manage']::text[]) THEN
    RAISE EXCEPTION 'Vous n''avez pas la permission de réaffecter ou archiver un wallet.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._internal_require_wallet_read() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._internal_require_wallet_read() FROM anon;
REVOKE ALL ON FUNCTION public._internal_require_wallet_hierarchy_manage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._internal_require_wallet_hierarchy_manage() FROM anon;

-- Vue module : solde consolide = SUM(balance) des sous-wallets non archives,
-- jamais un solde stocke a part (section 3, pas de double solde).
CREATE OR REPLACE FUNCTION public.get_wallet_modules_summary()
 RETURNS TABLE(module text, consolidated_balance numeric, incoming_total numeric, expense_total numeric, sub_wallet_count bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._internal_require_wallet_read();
  RETURN QUERY
  SELECT
    w.module,
    COALESCE(SUM(w.balance), 0),
    COALESCE(SUM(r.incoming_total), 0),
    COALESCE(SUM(r.expense_total), 0),
    count(*)::bigint
  FROM public.wallets w
  LEFT JOIN public.finance_wallet_reconciliation r ON r.wallet_id = w.id
  WHERE w.module IS NOT NULL AND NOT w.is_archived
  GROUP BY w.module
  ORDER BY w.module;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_wallet_module_detail(p_module text)
 RETURNS TABLE(
   wallet_id uuid, name text, asset_kind text, is_general boolean, is_archived boolean,
   balance numeric, incoming_total numeric, expense_total numeric,
   motorcycle_id uuid, vehicle_id uuid, farm_id uuid
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._internal_require_wallet_read();
  RETURN QUERY
  SELECT
    w.id, w.name, w.asset_kind, w.is_general, w.is_archived,
    w.balance, COALESCE(r.incoming_total, 0), COALESCE(r.expense_total, 0),
    w.motorcycle_id, w.vehicle_id, w.farm_id
  FROM public.wallets w
  LEFT JOIN public.finance_wallet_reconciliation r ON r.wallet_id = w.id
  WHERE w.module = p_module
  ORDER BY w.is_general, w.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reassign_wallet_asset(
  p_wallet_id uuid,
  p_new_module text,
  p_new_asset_kind text,
  p_motorcycle_id uuid DEFAULT NULL,
  p_vehicle_id uuid DEFAULT NULL,
  p_farm_id uuid DEFAULT NULL
)
 RETURNS public.wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_wallet public.wallets;
BEGIN
  PERFORM public._internal_require_wallet_hierarchy_manage();

  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = p_wallet_id) THEN
    RAISE EXCEPTION 'Wallet introuvable.' USING ERRCODE = '23503';
  END IF;

  UPDATE public.wallets
  SET module = p_new_module,
      asset_kind = p_new_asset_kind,
      motorcycle_id = p_motorcycle_id,
      vehicle_id = p_vehicle_id,
      farm_id = p_farm_id,
      is_general = false,
      updated_at = now()
  WHERE id = p_wallet_id
  RETURNING * INTO v_wallet;

  INSERT INTO public.business_finance_audit(source_type, source_id, action, before_value, after_value, performed_by)
  VALUES ('wallet', p_wallet_id, 'REASSIGN', NULL, to_jsonb(v_wallet), auth.uid());

  RETURN v_wallet;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_wallet(p_wallet_id uuid, p_archived boolean DEFAULT true)
 RETURNS public.wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_wallet public.wallets;
BEGIN
  PERFORM public._internal_require_wallet_hierarchy_manage();

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet introuvable.' USING ERRCODE = '23503';
  END IF;
  IF v_wallet.is_general THEN
    RAISE EXCEPTION 'Le sous-wallet "Général" d''un module ne peut pas être archivé.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.wallets
  SET is_archived = p_archived,
      archived_at = CASE WHEN p_archived THEN now() ELSE NULL END
  WHERE id = p_wallet_id
  RETURNING * INTO v_wallet;

  RETURN v_wallet;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_wallet_modules_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_wallet_modules_summary() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_wallet_modules_summary() TO authenticated;

REVOKE ALL ON FUNCTION public.get_wallet_module_detail(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_wallet_module_detail(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_wallet_module_detail(text) TO authenticated;

REVOKE ALL ON FUNCTION public.reassign_wallet_asset(uuid, text, text, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reassign_wallet_asset(uuid, text, text, uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reassign_wallet_asset(uuid, text, text, uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.archive_wallet(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_wallet(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_wallet(uuid, boolean) TO authenticated;

-- Section 15 : bloquer les nouvelles operations sur un wallet archive, sauf
-- action administrative explicite (reactiver via archive_wallet(id, false)).
CREATE OR REPLACE FUNCTION public.finance_create_operation(p_operation jsonb, p_link_module text DEFAULT NULL::text, p_link_record_id uuid DEFAULT NULL::uuid)
 RETURNS finance_operations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_operation public.finance_operations;
  v_type text := upper(trim(COALESCE(p_operation ->> 'type', '')));
  v_wallet_id uuid := NULLIF(p_operation ->> 'wallet_id', '')::uuid;
  v_destination_wallet_id uuid := NULLIF(p_operation ->> 'destination_wallet_id', '')::uuid;
  v_amount numeric(14, 2) := NULLIF(p_operation ->> 'amount', '')::numeric;
  v_source_balance numeric(14, 2);
BEGIN
  PERFORM public.finance_require_write_role();

  IF v_type NOT IN ('REVENUE', 'EXPENSE', 'DEPOSIT', 'TRANSFER') THEN
    RAISE EXCEPTION 'Type financier invalide : %', v_type USING ERRCODE = '22023';
  END IF;

  IF v_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Le wallet source est obligatoire et doit exister.' USING ERRCODE = '23503';
  END IF;

  IF EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id AND is_archived) THEN
    RAISE EXCEPTION 'Ce wallet est archivé : réactivez-le avant d''y enregistrer une opération.' USING ERRCODE = '22023';
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être strictement positif.' USING ERRCODE = '22023';
  END IF;

  IF v_type = 'TRANSFER' THEN
    IF v_destination_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_destination_wallet_id) THEN
      RAISE EXCEPTION 'Le wallet destination est obligatoire pour un transfert.' USING ERRCODE = '23503';
    END IF;
    IF EXISTS (SELECT 1 FROM public.wallets WHERE id = v_destination_wallet_id AND is_archived) THEN
      RAISE EXCEPTION 'Le wallet destination est archivé.' USING ERRCODE = '22023';
    END IF;
    IF v_wallet_id = v_destination_wallet_id THEN
      RAISE EXCEPTION 'Les wallets source et destination doivent être différents.' USING ERRCODE = '22023';
    END IF;

    SELECT balance INTO v_source_balance
    FROM public.wallets
    WHERE id = v_wallet_id
    FOR UPDATE;

    IF COALESCE(v_source_balance, 0) < v_amount THEN
      RAISE EXCEPTION 'Solde insuffisant. Disponible : % FCFA.', COALESCE(v_source_balance, 0) USING ERRCODE = '23514';
    END IF;
  ELSIF v_destination_wallet_id IS NOT NULL THEN
    RAISE EXCEPTION 'Seul un transfert peut désigner un wallet destination.' USING ERRCODE = '22023';
  END IF;

  IF (p_link_module IS NULL) <> (p_link_record_id IS NULL) THEN
    RAISE EXCEPTION 'Le module et son identifiant doivent être fournis ensemble.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.finance_operations (
    wallet_id, destination_wallet_id, type, amount, operation_date,
    category, description, reference, status, origin, module, module_id,
    payment_method, payment_reference, supplier, client, employee, project,
    vehicle_id, farm_id, motorcycle_id, driver_id, employee_id, contract_id,
    harvest_id, maintenance_id, motorcycle_maintenance_id, inventory_item_id,
    attachment_url, notes, created_by
  ) VALUES (
    v_wallet_id, v_destination_wallet_id, v_type, v_amount,
    COALESCE(NULLIF(p_operation ->> 'operation_date', '')::date, current_date),
    NULLIF(p_operation ->> 'category', ''), NULLIF(p_operation ->> 'description', ''),
    NULLIF(p_operation ->> 'reference', ''), COALESCE(NULLIF(p_operation ->> 'status', ''), 'VALIDE'),
    NULLIF(p_operation ->> 'origin', ''), NULLIF(p_operation ->> 'module', ''),
    NULLIF(p_operation ->> 'module_id', '')::uuid, NULLIF(p_operation ->> 'payment_method', ''),
    NULLIF(p_operation ->> 'payment_reference', ''), NULLIF(p_operation ->> 'supplier', ''),
    NULLIF(p_operation ->> 'client', ''), NULLIF(p_operation ->> 'employee', ''),
    NULLIF(p_operation ->> 'project', ''), NULLIF(p_operation ->> 'vehicle_id', '')::uuid,
    NULLIF(p_operation ->> 'farm_id', '')::uuid, NULLIF(p_operation ->> 'motorcycle_id', '')::uuid,
    NULLIF(p_operation ->> 'driver_id', '')::uuid, NULLIF(p_operation ->> 'employee_id', '')::uuid,
    NULLIF(p_operation ->> 'contract_id', '')::uuid, NULLIF(p_operation ->> 'harvest_id', '')::uuid,
    NULLIF(p_operation ->> 'maintenance_id', '')::uuid,
    NULLIF(p_operation ->> 'motorcycle_maintenance_id', '')::uuid,
    NULLIF(p_operation ->> 'inventory_item_id', '')::uuid,
    NULLIF(p_operation ->> 'attachment_url', ''), NULLIF(p_operation ->> 'notes', ''), auth.uid()
  ) RETURNING * INTO v_operation;

  IF p_link_module IS NOT NULL THEN
    INSERT INTO public.finance_links (finance_operation_id, module, module_record_id)
    VALUES (v_operation.id, p_link_module, p_link_record_id)
    ON CONFLICT (finance_operation_id, module, module_record_id) DO NOTHING;
  END IF;

  PERFORM public.update_wallet_balance(v_wallet_id);
  IF v_destination_wallet_id IS NOT NULL THEN
    PERFORM public.update_wallet_balance(v_destination_wallet_id);
  END IF;

  RETURN v_operation;
END;
$function$;
