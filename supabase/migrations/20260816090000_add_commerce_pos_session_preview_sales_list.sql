-- Mission maitre -- Blocker A: "Mes ventes" (onglet Ventes du caissier)
-- lisait exclusivement l'outbox IndexedDB local (posSession.outboxEvents).
-- Le chemin de caisse en ligne (create_commerce_cash_sale, appele
-- directement quand le reseau est disponible) n'ecrit jamais dans cet
-- outbox -- une vente en ligne confirmee et correctement comptabilisee
-- serveur (CA, stock, CMV) n'apparaissait donc jamais dans cette liste,
-- bien que le meme ecran affiche par ailleurs un CA du jour exact.
--
-- Cette migration etend get_commerce_pos_cash_session_preview (deja
-- appelee en continu par le frontend pendant toute la duree d'une session
-- ouverte, pas seulement juste avant la cloture) avec la liste des ventes
-- elle-meme, filtree exactement comme _internal_commerce_pos_session_commercial_totals
-- (meme session/terminal/magasin/caissier, statut CONFIRMED) -- meme
-- perimetre que le calcul canonique des totaux, pas un second calcul.
CREATE OR REPLACE FUNCTION public.get_commerce_pos_cash_session_preview(
  p_cash_session_id text,
  p_terminal_id text,
  p_business_location_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_totals record;
BEGIN
  PERFORM public.permission_require('commerce.pos.sell');

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF p_cash_session_id IS NULL OR p_cash_session_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR p_terminal_id IS NULL OR p_terminal_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR p_business_location_id IS NULL THEN
    RAISE EXCEPTION 'Parametres de resume de caisse invalides.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.commerce_location_access_allowed(p_business_location_id) THEN
    RAISE EXCEPTION 'Point de vente non autorise.' USING ERRCODE = '42501';
  END IF;

  -- Lecture seule, aucun verrou, aucune ecriture : peut etre appelee autant
  -- de fois que necessaire pendant que la session reste ouverte (a chaque
  -- vente, au montage du composant, apres chaque synchronisation reussie).
  SELECT * INTO v_totals
  FROM public._internal_commerce_pos_session_commercial_totals(
    p_cash_session_id, p_terminal_id, p_business_location_id, auth.uid()
  );

  RETURN jsonb_build_object(
    'ticketCount', v_totals.ticket_count,
    'articleTotal', v_totals.article_total,
    'articleQuantityTotal', v_totals.article_quantity_total,
    'serviceTotal', v_totals.service_total,
    'cashTotal', v_totals.cash_total,
    'mobileMoneyTotal', v_totals.mobile_money_total,
    'otherPaymentTotal', v_totals.other_payment_total,
    'theoreticalCash', v_totals.cash_total,
    'sales', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sale.id,
        'saleNumber', sale.sale_number,
        'createdAt', sale.created_at,
        'total', COALESCE(article_line.total, 0) + COALESCE(service_line.total, 0),
        'articleCount', COALESCE(article_line.count, 0),
        'serviceCount', COALESCE(service_line.count, 0),
        'paymentMethod', payment.payment_method
      ) ORDER BY sale.created_at DESC, sale.id DESC)
      FROM public.commercial_sales sale
      JOIN public.commercial_invoice_payments payment
        ON payment.sale_id = sale.id AND payment.status = 'CONFIRMED'
      LEFT JOIN LATERAL (
        SELECT sum(line_row.line_total) AS total, count(*) AS count
        FROM public.commercial_sale_lines line_row
        WHERE line_row.sale_id = sale.id AND line_row.line_type = 'ARTICLE'
      ) AS article_line ON true
      LEFT JOIN LATERAL (
        SELECT sum(line_row.line_total) AS total, count(*) AS count
        FROM public.commercial_sale_lines line_row
        WHERE line_row.sale_id = sale.id AND line_row.line_type = 'SERVICE'
      ) AS service_line ON true
      WHERE sale.cash_session_id = p_cash_session_id
        AND sale.terminal_id = p_terminal_id
        AND sale.business_location_id = p_business_location_id
        AND sale.created_by = auth.uid()
        AND sale.status = 'CONFIRMED'
    ), '[]'::jsonb)
  );
END;
$function$;

COMMENT ON FUNCTION public.get_commerce_pos_cash_session_preview(text, text, uuid) IS
  'Resume commercial en lecture seule de la session de caisse ouverte du caissier appelant, avant cloture -- totaux ET liste des ventes elle-meme. Meme definition metier que close_commerce_pos_cash_session (voir _internal_commerce_pos_session_commercial_totals) : uniquement ventes/paiements CONFIRMED de cette session/ce terminal/ce magasin rattaches au caissier appelant, jamais finance_operations. Source serveur unique pour le resume pre-cloture ET pour l''onglet Ventes cote frontend -- a fusionner avec le complement local (ventes hors-ligne pas encore synchronisees, status <> SYNCED) sans jamais recompter une vente deja presente ici.';
