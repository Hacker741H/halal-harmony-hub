-- Repli de transition pour le theorique de caisse : une session peut
-- melanger un paiement anterieur a la migration 20260815100000 (dont
-- commercial_invoice_payments.payment_method est NULL par construction --
-- cette colonne n'a jamais ete retro-remplie par heuristique) et un paiement
-- posterieur (deja renseigne directement). Le filtre CASH/WAVE/JEKO/CARD/OTHER
-- ne matchait alors jamais la ligne NULL, sous-comptant le theorique exactement
-- du montant du paiement historique.
--
-- Cette migration redefinit _internal_commerce_pos_session_commercial_totals
-- (introduite par 20260815100000, deja appliquee et jamais modifiee
-- retroactivement) pour ajouter un repli explicite, jamais heuristique :
-- uniquement quand payment.payment_method est NULL, on lit la
-- finance_operations reellement liee a CE paiement precis via son
-- identifiant stable (module='COMMERCIAL_INVOICE_PAYMENT', module_id =
-- payment.id) -- jamais un rapprochement par montant, date ou heure. Tout
-- paiement posterieur a la migration (payment_method deja renseigne) ne
-- touche jamais ce chemin.
CREATE OR REPLACE FUNCTION public._internal_commerce_pos_session_commercial_totals(
  p_cash_session_id text,
  p_terminal_id text,
  p_business_location_id uuid,
  p_cashier_user_id uuid
)
RETURNS TABLE (
  ticket_count integer,
  article_total numeric,
  service_total numeric,
  article_quantity_total numeric,
  cash_total numeric,
  mobile_money_total numeric,
  other_payment_total numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    count(*)::integer,
    COALESCE(sum(article_line.total), 0),
    COALESCE(sum(service_line.total), 0),
    COALESCE(sum(article_line.qty), 0),
    COALESCE(sum(payment.amount) FILTER (WHERE COALESCE(payment.payment_method, legacy_op.payment_method) = 'CASH'), 0),
    COALESCE(sum(payment.amount) FILTER (WHERE COALESCE(payment.payment_method, legacy_op.payment_method) IN ('WAVE', 'JEKO')), 0),
    COALESCE(sum(payment.amount) FILTER (WHERE COALESCE(payment.payment_method, legacy_op.payment_method) IN ('CARD', 'OTHER')), 0)
  FROM public.commercial_sales AS sale
  JOIN public.commercial_invoice_payments AS payment
    ON payment.sale_id = sale.id AND payment.status = 'CONFIRMED'
  LEFT JOIN LATERAL (
    SELECT sum(line_row.line_total) AS total, sum(line_row.quantity) AS qty
    FROM public.commercial_sale_lines AS line_row
    WHERE line_row.sale_id = sale.id AND line_row.line_type = 'ARTICLE'
  ) AS article_line ON true
  LEFT JOIN LATERAL (
    SELECT sum(line_row.line_total) AS total
    FROM public.commercial_sale_lines AS line_row
    WHERE line_row.sale_id = sale.id AND line_row.line_type = 'SERVICE'
  ) AS service_line ON true
  -- Repli de transition, jamais heuristique : seulement quand
  -- payment.payment_method est NULL (donc forcement un paiement anterieur a
  -- la migration 20260815100000 -- toute vente posterieure le renseigne
  -- toujours), on lit la finance_operation reellement liee a CE paiement
  -- precis via son identifiant stable (module='COMMERCIAL_INVOICE_PAYMENT',
  -- module_id = payment.id) -- jamais un rapprochement par montant, date ou
  -- heure.
  LEFT JOIN LATERAL (
    SELECT legacy.payment_method
    FROM public.finance_operations AS legacy
    WHERE legacy.module = 'COMMERCIAL_INVOICE_PAYMENT'
      AND legacy.module_id = payment.id
      AND legacy.status <> 'CANCELLED'
    ORDER BY legacy.created_at
    LIMIT 1
  ) AS legacy_op ON payment.payment_method IS NULL
  WHERE sale.cash_session_id = p_cash_session_id
    AND sale.terminal_id = p_terminal_id
    AND sale.business_location_id = p_business_location_id
    AND sale.created_by = p_cashier_user_id
    AND sale.status = 'CONFIRMED';
$$;

COMMENT ON FUNCTION public._internal_commerce_pos_session_commercial_totals(text, text, uuid, uuid) IS
  'Definition metier unique du theorique commercial d''une session de caisse (ventes/paiements CONFIRMED). Source de mode de paiement : commercial_invoice_payments.payment_method en priorite ; uniquement si NULL (paiement anterieur a la migration 20260815100000, jamais retro-rempli par heuristique), repli explicite sur la finance_operation reellement liee a ce paiement via module/module_id -- jamais un rapprochement par montant/date. Ne cree jamais d''ecriture Finance (lecture seule). Partagee par close_commerce_pos_cash_session et get_commerce_pos_cash_session_preview pour qu''elles ne puissent jamais diverger. Fonction interne -- aucun GRANT direct, appelee uniquement depuis des fonctions SECURITY DEFINER qui font deja leurs propres verifications de permission/acces.';
