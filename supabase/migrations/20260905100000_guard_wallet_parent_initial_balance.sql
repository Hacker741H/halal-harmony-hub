-- Revue pré-merge (dernière barrière avant main), trouvaille de l'audit du
-- fichier historique src/components/wallet-form.tsx : un wallet parent
-- consolidateur (qui a des sous-wallets) a son solde propre ramené à
-- exactement 0 par convert_wallet_to_parent -- mais PAS en remettant
-- initial_balance à 0. update_wallet_balance calcule
-- balance = initial_balance + journal_balance
-- (20260822210000_fix_wallet_balance_recalc_scan.sql:41), et
-- convert_wallet_to_parent transfère hors du parent un montant total égal
-- à son solde d'avant conversion (20260823000000, lignes 618-638) : après
-- ces transferts, journal_balance = -initial_balance, donc
-- balance = initial_balance + (-initial_balance) = 0, algébriquement, quelle
-- que soit la valeur de initial_balance -- jamais parce qu'elle a été
-- remise à 0.
--
-- Or wallet_update acceptait de modifier initial_balance sur N'IMPORTE
-- QUEL wallet, y compris un parent déjà converti, sans la moindre
-- vérification de "a-t-il des sous-wallets ?". Changer ensuite ce champ
-- recrée donc un solde fantôme égal à (nouvelle_valeur - ancienne_valeur),
-- invisible sur la fiche du wallet (wallets/$walletId.tsx additionne
-- toujours SUM(children.balance) pour un parent, jamais son propre solde
-- -- par design, documenté ligne 6 de 20260823000000) mais absorbé
-- silencieusement par get_wallet_stats ("Trésorerie consolidée"), qui
-- additionne balance de TOUS les wallets sans exception pour les parents
-- (src/lib/wallet.functions.ts:122-135). Chemin réellement atteignable :
-- src/routes/_authenticated/wallets/index.tsx affiche "Modifier" pour tout
-- wallet non-module, y compris un parent converti, ouvrant WalletForm --
-- où le champ "Solde d'ouverture" était toujours actif et toujours envoyé
-- (src/components/wallet-form.tsx save(), même sur un simple renommage).
--
-- Correctif à deux niveaux, même discipline que le reste de ce chantier
-- (le trigger + WalletSelect pour l'exclusion des parents) :
-- 1) Ici : wallet_update refuse toute VRAIE modification de
--    initial_balance (comparaison IS DISTINCT FROM, pas la simple
--    présence de la clé -- initial_balance est légitimement renvoyé à
--    chaque sauvegarde, y compris quand rien n'a changé, il ne faut donc
--    pas bloquer un simple renommage) dès que le wallet a au moins un
--    sous-wallet. Reproduction exacte de la définition actuelle
--    (20260823000000_add_wallet_parent_hierarchy.sql:116-188), aucune
--    autre ligne changée.
-- 2) src/components/wallet-form.tsx (même commit) : désactive le champ
--    côté UI pour ne jamais déclencher cette exception dans le flux normal.
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
  v_new_parent_wallet_id uuid;
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

  IF p_values ? 'parent_wallet_id' THEN
    PERFORM public._internal_require_wallet_hierarchy_manage();
    v_new_parent_wallet_id := NULLIF(p_values ->> 'parent_wallet_id', '')::uuid;
    PERFORM public._internal_validate_wallet_parent_link(p_wallet_id, v_new_parent_wallet_id);
  ELSE
    v_new_parent_wallet_id := v_before.parent_wallet_id;
  END IF;

  v_make_default := CASE WHEN p_values ? 'is_default' THEN COALESCE(NULLIF(p_values ->> 'is_default', '')::boolean, false) ELSE v_before.is_default END;
  IF v_make_default THEN
    UPDATE public.wallets SET is_default = false, updated_at = now() WHERE is_default = true AND id <> p_wallet_id;
  END IF;

  v_new_initial_balance := CASE WHEN p_values ? 'initial_balance' THEN NULLIF(p_values ->> 'initial_balance', '')::numeric ELSE v_before.initial_balance END;

  -- Ajout : un parent consolidateur a son solde propre a 0 par
  -- compensation algebrique (voir commentaire d'en-tete), jamais parce que
  -- initial_balance vaut 0 -- le modifier apres coup recree un solde
  -- fantome silencieux. Comparaison par valeur (IS DISTINCT FROM), pas par
  -- simple presence de la cle : initial_balance est renvoye a chaque
  -- sauvegarde du formulaire, y compris quand rien n'a change.
  IF v_new_initial_balance IS DISTINCT FROM v_before.initial_balance
     AND EXISTS (SELECT 1 FROM public.wallets WHERE parent_wallet_id = p_wallet_id) THEN
    RAISE EXCEPTION 'Ce wallet est un wallet parent consolidateur : son solde d''ouverture ne peut plus être modifié après conversion. Le total affiché provient uniquement de ses sous-wallets -- ajustez leur solde à eux si nécessaire.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.wallets
  SET name = CASE WHEN p_values ? 'name' THEN trim(p_values ->> 'name') ELSE name END,
      type = CASE WHEN p_values ? 'type' THEN trim(p_values ->> 'type') ELSE type END,
      initial_balance = v_new_initial_balance,
      color = CASE WHEN p_values ? 'color' THEN NULLIF(trim(p_values ->> 'color'), '') ELSE color END,
      icon = CASE WHEN p_values ? 'icon' THEN NULLIF(trim(p_values ->> 'icon'), '') ELSE icon END,
      is_default = v_make_default,
      parent_wallet_id = v_new_parent_wallet_id,
      updated_at = now()
  WHERE id = p_wallet_id
  RETURNING * INTO v_wallet;

  PERFORM public.update_wallet_balance(p_wallet_id);
  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id;

  IF p_values ? 'initial_balance' AND v_new_initial_balance IS DISTINCT FROM v_before.initial_balance THEN
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
