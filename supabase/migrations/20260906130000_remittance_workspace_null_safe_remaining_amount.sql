-- Préflight production (audit read-only de iljetumzbqtrjvtdlynj) : la seule
-- clôture réelle existante est closure_kind='AUTOMATIC', counted_cash=NULL
-- (parcours automatique, pas encore compté par un caissier -- voir
-- 20260814120000_add_commerce_pos_automatic_closure_and_control_reports.sql,
-- qui documente explicitement "NULL = pas de comptage caissier ... ne
-- jamais confondre NULL (inconnu à ce stade) et 0 (compté à zéro)").
--
-- get_commerce_cash_remittance_workspace ne respectait pas cette règle pour
-- remainingAmount : GREATEST(counted_cash - coalesce(used.amount,0), 0)
-- -- vérifié directement contre la ligne réelle (counted_cash=NULL) --
-- retombe sur 0, jamais NULL (GREATEST ignore un argument NULL tant que
-- l'autre est défini). Une clôture jamais comptée s'affichait donc comme
-- "0 FCFA restant", un signal identique à "entièrement remise", alors que
-- le comptage n'a simplement pas encore eu lieu.
--
-- countedCash/cashDifference étaient déjà nullable côté TS
-- (commerce-pos.functions.ts) ; remainingAmount ne l'était pas -- corrigé
-- ici et côté TS/UI dans le même commit. Seule cette clé change ; aucune
-- autre ligne de la fonction n'est modifiée (summary.remainingToRemit,
-- calculée sur le même agrégat mais à l'échelle du magasin entier, reste
-- volontairement hors périmètre de ce correctif -- non demandée, portée
-- différente).
--
-- Reproduction exacte de la définition actuelle
-- (20260904110000_exclude_parent_wallets_from_remittance_and_field.sql),
-- aucune permission/grant/search_path touché.
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
        -- Ajout : NULL doit rester NULL -- une clôture jamais comptée n'a
        -- pas de "reste à remettre" connu, ce n'est pas un reste de zéro.
        'remainingAmount', CASE
          WHEN closure.counted_cash IS NULL THEN NULL
          ELSE greatest(closure.counted_cash - coalesce(used.amount, 0), 0)
        END
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
