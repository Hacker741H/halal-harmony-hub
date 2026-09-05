-- Chantier de stabilisation globale, section 7 (hierarchie parent/sous-
-- wallets) -- verification approfondie : le trigger trg_enforce_wallet_
-- not_parent (20260823000000) bloque bien tout mouvement financier reel
-- sur un wallet parent, sans aucune faille -- mais deux selecteurs de
-- wallet, hors du composant partage WalletSelect, ne l'excluaient jamais
-- des options proposees. Aucune donnee n'a pu etre corrompue (le trigger
-- protege toujours l'ecriture finale), mais un utilisateur ne le decouvrait
-- qu'au moment d'une exception Postgres brute au lieu de ne jamais voir
-- l'option. Deux RPC corrigees ici, memes semantiques que WalletSelect et
-- que le trigger : exclure un wallet des qu'il a au moins un enfant.

-- 1) Remise de caisse -- le wallet destination proposé au gestionnaire.
CREATE OR REPLACE FUNCTION public.get_commerce_cash_remittance_workspace(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_can_declare boolean := public.user_has_permission('commerce.cash.remittance.declare');
  v_can_confirm boolean := public.user_has_permission('commerce.cash.remittance.confirm');
  v_all_cashiers boolean := v_can_confirm;
BEGIN
  PERFORM public.permission_require('commerce.cash.read');
  IF NOT public.commerce_location_access_allowed(p_location_id) THEN
    RAISE EXCEPTION 'Magasin non autorisé.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'access', jsonb_build_object('declare', v_can_declare, 'confirm', v_can_confirm),
    'summary', jsonb_build_object(
      'closedTheoretical', coalesce((SELECT sum(closure.server_cash_total)
        FROM public.commerce_pos_cash_session_closures closure
        WHERE closure.business_location_id = p_location_id
          AND (v_all_cashiers OR closure.cashier_user_id = auth.uid())), 0),
      'closedCounted', coalesce((SELECT sum(closure.counted_cash)
        FROM public.commerce_pos_cash_session_closures closure
        WHERE closure.business_location_id = p_location_id
          AND (v_all_cashiers OR closure.cashier_user_id = auth.uid())), 0),
      'awaitingConfirmation', coalesce((SELECT sum(remittance.amount)
        FROM public.commerce_cash_remittances remittance
        WHERE remittance.business_location_id = p_location_id AND remittance.status = 'DECLARED'
          AND (v_all_cashiers OR remittance.declared_by = auth.uid())), 0),
      'confirmedReceived', coalesce((SELECT sum(remittance.received_amount)
        FROM public.commerce_cash_remittances remittance
        WHERE remittance.business_location_id = p_location_id AND remittance.status = 'CONFIRMED'
          AND (v_all_cashiers OR remittance.declared_by = auth.uid())), 0),
      'remainingToRemit', coalesce((SELECT sum(greatest(closure.counted_cash - coalesce(used.amount, 0), 0))
        FROM public.commerce_pos_cash_session_closures closure
        LEFT JOIN LATERAL (
          SELECT sum(CASE
            WHEN remittance.status = 'DECLARED' THEN link.allocated_counted_amount
            WHEN remittance.status = 'CONFIRMED' AND remittance.amount > 0
              THEN round(link.allocated_counted_amount * remittance.received_amount / remittance.amount, 2)
            ELSE 0 END) AS amount
          FROM public.commerce_cash_remittance_closures link
          JOIN public.commerce_cash_remittances remittance ON remittance.id = link.remittance_id
          WHERE link.closure_id = closure.id AND remittance.status <> 'CANCELLED'
        ) used ON true
        WHERE closure.business_location_id = p_location_id
          AND (v_all_cashiers OR closure.cashier_user_id = auth.uid())), 0),
      'cashDifference', coalesce((SELECT sum(closure.server_difference)
        FROM public.commerce_pos_cash_session_closures closure
        WHERE closure.business_location_id = p_location_id
          AND (v_all_cashiers OR closure.cashier_user_id = auth.uid())), 0),
      'remittanceDifference', coalesce((SELECT sum(remittance.remittance_difference)
        FROM public.commerce_cash_remittances remittance
        WHERE remittance.business_location_id = p_location_id AND remittance.status = 'CONFIRMED'
          AND (v_all_cashiers OR remittance.declared_by = auth.uid())), 0)
    ),
    'closures', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', closure.id, 'cashSessionId', closure.cash_session_id,
        'closedAt', closure.closed_at_device,
        'cashierId', closure.cashier_user_id,
        'cashier', coalesce(NULLIF(profile.full_name, ''), NULLIF(profile.username, ''), 'Utilisateur'),
        'theoreticalCash', closure.server_cash_total, 'countedCash', closure.counted_cash,
        'cashDifference', closure.server_difference, 'status', closure.status,
        'remainingAmount', greatest(closure.counted_cash - coalesce(used.amount, 0), 0)
      ) ORDER BY closure.closed_at_device DESC)
      FROM public.commerce_pos_cash_session_closures closure
      LEFT JOIN public.profiles profile ON profile.id = closure.cashier_user_id
      LEFT JOIN LATERAL (
        SELECT sum(CASE
          WHEN remittance.status = 'DECLARED' THEN link.allocated_counted_amount
          WHEN remittance.status = 'CONFIRMED' AND remittance.amount > 0
            THEN round(link.allocated_counted_amount * remittance.received_amount / remittance.amount, 2)
          ELSE 0 END) AS amount
        FROM public.commerce_cash_remittance_closures link
        JOIN public.commerce_cash_remittances remittance ON remittance.id = link.remittance_id
        WHERE link.closure_id = closure.id AND remittance.status <> 'CANCELLED'
      ) used ON true
      WHERE closure.business_location_id = p_location_id
        AND (v_all_cashiers OR closure.cashier_user_id = auth.uid())
    ), '[]'::jsonb),
    'destinationWallets', CASE WHEN v_can_confirm THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', wallet.id, 'name', wallet.name, 'purpose', mapping.purpose)
        ORDER BY mapping.is_primary DESC, wallet.name)
      FROM public.business_location_wallets mapping
      JOIN public.wallets wallet ON wallet.id = mapping.wallet_id
      WHERE mapping.business_location_id = p_location_id
        AND mapping.is_active
        AND mapping.purpose IN ('COLLECTION', 'OPERATING')
        -- Ajout : un wallet parent (qui a des sous-wallets) n'est jamais
        -- transactionnel -- meme regle que le trigger et que WalletSelect,
        -- appliquee ici pour la premiere fois.
        AND NOT EXISTS (SELECT 1 FROM public.wallets child WHERE child.parent_wallet_id = wallet.id)
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'remittances', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', remittance.id, 'eventId', remittance.remittance_event_id,
        'status', remittance.status, 'declaredAt', remittance.declared_at,
        'confirmedAt', remittance.confirmed_at,
        'expectedAmount', remittance.expected_amount, 'declaredAmount', remittance.amount,
        'receivedAmount', remittance.received_amount,
        'cashDifference', remittance.cashier_difference,
        'remittanceDifference', remittance.remittance_difference,
        'note', remittance.notes, 'confirmationNote', remittance.confirmation_note,
        'cashierId', remittance.declared_by,
        'cashier', coalesce(NULLIF(declarant.full_name, ''), NULLIF(declarant.username, ''), 'Utilisateur'),
        'confirmer', CASE WHEN remittance.confirmed_by IS NULL THEN NULL
          ELSE coalesce(NULLIF(confirmer.full_name, ''), NULLIF(confirmer.username, ''), 'Utilisateur') END,
        'sourceWallet', source_wallet.name, 'destinationWallet', destination_wallet.name,
        'closures', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', closure.id, 'cashSessionId', closure.cash_session_id,
          'closedAt', closure.closed_at_device, 'allocatedAmount', link.allocated_counted_amount
        ) ORDER BY closure.closed_at_device)
          FROM public.commerce_cash_remittance_closures link
          JOIN public.commerce_pos_cash_session_closures closure ON closure.id = link.closure_id
          WHERE link.remittance_id = remittance.id), '[]'::jsonb)
      ) ORDER BY remittance.declared_at DESC)
      FROM public.commerce_cash_remittances remittance
      LEFT JOIN public.profiles declarant ON declarant.id = remittance.declared_by
      LEFT JOIN public.profiles confirmer ON confirmer.id = remittance.confirmed_by
      JOIN public.wallets source_wallet ON source_wallet.id = remittance.source_wallet_id
      LEFT JOIN public.wallets destination_wallet ON destination_wallet.id = remittance.destination_wallet_id
      WHERE remittance.business_location_id = p_location_id
        AND (v_all_cashiers OR remittance.declared_by = auth.uid())
    ), '[]'::jsonb)
  );
END;
$function$;

-- 2) Terrain -- affectation d'un wallet a un utilisateur : assign_field_
-- wallet validait seulement que le wallet existe, jamais qu'il n'est pas
-- devenu un wallet parent depuis. L'ecriture financiere elle-meme reste
-- bloquee par le trigger, mais l'affectation elle-meme ne doit pas non
-- plus reussir silencieusement sur un wallet qui ne pourra jamais recevoir
-- de fonds. Reproduction exacte de la derniere definition
-- (20260802123000_add_immediate_field_receipts.sql:22-81), seul le
-- controle de wallet parent est ajoute -- aucune autre ligne changee.
CREATE OR REPLACE FUNCTION public.assign_field_wallet(p_assignment jsonb)
RETURNS public.field_wallet_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $assign_field_wallet$
DECLARE
  v_assignment public.field_wallet_assignments;
  v_user_id uuid := NULLIF(p_assignment ->> 'user_id', '')::uuid;
  v_wallet_id uuid := NULLIF(p_assignment ->> 'wallet_id', '')::uuid;
  v_label text := NULLIF(btrim(p_assignment ->> 'label'), '');
  v_assignment_type text := upper(coalesce(NULLIF(btrim(p_assignment ->> 'assignment_type'), ''), 'SOURCE'));
  v_allow_immediate_receipts boolean := coalesce((p_assignment ->> 'allow_immediate_receipts')::boolean, false);
BEGIN
  PERFORM public.permission_require('field.wallets.assign');

  IF v_user_id IS NULL OR v_wallet_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id)
    OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Utilisateur ou wallet terrain introuvable.' USING ERRCODE = '23503';
  END IF;

  -- Ajout : meme regle que le trigger et que WalletSelect -- un wallet
  -- parent consolidateur n'est jamais transactionnel.
  IF EXISTS (SELECT 1 FROM public.wallets child WHERE child.parent_wallet_id = v_wallet_id) THEN
    RAISE EXCEPTION 'Ce wallet est un wallet parent consolidateur : choisissez un de ses sous-wallets pour cette affectation.' USING ERRCODE = '22023';
  END IF;

  IF v_assignment_type NOT IN ('SOURCE', 'DESTINATION') THEN
    RAISE EXCEPTION 'Type d’affectation de wallet terrain invalide.' USING ERRCODE = '22023';
  END IF;

  IF v_assignment_type <> 'SOURCE' AND v_allow_immediate_receipts THEN
    RAISE EXCEPTION 'Seul un wallet terrain peut autoriser les recettes immédiates.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.field_wallet_assignments(
    user_id, wallet_id, assignment_type, label, allow_immediate_receipts,
    is_active, assigned_by, revoked_at
  ) VALUES (
    v_user_id, v_wallet_id, v_assignment_type, v_label, v_allow_immediate_receipts,
    true, auth.uid(), NULL
  )
  ON CONFLICT (user_id, wallet_id) DO UPDATE
  SET assignment_type = EXCLUDED.assignment_type,
      label = EXCLUDED.label,
      allow_immediate_receipts = EXCLUDED.allow_immediate_receipts,
      is_active = true,
      assigned_by = auth.uid(),
      assigned_at = now(),
      revoked_at = NULL,
      updated_at = now()
  RETURNING * INTO v_assignment;

  PERFORM public.business_finance_audit_event(
    'FIELD_WALLET_ASSIGNMENT',
    v_assignment.id,
    NULL,
    'UPDATE',
    NULL,
    to_jsonb(v_assignment)
  );

  RETURN v_assignment;
END;
$assign_field_wallet$;
