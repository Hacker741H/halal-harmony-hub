-- Réconciliation post-stabilisation avec origin/main (branche
-- reconcile-main-after-stabilization). Deux commits main-only du même jour
-- (22 août), jamais fusionnés dans cette branche faute d'avoir suivi la
-- même lignée Git après la divergence :
--   aa289de "feat(finance): make store expense wallet selection explicit"
--   a44e05f "fix(finance): allow accessible wallets for store expenses"
-- (17 minutes plus tard -- un correctif immédiat du premier, pas un
-- changement d'avis indépendant.)
--
-- Cette branche n'avait jamais reçu ni l'un ni l'autre : sa définition de
-- confirm_commerce_store_expense (20260813120000_add_store_costing_and_
-- profitability.sql) était encore la toute première version, qui ne
-- vérifiait que business_location_wallets.is_active -- jamais
-- wallets.is_archived lui-même. Un wallet pouvait donc être archivé tout
-- en gardant un mapping magasin actif, et cette fonction l'acceptait quand
-- même pour débiter une dépense : c'est exactement le trou qu'aa289de
-- corrige (classification A -- correction encore nécessaire, appliquée
-- ici).
--
-- a44e05f va plus loin et corrige un second problème réel : restreindre le
-- wallet aux seuls wallets mappés à CE magasin (business_location_wallets,
-- purpose CASH_DRAWER/OPERATING) est trop étroit pour un besoin métier
-- réel -- payer une dépense magasin depuis un wallet central, hors mapping
-- POS/caisse/remise. Décision : on garde a44e05f (classification A),
-- reconnue supérieure après vérification -- son contrôle d'accès
-- (wallets.read, ou field.wallets.read + affectation active) est
-- exactement la même règle que la RLS wallets_read déjà en vigueur sur
-- cette branche (20260803110000_allow_assigned_field_wallet_read.sql), pas
-- une notion nouvelle ni plus permissive que ce que la lecture autorise
-- déjà : la fonction ne fait que revérifier explicitement, au moment de
-- l'écriture financière, une règle que la RLS applique déjà à la lecture.
--
-- Ni aa289de ni a44e05f n'avait connaissance de la hiérarchie parent/
-- enfant : elle n'existe que sur cette branche
-- (20260823000000_add_wallet_parent_hierarchy.sql), un jour après ces deux
-- commits sur main. Ajout ici (ni A ni B ne le couvrait) : un wallet
-- parent consolidateur est refusé, même règle que le trigger, WalletSelect
-- et assign_field_wallet.
CREATE OR REPLACE FUNCTION public.confirm_commerce_store_expense(p_expense_id uuid, p_wallet_id uuid)
RETURNS public.commerce_store_expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commerce_store_expenses;
  v_expense public.commerce_store_expenses;
  v_operation public.finance_operations;
BEGIN
  PERFORM public.permission_require('store.expenses.confirm');

  SELECT * INTO v_before FROM public.commerce_store_expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Depense introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.commerce_location_access_allowed(v_before.business_location_id) THEN
    RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE = '42501';
  END IF;
  IF v_before.status = 'CONFIRMED' THEN
    RETURN v_before;
  END IF;
  IF v_before.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Seule une depense brouillon peut etre confirmee.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = p_wallet_id AND NOT is_archived) THEN
    RAISE EXCEPTION 'Wallet introuvable ou archive.' USING ERRCODE = '23503';
  END IF;

  -- Meme regle que la RLS wallets_read (20260803110000) : tout wallet
  -- accessible en lecture, pas seulement ceux mappes a ce magasin.
  IF NOT (
    public.user_has_permission('wallets.read')
    OR (
      public.user_has_permission('field.wallets.read')
      AND EXISTS (
        SELECT 1 FROM public.field_wallet_assignments assignment
        WHERE assignment.wallet_id = p_wallet_id
          AND assignment.user_id = auth.uid()
          AND assignment.is_active
      )
    )
  ) THEN
    RAISE EXCEPTION 'Acces refuse a ce wallet.' USING ERRCODE = '42501';
  END IF;

  -- Ajout propre a cette branche : un wallet parent consolidateur (a des
  -- sous-wallets) n'est jamais transactionnel.
  IF EXISTS (SELECT 1 FROM public.wallets child WHERE child.parent_wallet_id = p_wallet_id) THEN
    RAISE EXCEPTION 'Ce wallet est un wallet parent consolidateur : choisissez un de ses sous-wallets pour cette depense.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.commerce_store_expenses
  SET wallet_id = p_wallet_id,
      status = 'CONFIRMED',
      confirmed_by = auth.uid(),
      confirmed_at = now(),
      updated_at = now()
  WHERE id = p_expense_id
  RETURNING * INTO v_expense;

  v_operation := public.business_upsert_finance_operation(
    NULL, p_wallet_id, 'EXPENSE', v_expense.amount, v_expense.expense_date,
    'DEPENSE MAGASIN - ' || v_expense.category, v_expense.description,
    'COMMERCE_STORE_EXPENSE', 'COMMERCE_STORE_EXPENSE', v_expense.id,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    v_expense.reference
  );

  INSERT INTO public.finance_commerce_store_expense_links(store_expense_id, operation_id, created_at)
  VALUES (v_expense.id, v_operation.id, now());

  PERFORM public.business_finance_audit_event(
    'COMMERCE_STORE_EXPENSE', v_expense.id, v_operation.id, 'UPDATE',
    to_jsonb(v_before), to_jsonb(v_expense)
  );

  RETURN v_expense;
END;
$function$;
