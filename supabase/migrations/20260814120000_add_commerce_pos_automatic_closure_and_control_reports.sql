-- Mission "refonte caisse" -- volet backend.
--
-- Le caissier ne declare plus rien a la cloture (pas de counted_cash, pas de
-- remise, pas de notion de remise du tout). Son parcours est strictement
-- SESSION -> VENTES -> CLOTURE -> FIN. close_commerce_pos_cash_session
-- calcule le theorique unifie POS-06/06B, ventile par mode de paiement, cree
-- la cloture et genere automatiquement un rapport de controle 1:1 -- rien
-- d'autre. Aucune remise n'est attribuee au caissier : le rapport porte
-- seulement le montant espece attendu (cash_expected), une donnee calculee,
-- jamais une declaration.
--
-- La reception physique est une action GESTIONNAIRE distincte, plus tard,
-- via confirm_commerce_pos_cash_reception (nouvelle RPC), qui supporte
-- plusieurs receptions successives contre le meme rapport (reliquat) et cree
-- exactement un mouvement Finance TRANSFER par reception -- jamais un
-- deuxieme CA, jamais une deuxieme marge. Les tables POS-05
-- (commerce_cash_remittances) restent totalement intactes et continuent de
-- servir leur usage actuel (remise manuelle a partir d'une cloture
-- ancien-style avec counted_cash) ; ce nouveau parcours ne les utilise pas,
-- pour ne jamais laisser croire qu'un caissier a "declare" quoi que ce soit.
--
-- L'ancienne RPC sync_commerce_pos_cash_session_close (POS-04C, counted_cash
-- declare par l'appareil) reste intacte pour ne pas casser un client hors
-- ligne deja en vol avec l'ancien format.

-- ---------------------------------------------------------------------------
-- 1) La cloture peut desormais exister sans aucune donnee declaree.
-- ---------------------------------------------------------------------------

ALTER TABLE public.commerce_pos_cash_session_closures
  ALTER COLUMN declared_ticket_count DROP NOT NULL,
  ALTER COLUMN declared_article_total DROP NOT NULL,
  ALTER COLUMN declared_service_total DROP NOT NULL,
  ALTER COLUMN declared_cash_total DROP NOT NULL,
  ALTER COLUMN declared_other_payment_total DROP NOT NULL,
  ALTER COLUMN declared_theoretical_cash DROP NOT NULL,
  ALTER COLUMN counted_cash DROP NOT NULL,
  ALTER COLUMN declared_difference DROP NOT NULL,
  ALTER COLUMN server_difference DROP NOT NULL,
  ALTER COLUMN totals_match DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS server_mobile_money_total numeric(14, 2),
  ADD COLUMN IF NOT EXISTS closure_kind text NOT NULL DEFAULT 'DECLARED' CHECK (closure_kind IN ('DECLARED', 'AUTOMATIC'));

COMMENT ON COLUMN public.commerce_pos_cash_session_closures.counted_cash IS
  'NULL = pas de comptage caissier a la cloture (parcours automatique, closure_kind=AUTOMATIC). Le montant physiquement recu est saisi plus tard par le gestionnaire via commerce_pos_control_report_receptions -- ne jamais confondre NULL (inconnu a ce stade) et 0 (compte a zero).';
COMMENT ON COLUMN public.commerce_pos_cash_session_closures.closure_kind IS
  'DECLARED = ancien parcours POS-04C (appareil declare counted_cash, remise POS-05 manuelle possible). AUTOMATIC = nouveau parcours : aucune saisie caissier, theorique et rapport generes uniquement depuis les ventes serveur, reception geree par commerce_pos_control_report_receptions.';

-- ---------------------------------------------------------------------------
-- 2) Rapport de controle : 1 cloture = 1 rapport, jamais deux. Aucune
--    colonne de statut mutable ici -- le statut (en attente / partiellement
--    recu / recu / a verifier) se calcule de maniere fiable a la lecture a
--    partir de cash_expected, de la somme des receptions et du flag manuel
--    ci-dessous, plutot que d'etre stocke et risquer de derailler.
-- ---------------------------------------------------------------------------

CREATE TABLE public.commerce_pos_control_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_id uuid NOT NULL UNIQUE REFERENCES public.commerce_pos_cash_session_closures(id) ON DELETE RESTRICT,
  cash_session_id text NOT NULL,
  terminal_id text NOT NULL,
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE RESTRICT,
  cashier_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  opened_at_device timestamptz NOT NULL,
  closed_at_device timestamptz NOT NULL,
  ticket_count integer NOT NULL CHECK (ticket_count >= 0),
  article_revenue numeric(14, 2) NOT NULL CHECK (article_revenue >= 0),
  service_revenue numeric(14, 2) NOT NULL CHECK (service_revenue >= 0),
  total_revenue numeric(14, 2) NOT NULL CHECK (total_revenue >= 0),
  article_quantity_total numeric(14, 3) NOT NULL CHECK (article_quantity_total >= 0),
  cash_expected numeric(14, 2) NOT NULL CHECK (cash_expected >= 0),
  mobile_money_total numeric(14, 2) NOT NULL CHECK (mobile_money_total >= 0),
  other_payment_total numeric(14, 2) NOT NULL CHECK (other_payment_total >= 0),
  sync_status text NOT NULL,
  flagged_for_review boolean NOT NULL DEFAULT false,
  flagged_reason text,
  flagged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  flagged_at timestamptz,
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (flagged_for_review = false AND flagged_reason IS NULL AND flagged_by IS NULL AND flagged_at IS NULL)
    OR (flagged_for_review = true AND flagged_reason IS NOT NULL AND flagged_by IS NOT NULL AND flagged_at IS NOT NULL)
  )
);

CREATE INDEX commerce_pos_control_reports_location_idx
  ON public.commerce_pos_control_reports (business_location_id, closed_at_device DESC);
CREATE INDEX commerce_pos_control_reports_cashier_idx
  ON public.commerce_pos_control_reports (cashier_user_id, closed_at_device DESC);

COMMENT ON TABLE public.commerce_pos_control_reports IS
  'Rapport de controle genere automatiquement (jamais par le caissier), 1:1 avec sa cloture via la contrainte UNIQUE sur closure_id -- un retry de close_commerce_pos_cash_session ne peut jamais en produire un second.';

ALTER TABLE public.commerce_pos_control_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_pos_control_reports_read ON public.commerce_pos_control_reports
  FOR SELECT TO authenticated
  USING (public.user_has_permission('commerce.cash.reports.control') AND public.commerce_location_access_allowed(business_location_id));

REVOKE ALL ON TABLE public.commerce_pos_control_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.commerce_pos_control_reports TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Receptions physiques : une ligne par versement effectif au gestionnaire.
--    Plusieurs receptions successives peuvent viser le meme rapport tant que
--    leur somme ne depasse pas cash_expected -- c'est le mecanisme de
--    reliquat (section 6/14 de la mission). Chaque reception cree exactement
--    un mouvement finance_operations TRANSFER, jamais un second CA.
-- ---------------------------------------------------------------------------

CREATE TABLE public.commerce_pos_control_report_receptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.commerce_pos_control_reports(id) ON DELETE RESTRICT,
  reception_event_id text NOT NULL UNIQUE CHECK (length(reception_event_id) BETWEEN 8 AND 160),
  outstanding_before numeric(14, 2) NOT NULL CHECK (outstanding_before >= 0),
  received_amount numeric(14, 2) NOT NULL CHECK (received_amount > 0),
  source_wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  destination_wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL UNIQUE REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  note text,
  confirmed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (received_amount <= outstanding_before)
);

CREATE INDEX commerce_pos_control_report_receptions_report_idx
  ON public.commerce_pos_control_report_receptions (report_id, confirmed_at);

COMMENT ON TABLE public.commerce_pos_control_report_receptions IS
  'Une ligne = un versement physique reellement recu par le gestionnaire pour un rapport donne. Le reliquat encore du se calcule toujours comme report.cash_expected - somme(received_amount) pour ce report_id -- jamais stocke, toujours recalcule pour eviter toute derive.';

ALTER TABLE public.commerce_pos_control_report_receptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_pos_control_report_receptions_read ON public.commerce_pos_control_report_receptions
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission('commerce.cash.reports.control')
    AND EXISTS (
      SELECT 1 FROM public.commerce_pos_control_reports report_row
      WHERE report_row.id = report_id AND public.commerce_location_access_allowed(report_row.business_location_id)
    )
  );

REVOKE ALL ON TABLE public.commerce_pos_control_report_receptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.commerce_pos_control_report_receptions TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Cloture automatique : theorique unifie POS-06/06B, ventile par mode de
--    paiement, plus generation atomique du rapport. Aucune remise, aucune
--    ecriture Finance ici -- les ventes ont deja produit tout le CA/Finance
--    necessaire via create_commerce_cash_sale.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.close_commerce_pos_cash_session(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_cash_session_id text := NULLIF(btrim(p_event ->> 'cash_session_id'), '');
  v_event_id text := NULLIF(btrim(p_event ->> 'event_id'), '');
  v_terminal_id text := NULLIF(btrim(p_event ->> 'terminal_id'), '');
  v_location_id uuid := NULLIF(p_event ->> 'business_location_id', '')::uuid;
  v_claimed_user_id uuid := NULLIF(p_event ->> 'cashier_user_id', '')::uuid;
  v_opened_at_device timestamptz := NULLIF(p_event ->> 'opened_at_device', '')::timestamptz;
  v_closed_at_device timestamptz := coalesce(NULLIF(p_event ->> 'closed_at_device', '')::timestamptz, now());
  v_existing public.commerce_pos_cash_session_closures;
  v_existing_report public.commerce_pos_control_reports;
  v_pending_sales integer := 0;
  v_server_ticket_count integer := 0;
  v_server_article_total numeric(14, 2) := 0;
  v_server_service_total numeric(14, 2) := 0;
  v_server_cash_total numeric(14, 2) := 0;
  v_server_mobile_money_total numeric(14, 2) := 0;
  v_server_other_payment_total numeric(14, 2) := 0;
  v_article_quantity_total numeric(14, 3) := 0;
  v_closure public.commerce_pos_cash_session_closures;
  v_report public.commerce_pos_control_reports;
BEGIN
  PERFORM public.permission_require('commerce.cash.close');

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour clore une session de caisse.' USING ERRCODE = '42501';
  END IF;

  IF v_cash_session_id IS NULL OR v_cash_session_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_event_id IS NULL OR v_event_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_terminal_id IS NULL OR v_terminal_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_location_id IS NULL OR v_claimed_user_id IS NULL OR v_opened_at_device IS NULL THEN
    RAISE EXCEPTION 'Evenement de cloture de caisse invalide.' USING ERRCODE = '22023';
  END IF;

  IF v_claimed_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Le caissier de la cloture ne correspond pas a la session connectee.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Point de vente non autorise.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_location_id::text || ':cash-close:' || v_cash_session_id, 0));

  -- Idempotence forte : un retry (rechargement navigateur, reconnexion apres
  -- coupure) retombe toujours sur la meme cloture et le meme rapport, jamais
  -- un doublon -- la contrainte UNIQUE sur cash_session_id et sur
  -- commerce_pos_control_reports.closure_id le garantit au niveau base.
  SELECT * INTO v_existing
  FROM public.commerce_pos_cash_session_closures
  WHERE cash_session_id = v_cash_session_id;

  IF FOUND THEN
    IF v_existing.business_location_id <> v_location_id
      OR v_existing.cashier_user_id <> auth.uid()
      OR v_existing.terminal_id <> v_terminal_id THEN
      RAISE EXCEPTION 'Cette session de caisse possede deja une cloture differente.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_existing_report FROM public.commerce_pos_control_reports WHERE closure_id = v_existing.id;
    RETURN jsonb_build_object('closureId', v_existing.id, 'reportId', v_existing_report.id, 'status', v_existing.status);
  END IF;

  -- Meme garde que POS-04C : tous les tickets hors ligne de cette session
  -- doivent avoir fini de synchroniser avant de pouvoir clore -- jamais de
  -- cloture avant les ventes dont elle depend (risque a) de la mission).
  SELECT count(*) INTO v_pending_sales
  FROM public.commerce_pos_offline_receipts
  WHERE cash_session_id = v_cash_session_id
    AND business_location_id = v_location_id
    AND cashier_user_id = auth.uid()
    AND terminal_id = v_terminal_id
    AND status <> 'PROCESSED';

  IF v_pending_sales > 0 THEN
    RETURN jsonb_build_object(
      'closureId', NULL, 'reportId', NULL, 'status', 'PENDING_SALES',
      'errorCode', 'PENDING_SALES', 'errorMessage', 'La cloture attend encore des ventes a synchroniser.'
    );
  END IF;

  -- Theorique unifie POS-06/06B : toute vente confirmee rattachee a cette
  -- session, online ou offline synchronisee, ventilee par mode de paiement.
  -- Mobile Money (WAVE/JEKO) et autres modes ne sont jamais comptes comme
  -- espece physique (section 17/18 de la mission).
  SELECT
    count(*)::integer,
    COALESCE(sum(article_line.total), 0),
    COALESCE(sum(service_line.total), 0),
    COALESCE(sum(article_line.qty), 0),
    COALESCE(sum(operation.amount) FILTER (WHERE operation.payment_method = 'CASH'), 0),
    COALESCE(sum(operation.amount) FILTER (WHERE operation.payment_method IN ('WAVE', 'JEKO')), 0),
    COALESCE(sum(operation.amount) FILTER (WHERE operation.payment_method IN ('CARD', 'OTHER')), 0)
  INTO v_server_ticket_count, v_server_article_total, v_server_service_total, v_article_quantity_total,
    v_server_cash_total, v_server_mobile_money_total, v_server_other_payment_total
  FROM public.commercial_sales AS sale
  JOIN public.commercial_invoice_payments AS payment
    ON payment.sale_id = sale.id AND payment.status = 'CONFIRMED'
  JOIN public.finance_operations AS operation
    ON operation.module = 'COMMERCIAL_INVOICE_PAYMENT'
    AND operation.module_id = payment.id
    AND operation.status <> 'CANCELLED'
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
  WHERE sale.cash_session_id = v_cash_session_id
    AND sale.business_location_id = v_location_id
    AND sale.created_by = auth.uid()
    AND sale.status = 'CONFIRMED';

  -- Aucune ecriture Finance ici : les ventes l'ont deja fait. La cloture ne
  -- fait que constater et figer un theorique deja produit ailleurs.
  INSERT INTO public.commerce_pos_cash_session_closures (
    cash_session_id, closure_event_id, terminal_id, business_location_id, cashier_user_id,
    opened_at_device, closed_at_device, status, payload_hash, closure_kind,
    declared_ticket_count, declared_article_total, declared_service_total,
    declared_cash_total, declared_other_payment_total, declared_theoretical_cash,
    counted_cash, declared_difference, discrepancy_note,
    server_ticket_count, server_article_total, server_service_total,
    server_cash_total, server_mobile_money_total, server_other_payment_total, server_difference,
    totals_match, payload
  ) VALUES (
    v_cash_session_id, v_event_id, v_terminal_id, v_location_id, auth.uid(),
    v_opened_at_device, v_closed_at_device, 'SYNCED', md5(p_event::text), 'AUTOMATIC',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    v_server_ticket_count, v_server_article_total, v_server_service_total,
    v_server_cash_total, v_server_mobile_money_total, v_server_other_payment_total, NULL,
    NULL, p_event
  ) RETURNING * INTO v_closure;

  INSERT INTO public.commerce_pos_control_reports (
    closure_id, cash_session_id, terminal_id, business_location_id, cashier_user_id,
    opened_at_device, closed_at_device, ticket_count, article_revenue, service_revenue, total_revenue,
    article_quantity_total, cash_expected, mobile_money_total, other_payment_total, sync_status
  ) VALUES (
    v_closure.id, v_cash_session_id, v_terminal_id, v_location_id, auth.uid(),
    v_opened_at_device, v_closed_at_device, v_server_ticket_count, v_server_article_total, v_server_service_total,
    v_server_article_total + v_server_service_total,
    v_article_quantity_total, v_server_cash_total, v_server_mobile_money_total, v_server_other_payment_total,
    v_closure.status
  ) RETURNING * INTO v_report;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_POS_CASH_SESSION_CLOSE', v_closure.id, NULL, 'CREATE', NULL,
    jsonb_build_object(
      'event_type', 'CASH_SESSION_CLOSE_AUTOMATIC', 'cash_session_id', v_cash_session_id,
      'terminal_id', v_terminal_id, 'report_id', v_report.id, 'cash_expected', v_server_cash_total,
      'mobile_money_total', v_server_mobile_money_total, 'other_payment_total', v_server_other_payment_total
    )
  );

  RETURN jsonb_build_object('closureId', v_closure.id, 'reportId', v_report.id, 'status', v_closure.status);
END;
$function$;

REVOKE ALL ON FUNCTION public.close_commerce_pos_cash_session(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_commerce_pos_cash_session(jsonb) TO authenticated;

COMMENT ON FUNCTION public.close_commerce_pos_cash_session(jsonb) IS
  'Nouveau parcours caissier : aucune donnee declaree en entree, aucune remise, aucune ecriture Finance. Calcule le theorique unifie POS-06/06B par mode de paiement, cree la cloture (counted_cash reste NULL) et genere le rapport de controle 1:1. Idempotent par cash_session_id.';

-- ---------------------------------------------------------------------------
-- 5) Reception physique gestionnaire : plusieurs receptions successives
--    possibles contre le meme rapport, jamais au-dela du reliquat, chacune
--    idempotente et creant exactement un mouvement Finance TRANSFER.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_commerce_pos_cash_reception(
  p_report_id uuid,
  p_reception_event_id text,
  p_received_amount numeric,
  p_destination_wallet_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_report public.commerce_pos_control_reports;
  v_already_received numeric(14, 2);
  v_outstanding numeric(14, 2);
  v_source_wallet_id uuid;
  v_existing public.commerce_pos_control_report_receptions;
  v_operation public.finance_operations;
  v_reception public.commerce_pos_control_report_receptions;
  v_note text := NULLIF(btrim(p_note), '');
  v_event_id text := NULLIF(btrim(p_reception_event_id), '');
BEGIN
  PERFORM public.permission_require('commerce.cash.reports.confirm');
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour confirmer une reception.' USING ERRCODE = '42501';
  END IF;
  IF v_event_id IS NULL OR length(v_event_id) NOT BETWEEN 8 AND 160
    OR p_received_amount IS NULL OR p_received_amount <= 0
    OR p_destination_wallet_id IS NULL
    OR (v_note IS NOT NULL AND length(v_note) > 1000) THEN
    RAISE EXCEPTION 'Reception invalide.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report FROM public.commerce_pos_control_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rapport introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.commerce_location_access_allowed(v_report.business_location_id) THEN
    RAISE EXCEPTION 'Magasin non autorise.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('pos-reception:' || p_report_id::text, 0));

  -- Retry idempotent : le meme evenement renvoie le meme resultat, jamais un
  -- second mouvement Finance (risque c) de la mission).
  SELECT * INTO v_existing FROM public.commerce_pos_control_report_receptions WHERE reception_event_id = v_event_id;
  IF FOUND THEN
    IF v_existing.report_id <> p_report_id THEN
      RAISE EXCEPTION 'Identifiant de reception deja utilise pour un autre rapport.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'receptionId', v_existing.id, 'operationId', v_existing.operation_id,
      'receivedAmount', v_existing.received_amount, 'outstandingBefore', v_existing.outstanding_before,
      'remainingAfter', round(v_existing.outstanding_before - v_existing.received_amount, 2)
    );
  END IF;

  -- Le reliquat n'est jamais stocke : toujours recalcule depuis les
  -- receptions deja confirmees pour ce rapport, sous le verrou ci-dessus.
  SELECT coalesce(sum(received_amount), 0) INTO v_already_received
  FROM public.commerce_pos_control_report_receptions
  WHERE report_id = p_report_id;

  v_outstanding := round(v_report.cash_expected - v_already_received, 2);
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'Ce rapport est deja solde -- aucun montant restant a recevoir.' USING ERRCODE = '22023';
  END IF;
  IF round(p_received_amount, 2) > v_outstanding THEN
    RAISE EXCEPTION 'Le montant recu (%) depasse le reliquat encore du (%).', round(p_received_amount, 2), v_outstanding
      USING ERRCODE = '22023';
  END IF;

  SELECT mapping.wallet_id
  INTO v_source_wallet_id
  FROM public.business_location_wallets AS mapping
  WHERE mapping.business_location_id = v_report.business_location_id
    AND mapping.purpose = 'CASH_DRAWER' AND mapping.is_primary AND mapping.is_active
  ORDER BY mapping.assigned_at DESC
  LIMIT 1;
  IF v_source_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Aucun wallet de caisse principal actif pour ce magasin.' USING ERRCODE = '23503';
  END IF;

  IF p_destination_wallet_id = v_source_wallet_id
    OR NOT EXISTS (
      SELECT 1 FROM public.business_location_wallets AS mapping
      WHERE mapping.business_location_id = v_report.business_location_id
        AND mapping.wallet_id = p_destination_wallet_id
        AND mapping.is_active
        AND mapping.purpose IN ('COLLECTION', 'OPERATING')
    ) THEN
    RAISE EXCEPTION 'Wallet destination non autorise pour ce magasin.' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.wallets WHERE id IN (v_source_wallet_id, p_destination_wallet_id) ORDER BY id FOR UPDATE;

  -- Reutilise exactement le meme moteur Finance que POS-05
  -- (confirm_commerce_cash_remittance) : un TRANSFER, jamais un REVENUE --
  -- le CA existe deja, cette ecriture ne fait que deplacer de la tresorerie.
  INSERT INTO public.finance_operations (
    wallet_id, destination_wallet_id, type, amount, operation_date, category,
    description, reference, status, origin, module, module_id, notes, created_by
  ) VALUES (
    v_source_wallet_id, p_destination_wallet_id, 'TRANSFER', round(p_received_amount, 2), current_date,
    'REMISE DE CAISSE', 'Reception physique de caisse -- ' || v_report.cash_session_id,
    'POS-REPORT:' || v_report.id::text || ':' || v_event_id, 'VALIDE',
    'COMMERCE_POS_CONTROL_REPORT', 'COMMERCE_POS_CONTROL_REPORT', v_report.id, v_note, auth.uid()
  ) RETURNING * INTO v_operation;

  INSERT INTO public.commerce_pos_control_report_receptions (
    report_id, reception_event_id, outstanding_before, received_amount,
    source_wallet_id, destination_wallet_id, operation_id, note, confirmed_by
  ) VALUES (
    p_report_id, v_event_id, v_outstanding, round(p_received_amount, 2),
    v_source_wallet_id, p_destination_wallet_id, v_operation.id, v_note, auth.uid()
  ) RETURNING * INTO v_reception;

  PERFORM public.update_wallet_balance(v_source_wallet_id);
  PERFORM public.update_wallet_balance(p_destination_wallet_id);
  PERFORM public.business_finance_audit_event(
    'COMMERCE_POS_CONTROL_REPORT', v_report.id, v_operation.id, 'CONFIRM', NULL,
    jsonb_build_object(
      'reception_id', v_reception.id, 'received_amount', v_reception.received_amount,
      'outstanding_before', v_outstanding, 'remaining_after', round(v_outstanding - p_received_amount, 2)
    )
  );

  RETURN jsonb_build_object(
    'receptionId', v_reception.id, 'operationId', v_operation.id,
    'receivedAmount', v_reception.received_amount, 'outstandingBefore', v_outstanding,
    'remainingAfter', round(v_outstanding - p_received_amount, 2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_commerce_pos_cash_reception(uuid, text, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_commerce_pos_cash_reception(uuid, text, numeric, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.confirm_commerce_pos_cash_reception(uuid, text, numeric, uuid, text) IS
  'Action gestionnaire uniquement. Une ligne par versement physique reel ; plusieurs receptions successives peuvent solder le meme rapport tant que leur somme ne depasse jamais cash_expected. Ne cree jamais de CA/marge -- uniquement un TRANSFER de tresorerie, idempotent par reception_event_id.';

CREATE OR REPLACE FUNCTION public.flag_commerce_pos_control_report(p_report_id uuid, p_reason text)
RETURNS public.commerce_pos_control_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_report public.commerce_pos_control_reports;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  PERFORM public.permission_require('commerce.cash.reports.confirm');
  SELECT * INTO v_report FROM public.commerce_pos_control_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rapport introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.commerce_location_access_allowed(v_report.business_location_id) THEN
    RAISE EXCEPTION 'Magasin non autorise.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Motif de signalement obligatoire.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.commerce_pos_control_reports
  SET flagged_for_review = true, flagged_reason = v_reason, flagged_by = auth.uid(), flagged_at = now(), updated_at = now()
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_POS_CONTROL_REPORT', v_report.id, NULL, 'UPDATE', NULL, jsonb_build_object('flagged_reason', v_reason)
  );
  RETURN v_report;
END;
$function$;

REVOKE ALL ON FUNCTION public.flag_commerce_pos_control_report(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flag_commerce_pos_control_report(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Permissions : le caissier ne declare, ne valide et ne confirme plus
--    aucune remise (section 1 de la mission). commerce.cash.close reste au
--    caissier -- il declenche close_commerce_pos_cash_session, une action
--    differente (clore sa propre session) d'une decision financiere.
-- ---------------------------------------------------------------------------

DELETE FROM public.role_permissions
WHERE role = 'caissier' AND permission_code = 'commerce.cash.remittance.declare';

INSERT INTO public.permissions (code, module, action, description, sensitivity)
VALUES
  ('commerce.cash.reports.control', 'commerce', 'cash_reports_control', 'Consulter le centre de controle des clotures/rapports de caisse.', 'CRITICAL'),
  ('commerce.cash.reports.confirm', 'commerce', 'cash_reports_confirm', 'Confirmer une reception physique de caisse ou signaler un rapport a verifier.', 'CRITICAL')
ON CONFLICT (code) DO UPDATE
SET module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
    sensitivity = EXCLUDED.sensitivity, updated_at = now();

INSERT INTO public.role_permissions (role, permission_code)
SELECT grant_row.role::public.app_role, grant_row.permission_code
FROM (VALUES
  ('gestionnaire', 'commerce.cash.reports.control'), ('gestionnaire', 'commerce.cash.reports.confirm'),
  ('comptable', 'commerce.cash.reports.control'), ('comptable', 'commerce.cash.reports.confirm'),
  ('admin', 'commerce.cash.reports.control'), ('admin', 'commerce.cash.reports.confirm'),
  ('super_admin', 'commerce.cash.reports.control'), ('super_admin', 'commerce.cash.reports.confirm')
) AS grant_row(role, permission_code)
WHERE EXISTS (SELECT 1 FROM public.roles WHERE code = grant_row.role::public.app_role)
ON CONFLICT DO NOTHING;
