-- Sections 9-11 : un TRANSFERT ne doit jamais rendre le wallet source negatif,
-- et deux transferts concurrents sur le meme wallet ne doivent pas pouvoir
-- ensemble depasser le solde disponible. Confirme par lecture du code Phase A
-- : aucun controle de solde n'existait avant ce correctif, sur aucun type
-- d'operation. On restreint volontairement le blocage au type TRANSFER --
-- REVENUE/EXPENSE/DEPOSIT ne sont pas concernes ici (comportement metier
-- existant inchange, non demande par la mission section 11 : "transfert
-- sortant > disponible = refus").
--
-- Mecanisme : SELECT ... FOR UPDATE verrouille la ligne wallet source avant
-- de lire son solde. Un second transfert concurrent sur le meme wallet
-- attend la fin de la premiere transaction (COMMIT ou ROLLBACK) avant de
-- pouvoir a son tour lire/verifier le solde -- il ne peut jamais lire une
-- valeur perimee. Aucune donnee historique modifiee ; wallets deja negatifs
-- non touches (le controle ne s'applique qu'aux nouvelles operations).
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

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être strictement positif.' USING ERRCODE = '22023';
  END IF;

  IF v_type = 'TRANSFER' THEN
    IF v_destination_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_destination_wallet_id) THEN
      RAISE EXCEPTION 'Le wallet destination est obligatoire pour un transfert.' USING ERRCODE = '23503';
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
