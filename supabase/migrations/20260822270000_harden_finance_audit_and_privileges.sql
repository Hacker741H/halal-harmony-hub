-- Recette Phase C — corrections controlees de T10 (CRITICAL), T12, T13.
-- Perimetre strict : aucune donnee historique modifiee, aucun solde
-- existant touche, Finance V2/hierarchie Wallets/Design V2 non repris.

-- ---------------------------------------------------------------------
-- C1 / T10 : finance_delete_operation faisait un DELETE physique d'une
-- ecriture financiere confirmee (toute ligne de finance_operations a un
-- effet monetaire des sa creation -- finance_create_operation appelle
-- update_wallet_balance immediatement apres l'INSERT, il n'existe pas
-- d'etat brouillon/non-poste pour cette table). Reutilise le mecanisme
-- CANCELLED existant plutot que d'en creer un second.
--
-- Bug corrige au passage dans business_cancel_finance_operation : seul
-- wallet_id etait recalcule apres annulation, jamais
-- destination_wallet_id -- un TRANSFER annule laissait le wallet
-- destination avec un solde perime. Necessaire pour que la reutilisation
-- demandee soit correcte, pas juste reutilisee telle quelle.
--
-- Idempotence deja presente et conservee : le IF COALESCE(status,
-- 'VALIDE') <> 'CANCELLED' ne rejoue rien si l'operation est deja
-- annulee -- une deuxieme annulation ne double jamais l'effet inverse.
CREATE OR REPLACE FUNCTION public.business_cancel_finance_operation(p_operation_id uuid)
 RETURNS finance_operations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_operation public.finance_operations;
BEGIN
  PERFORM public.business_finance_require_write_role();

  SELECT * INTO v_operation
  FROM public.finance_operations
  WHERE id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opération financière liée introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_operation.status, 'VALIDE') <> 'CANCELLED' THEN
    UPDATE public.finance_operations
    SET status = 'CANCELLED', updated_at = now()
    WHERE id = v_operation.id
    RETURNING * INTO v_operation;
    PERFORM public.update_wallet_balance(v_operation.wallet_id);
    IF v_operation.destination_wallet_id IS NOT NULL THEN
      PERFORM public.update_wallet_balance(v_operation.destination_wallet_id);
    END IF;
  END IF;

  RETURN v_operation;
END;
$function$;

-- finance_delete_operation garde son nom et sa signature (RETURNS
-- boolean) pour ne pas casser l'appelant frontend existant -- son corps
-- ne fait plus jamais de DELETE, seulement une annulation tracee.
CREATE OR REPLACE FUNCTION public.finance_delete_operation(p_operation_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.business_cancel_finance_operation(p_operation_id);
  RETURN true;
END;
$function$;

-- ---------------------------------------------------------------------
-- C2 / T12 : toute future modification de wallets.initial_balance doit
-- etre auditable (ancienne valeur, nouvelle valeur, delta). Reutilise
-- business_finance_audit, deja le mecanisme d'audit de ce schema --
-- aucune nouvelle table. Aucun initial_balance existant n'est modifie
-- par cette migration, seul le CODE qui gouvernerait un futur changement
-- est corrige.
CREATE OR REPLACE FUNCTION public.wallet_update(p_wallet_id uuid, p_values jsonb)
 RETURNS wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.wallets;
  v_wallet public.wallets;
  v_make_default boolean;
  v_new_initial_balance numeric;
BEGIN
  PERFORM public.security_require_finance_role();
  IF p_values ? 'balance' THEN
    RAISE EXCEPTION 'Le solde est calculé automatiquement et ne peut pas être modifié directement.' USING ERRCODE = '22023';
  END IF;
  IF p_values ? 'name' AND NULLIF(trim(p_values ->> 'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Le nom du wallet ne peut pas être vide.' USING ERRCODE = '22023';
  END IF;
  IF p_values ? 'type' AND NULLIF(trim(p_values ->> 'type'), '') IS NULL THEN
    RAISE EXCEPTION 'Le type du wallet ne peut pas être vide.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_before FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet introuvable.' USING ERRCODE = 'P0002';
  END IF;
  v_make_default := CASE WHEN p_values ? 'is_default' THEN COALESCE(NULLIF(p_values ->> 'is_default', '')::boolean, false) ELSE v_before.is_default END;
  IF v_make_default THEN
    UPDATE public.wallets SET is_default = false, updated_at = now() WHERE is_default = true AND id <> p_wallet_id;
  END IF;

  v_new_initial_balance := CASE WHEN p_values ? 'initial_balance' THEN NULLIF(p_values ->> 'initial_balance', '')::numeric ELSE v_before.initial_balance END;

  UPDATE public.wallets
  SET name = CASE WHEN p_values ? 'name' THEN trim(p_values ->> 'name') ELSE name END,
      type = CASE WHEN p_values ? 'type' THEN trim(p_values ->> 'type') ELSE type END,
      initial_balance = v_new_initial_balance,
      color = CASE WHEN p_values ? 'color' THEN NULLIF(trim(p_values ->> 'color'), '') ELSE color END,
      icon = CASE WHEN p_values ? 'icon' THEN NULLIF(trim(p_values ->> 'icon'), '') ELSE icon END,
      is_default = v_make_default,
      updated_at = now()
  WHERE id = p_wallet_id
  RETURNING * INTO v_wallet;

  PERFORM public.update_wallet_balance(p_wallet_id);
  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id;

  IF p_values ? 'initial_balance' AND v_new_initial_balance IS DISTINCT FROM v_before.initial_balance THEN
    -- action='UPDATE': business_finance_audit_action_check only allows a
    -- fixed vocabulary (CREATE/UPDATE/CANCEL/...); it has no dedicated
    -- initial-balance-specific value, so we reuse the generic UPDATE
    -- action -- the before/after payload already carries what actually
    -- changed (initial_balance + delta), which is what T12 requires.
    INSERT INTO public.business_finance_audit(source_type, source_id, action, before_value, after_value, performed_by)
    VALUES (
      'wallet', p_wallet_id, 'UPDATE',
      jsonb_build_object('initial_balance', v_before.initial_balance),
      jsonb_build_object('initial_balance', v_new_initial_balance, 'delta', v_new_initial_balance - v_before.initial_balance),
      auth.uid()
    );
  END IF;

  INSERT INTO public.security_audit_log(actor_user_id, event_type, resource_type, resource_id, metadata)
  VALUES (auth.uid(), 'WALLET_UPDATED', 'WALLET', p_wallet_id, jsonb_build_object('name', v_wallet.name));
  RETURN v_wallet;
END;
$function$;

-- ---------------------------------------------------------------------
-- C3 / T13 : update_wallet_balance etait EXECUTE-accessible a PUBLIC/
-- anon/authenticated directement. Sans risque reel prouve (wallets n'a
-- aucune politique RLS d'UPDATE pour ces roles, un appel direct echoue
-- deja silencieusement), mais retire par principe du moindre privilege.
-- SECURITY INVOKER n'est PAS change : les appelants legitimes
-- (finance_create_operation, business_cancel_finance_operation,
-- wallet_update, wallet_create) sont tous SECURITY DEFINER -- l'appel
-- interne a update_wallet_balance s'execute donc sous l'identite du
-- definer de la fonction appelante, jamais sous authenticated/anon, et
-- n'est pas affecte par ce REVOKE. Prouve par C4/TEST 7 ci-apres, pas
-- suppose.
REVOKE ALL ON FUNCTION public.update_wallet_balance(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_wallet_balance(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.update_wallet_balance(uuid) FROM authenticated;
