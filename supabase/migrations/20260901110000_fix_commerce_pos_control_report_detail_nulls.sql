-- Bug reel constate en production : get_commerce_pos_control_report_detail
-- faisait reposer la requete PRINCIPALE (report + receivedTotal +
-- isFinalized + remainingAmount) sur "FROM public.profiles profile_row
-- WHERE profile_row.id = v_report.cashier_user_id" -- un FROM/WHERE qui se
-- comporte comme une jointure interne. Des lors que le caissier n'a plus de
-- ligne profiles (compte supprime/desactive), cette requete ne remonte
-- aucune ligne : v_result devient NULL, et la branche de secours qui suit
-- reconstruit 'report' SANS jamais y remettre receivedTotal/isFinalized/
-- remainingAmount (cles totalement absentes, pas juste nulles) -- alors que
-- controlReportDetailSchema.report les declare obligatoires cote TS. Le
-- .parse() Zod echoue avec "Required" et fait planter tout l'ecran.
--
-- La meme branche de secours perdait aussi silencieusement les vraies
-- ventes/receptions du rapport (codees en dur a '[]'::jsonb) -- un second
-- bug, silencieux celui-la, decouvert en corrigeant le premier.
--
-- Correctif : le nom du caissier n'a besoin d'aucune jointure au niveau de
-- la requete principale -- exactement comme le fait deja
-- get_commerce_pos_control_reports (LEFT JOIN + coalesce), il devient ici
-- une sous-requete scalaire autonome. La requete principale n'a alors plus
-- aucune dependance a l'existence d'une ligne profiles et produit toujours
-- exactement une ligne (comme SELECT 1+1 : pas de FROM, que des scalaires
-- et sous-requetes). La branche de secours devient inatteignable et est
-- retiree.
CREATE OR REPLACE FUNCTION public.get_commerce_pos_control_report_detail(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_report public.commerce_pos_control_reports;
  v_result jsonb;
BEGIN
  PERFORM public.permission_require('commerce.cash.reports.control');
  SELECT * INTO v_report FROM public.commerce_pos_control_reports WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rapport introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.commerce_location_access_allowed(v_report.business_location_id) THEN
    RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'report', jsonb_build_object(
      'id', v_report.id, 'closureId', v_report.closure_id, 'cashSessionId', v_report.cash_session_id,
      'terminalId', v_report.terminal_id, 'businessLocationId', v_report.business_location_id,
      'cashier', (
        SELECT coalesce(NULLIF(profile_row.full_name, ''), NULLIF(profile_row.username, ''), 'Utilisateur')
        FROM public.profiles profile_row
        WHERE profile_row.id = v_report.cashier_user_id
      ),
      'openedAt', v_report.opened_at_device, 'closedAt', v_report.closed_at_device,
      'ticketCount', v_report.ticket_count, 'articleRevenue', v_report.article_revenue,
      'serviceRevenue', v_report.service_revenue, 'totalRevenue', v_report.total_revenue,
      'articleQuantityTotal', v_report.article_quantity_total,
      'cashExpected', v_report.cash_expected, 'mobileMoneyTotal', v_report.mobile_money_total,
      'otherPaymentTotal', v_report.other_payment_total, 'syncStatus', v_report.sync_status,
      'flaggedForReview', v_report.flagged_for_review, 'flaggedReason', v_report.flagged_reason,
      'generatedAt', v_report.generated_at
    ) || (
      SELECT jsonb_build_object(
        'receivedTotal', coalesce(sum(r.received_amount), 0),
        'isFinalized', coalesce(bool_or(coalesce(r.is_final, false)), false),
        'remainingAmount', greatest(round(v_report.cash_expected - coalesce(sum(r.received_amount), 0), 2), 0)
      )
      FROM public.commerce_cash_remittances r
      JOIN public.commerce_cash_remittance_closures link ON link.remittance_id = r.id
      WHERE link.closure_id = v_report.closure_id AND r.status = 'CONFIRMED'
    ),
    'sales', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sale.id, 'saleNumber', sale.sale_number, 'createdAt', sale.created_at,
        'total', (SELECT coalesce(sum(l.line_total), 0) FROM public.commercial_sale_lines l WHERE l.sale_id = sale.id)
      ) ORDER BY sale.created_at)
      FROM public.commercial_sales sale
      WHERE sale.cash_session_id = v_report.cash_session_id
        AND sale.business_location_id = v_report.business_location_id
        AND sale.status = 'CONFIRMED'
    ), '[]'::jsonb),
    'receptions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'receivedAmount', r.received_amount, 'expectedAmount', r.expected_amount,
        'difference', r.remittance_difference, 'isFinal', r.is_final,
        'destinationWallet', wallet_row.name, 'confirmedBy', coalesce(NULLIF(confirmer.full_name, ''), NULLIF(confirmer.username, ''), 'Utilisateur'),
        'confirmedAt', r.confirmed_at, 'note', r.confirmation_note, 'operationId', finance_link.operation_id
      ) ORDER BY r.confirmed_at)
      FROM public.commerce_cash_remittances r
      JOIN public.commerce_cash_remittance_closures link ON link.remittance_id = r.id
      LEFT JOIN public.wallets wallet_row ON wallet_row.id = r.destination_wallet_id
      LEFT JOIN public.profiles confirmer ON confirmer.id = r.confirmed_by
      LEFT JOIN public.finance_commerce_cash_remittance_links finance_link ON finance_link.remittance_id = r.id
      WHERE link.closure_id = v_report.closure_id AND r.status = 'CONFIRMED'
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_commerce_pos_control_report_detail(uuid) IS
  'Detail d''un rapport de controle caisse. Le nom du caissier est resolu par sous-requete scalaire independante -- un profil manquant degrade "cashier" a "Utilisateur" sans jamais faire perdre receivedTotal/isFinalized/remainingAmount/sales/receptions (bug corrige le 2026-09-01).';
