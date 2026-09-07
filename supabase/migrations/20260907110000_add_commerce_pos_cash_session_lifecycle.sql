-- CHANTIER CAISSE (2/4) : cycle de vie serveur d'une session de caisse
-- (OUVERTE -> FERMÉE), et rattachement du poste choisi à la chaîne
-- d'attribution déjà validée (terminal_id).
--
-- Constat du diagnostic : commerce_pos_cash_session_closures (20260812110000)
-- ne stocke QUE des sessions déjà closes -- aucune table "session ouverte"
-- n'existe. "Ouvrir" est donc aujourd'hui un événement 100% local, invisible
-- du serveur jusqu'à ce que la première vente synchronise. Impossible, en
-- l'état, de savoir côté serveur "ce poste est déjà ouvert par quelqu'un
-- d'autre" ou de permettre "reprendre ma propre session" -- exactement ce
-- que ce chantier demande.
--
-- Le chaînage self-consistency déjà validé et en production
-- (_internal_create_commerce_cash_sale_at, 20260814100000 -- "first sale
-- using a given cash_session_id wins on location/cashier/terminal ; every
-- subsequent sale/receipt must match") et le filtrage déjà register-aware
-- de get_commerce_pos_cash_session_preview (20260816090000, filtre déjà
-- cash_session_id ET terminal_id ET business_location_id ensemble) sont
-- réutilisés tels quels, à 100% : terminal_id devient l'UUID réel du poste
-- choisi (texte, aucun changement de colonne requis -- terminal_id est déjà
-- `text` partout, jamais une FK). Un magasin sans poste nommé configuré
-- continue d'envoyer l'identifiant ambiant du navigateur, strictement comme
-- aujourd'hui -- terminal_id ne devient PAS obligatoirement un UUID de
-- poste, il le devient seulement quand un poste a été choisi.

CREATE TABLE IF NOT EXISTS public.commerce_pos_cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id text NOT NULL UNIQUE,
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE RESTRICT,
  -- NULL = magasin sans poste nommé configuré (mode historique, préservé).
  cash_register_id uuid REFERENCES public.commerce_cash_registers(id) ON DELETE RESTRICT,
  terminal_id text NOT NULL,
  cashier_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  opened_at_device timestamptz NOT NULL,
  opened_at_server timestamptz NOT NULL DEFAULT now(),
  closed_at_server timestamptz,
  CHECK (length(cash_session_id) BETWEEN 8 AND 160),
  CHECK (length(terminal_id) BETWEEN 8 AND 160),
  CHECK (status = 'OPEN' OR closed_at_server IS NOT NULL)
);

-- Un seul poste ouvert à la fois -- tous cashiers confondus : c'est la règle
-- métier qui manquait (aujourd'hui, rien n'empêche deux caissiers de
-- partager silencieusement le même poste). Les magasins sans poste nommé
-- (cash_register_id NULL) ne sont volontairement PAS contraints ici : NULL
-- n'est jamais égal à NULL dans un index, donc aucun verrou serveur
-- nouveau n'apparaît pour eux -- comportement historique préservé à
-- l'identique tant qu'aucun poste n'a été créé pour ce magasin.
CREATE UNIQUE INDEX IF NOT EXISTS commerce_pos_cash_sessions_one_open_per_register_idx
  ON public.commerce_pos_cash_sessions(business_location_id, cash_register_id)
  WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS commerce_pos_cash_sessions_cashier_idx
  ON public.commerce_pos_cash_sessions(cashier_user_id, status);

ALTER TABLE public.commerce_pos_cash_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_pos_cash_sessions_read ON public.commerce_pos_cash_sessions;
CREATE POLICY commerce_pos_cash_sessions_read ON public.commerce_pos_cash_sessions
  FOR SELECT TO authenticated
  USING (public.commerce_location_access_allowed(business_location_id));

-- Conversion sûre d'un terminal_id texte vers un UUID de poste : un
-- terminal_id historique ("terminal-<uuid-v4>", préfixe inclus) n'est PAS un
-- UUID valide -- un ::uuid direct lèverait "invalid input syntax for type
-- uuid" et casserait toute requête de lecture qui en dépend. Le garde
-- regex rend la conversion totalement sûre (NULL si non conforme, jamais
-- d'exception), utilisable librement dans un LEFT JOIN d'affichage.
CREATE OR REPLACE FUNCTION public._internal_terminal_id_as_register_id(p_terminal_id text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_terminal_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN p_terminal_id::uuid
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.open_commerce_pos_cash_session(p_session jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_cash_session_id text := NULLIF(btrim(p_session ->> 'cash_session_id'), '');
  v_location_id uuid := NULLIF(p_session ->> 'business_location_id', '')::uuid;
  v_register_id uuid := NULLIF(p_session ->> 'cash_register_id', '')::uuid;
  v_terminal_id text := NULLIF(btrim(p_session ->> 'terminal_id'), '');
  v_opened_at_device timestamptz := NULLIF(p_session ->> 'opened_at_device', '')::timestamptz;
  v_existing public.commerce_pos_cash_sessions;
  v_busy public.commerce_pos_cash_sessions;
  v_busy_name text;
  v_session public.commerce_pos_cash_sessions;
BEGIN
  PERFORM public.permission_require('commerce.pos.sell');

  IF v_cash_session_id IS NULL OR v_cash_session_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_terminal_id IS NULL OR v_terminal_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_location_id IS NULL OR v_opened_at_device IS NULL THEN
    RAISE EXCEPTION 'Ouverture de session de caisse invalide.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce point de vente.' USING ERRCODE = '42501';
  END IF;

  IF v_register_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.commerce_cash_registers
    WHERE id = v_register_id AND business_location_id = v_location_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Poste de caisse introuvable pour ce magasin.' USING ERRCODE = '23503';
  END IF;

  IF NOT public._internal_commerce_pos_register_access(v_location_id, v_register_id) THEN
    RAISE EXCEPTION 'Ce poste de caisse ne vous est pas affecté.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_location_id::text || ':cash-open:' || coalesce(v_register_id::text, 'legacy:' || auth.uid()::text), 0
  ));

  -- Idempotence forte, même motif que declare_commerce_cash_remittance /
  -- close_commerce_pos_cash_session : un retry (rechargement, reprise après
  -- coupure) retombe toujours sur la même ligne, jamais un doublon.
  SELECT * INTO v_existing
  FROM public.commerce_pos_cash_sessions
  WHERE cash_session_id = v_cash_session_id;

  IF FOUND THEN
    IF v_existing.business_location_id <> v_location_id
      OR v_existing.cashier_user_id <> auth.uid()
      OR v_existing.terminal_id <> v_terminal_id THEN
      RAISE EXCEPTION 'Cet identifiant de session correspond déjà à une autre ouverture.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'id', v_existing.id, 'cashSessionId', v_existing.cash_session_id,
      'cashRegisterId', v_existing.cash_register_id, 'terminalId', v_existing.terminal_id,
      'status', v_existing.status, 'resumed', false, 'openedAtServer', v_existing.opened_at_server
    );
  END IF;

  -- Un poste nommé ne peut être ouvert que par une personne à la fois.
  -- Aucune contrainte équivalente pour un magasin sans poste (v_register_id
  -- NULL) -- comportement historique préservé, voir commentaire de l'index.
  IF v_register_id IS NOT NULL THEN
    SELECT * INTO v_busy
    FROM public.commerce_pos_cash_sessions
    WHERE business_location_id = v_location_id
      AND cash_register_id = v_register_id
      AND status = 'OPEN'
    FOR UPDATE;

    IF FOUND THEN
      IF v_busy.cashier_user_id = auth.uid() THEN
        -- Même caissier, nouvel identifiant local (ex. stockage local
        -- effacé) : on reprend la session déjà ouverte plutôt que d'en
        -- ouvrir une seconde en silence sur le même poste.
        RETURN jsonb_build_object(
          'id', v_busy.id, 'cashSessionId', v_busy.cash_session_id,
          'cashRegisterId', v_busy.cash_register_id, 'terminalId', v_busy.terminal_id,
          'status', v_busy.status, 'resumed', true, 'openedAtServer', v_busy.opened_at_server
        );
      END IF;

      SELECT coalesce(NULLIF(profile_row.full_name, ''), NULLIF(profile_row.username, ''), 'un autre collaborateur')
      INTO v_busy_name
      FROM public.profiles AS profile_row WHERE profile_row.id = v_busy.cashier_user_id;

      RETURN jsonb_build_object(
        'id', NULL, 'cashSessionId', NULL, 'status', 'REGISTER_BUSY',
        'errorCode', 'REGISTER_BUSY',
        'errorMessage', 'Ce poste de caisse est déjà ouvert par ' || v_busy_name || '.',
        'busyCashier', v_busy_name, 'busySince', v_busy.opened_at_server
      );
    END IF;
  END IF;

  INSERT INTO public.commerce_pos_cash_sessions(
    cash_session_id, business_location_id, cash_register_id, terminal_id, cashier_user_id, opened_at_device
  ) VALUES (
    v_cash_session_id, v_location_id, v_register_id, v_terminal_id, auth.uid(), v_opened_at_device
  ) RETURNING * INTO v_session;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_POS_CASH_SESSION', v_session.id, NULL, 'CREATE', NULL, to_jsonb(v_session)
  );

  RETURN jsonb_build_object(
    'id', v_session.id, 'cashSessionId', v_session.cash_session_id,
    'cashRegisterId', v_session.cash_register_id, 'terminalId', v_session.terminal_id,
    'status', v_session.status, 'resumed', false, 'openedAtServer', v_session.opened_at_server
  );
END;
$function$;

-- Extension de POS-04C/06 (close_commerce_pos_cash_session, dernière
-- définition déployée : 20260815100000) : ferme aussi la ligne de cycle de
-- vie ci-dessus, dans la même transaction. Reproduction intégrale -- la
-- seule ligne ajoutée est le bloc "Ajout" avant chaque RETURN ; aucune
-- logique de calcul de clôture existante n'est modifiée.
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
  v_totals record;
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

  SELECT * INTO v_existing
  FROM public.commerce_pos_cash_session_closures
  WHERE cash_session_id = v_cash_session_id;

  IF FOUND THEN
    IF v_existing.business_location_id <> v_location_id
      OR v_existing.cashier_user_id <> auth.uid()
      OR v_existing.terminal_id <> v_terminal_id THEN
      RAISE EXCEPTION 'Cette session de caisse possede deja une cloture differente.' USING ERRCODE = '22023';
    END IF;
    -- Ajout : la ligne de cycle de vie suit toujours l'état réel, même sur
    -- un simple replay (rejoue un retry qui avait échoué juste après ce
    -- point la première fois).
    UPDATE public.commerce_pos_cash_sessions
    SET status = 'CLOSED', closed_at_server = coalesce(closed_at_server, now())
    WHERE cash_session_id = v_cash_session_id AND status <> 'CLOSED';
    SELECT * INTO v_existing_report FROM public.commerce_pos_control_reports WHERE closure_id = v_existing.id;
    RETURN jsonb_build_object('closureId', v_existing.id, 'reportId', v_existing_report.id, 'status', v_existing.status);
  END IF;

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

  SELECT * INTO v_totals
  FROM public._internal_commerce_pos_session_commercial_totals(
    v_cash_session_id, v_terminal_id, v_location_id, auth.uid()
  );
  v_server_ticket_count := v_totals.ticket_count;
  v_server_article_total := v_totals.article_total;
  v_server_service_total := v_totals.service_total;
  v_article_quantity_total := v_totals.article_quantity_total;
  v_server_cash_total := v_totals.cash_total;
  v_server_mobile_money_total := v_totals.mobile_money_total;
  v_server_other_payment_total := v_totals.other_payment_total;

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

  -- Ajout : bascule la ligne de cycle de vie sur CLOSED. UPDATE simple (pas
  -- de FOR UPDATE nécessaire, déjà protégé par le verrou advisory ci-dessus)
  -- -- aucune ligne ne matche pour une session ouverte avant cette
  -- migration (open_commerce_pos_cash_session n'existait pas encore) : le
  -- WHERE ne trouve alors rien et l'UPDATE est un no-op silencieux, jamais
  -- une erreur.
  UPDATE public.commerce_pos_cash_sessions
  SET status = 'CLOSED', closed_at_server = now()
  WHERE cash_session_id = v_cash_session_id AND status <> 'CLOSED';

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

REVOKE ALL ON FUNCTION public._internal_terminal_id_as_register_id(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_commerce_pos_cash_session(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_commerce_pos_cash_session(jsonb) TO authenticated;
-- close_commerce_pos_cash_session : GRANT déjà accordé (CREATE OR REPLACE
-- préserve les privilèges), aucun re-GRANT nécessaire.
