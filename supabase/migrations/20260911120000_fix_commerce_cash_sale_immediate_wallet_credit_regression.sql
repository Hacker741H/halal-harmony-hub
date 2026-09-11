-- P0 : une vente caisse credite de nouveau immediatement un wallet -- exactement
-- le comportement que 20260815100000_defer_commerce_pos_wallet_entry_to_reception
-- avait deliberement supprime le 15 aout ("le circuit devient strictement :
-- vente -> cloture (aucune ecriture Finance) -> confirmation gestionnaire, seul
-- point qui materialise la tresorerie").
--
-- CAUSE EXACTE (confirmee par lecture directe des migrations, pas par
-- supposition) : la migration de cette meme session,
-- 20260911100000_add_commerce_sales_price_override.sql, a redefini
-- _internal_create_commerce_cash_sale_at en repartant d'une copie perimee de
-- la fonction (anterieure au 15 aout, probablement 20260814140000) au lieu de
-- la definition reellement live (celle laissee par
-- 20260819100000_unify_commercial_sale_stock_engine.sql). Consequence : cette
-- redefinition a silencieusement reintroduit :
--   1) la declaration v_operation public.finance_operations ;
--   2) le retry-lookup rejoignant de nouveau finance_operations /
--      finance_commercial_invoice_payment_links ;
--   3) surtout, un INSERT INTO finance_operations(..., 'REVENUE', v_total, ...)
--      immediatement apres la vente, suivi de PERFORM update_wallet_balance
--      -- exactement la reintroduction du credit immediat que le 15 aout avait
--      retiree ;
--   4) au passage, la colonne payment_method a disparu de l'INSERT INTO
--      commercial_invoice_payments (presente dans la version live depuis le
--      15 aout) -- sans consequence immediate visible car
--      _internal_commerce_pos_session_commercial_totals (20260815110000)
--      retombe sur un repli qui lit cette meme finance_operations reintroduite
--      via module/module_id, mais cette dependance disparait avec elle : il
--      faut donc la restaurer ici pour que la cloture de caisse continue de
--      ventiler correctement especes/mobile money/autre pour toute vente
--      future.
--
-- Preuve en production (lecture seule, avant ce correctif) : la vente reelle
-- effectuee en CAISSE MARIAM (wallet 7e9ebf9d-7ebf-422c-88d0-623a817cc3ff, a
-- MAGASIN MARIAM) le 2026-09-11 13:49:40 UTC a bien cree une finance_operation
-- (id 855762e7-c2d3-493b-8dcd-4cc89f14b444, type REVENUE, montant 118500,
-- categorie 'VENTE MAGASIN') au moment meme de la vente -- avant toute
-- cloture et avant toute validation gestionnaire. Cette ligne n'est PAS
-- touchee par la presente migration (aucune suppression/annulation
-- improvisee) : elle est laissee intacte, en attente d'une decision explicite
-- sur sa correction comptable.
--
-- CORRECTIF STRICTEMENT CIBLE : restaure l'etat exact laisse par
-- 20260819100000 pour tout ce qui touche Finance/wallet (aucune ecriture
-- finance_operations a la vente, payment_method renseigne, operationId
-- toujours NULL dans la reponse) -- CREATE OR REPLACE avec la meme
-- signature (aucun grant a refaire). Le reste de la fonction (stock,
-- override de prix, plancher catalogue, permission commerce.sales.price_
-- override) reste identique a la version actuellement live : rien d'autre
-- n'est modifie. Le circuit de creation reste partage par create_commerce_
-- cash_sale (en ligne) ET sync_commerce_pos_offline_sale (hors ligne
-- resynchronisee) -- les deux appellent cette meme fonction interne, donc ce
-- seul correctif protege les deux, comme deja note par 20260911100000.
CREATE OR REPLACE FUNCTION public._internal_create_commerce_cash_sale_at(p_sale jsonb, p_effective_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_location_id uuid := NULLIF(p_sale ->> 'business_location_id', '')::uuid;
  v_client_id uuid := NULLIF(p_sale ->> 'client_id', '')::uuid;
  v_wallet_id uuid;
  v_payment_method text := upper(coalesce(NULLIF(btrim(p_sale ->> 'payment_method'), ''), 'CASH'));
  v_reference text := NULLIF(btrim(p_sale ->> 'reference'), '');
  v_notes text := NULLIF(btrim(p_sale ->> 'notes'), '');
  v_cash_session_id text := NULLIF(btrim(p_sale ->> 'cash_session_id'), '');
  v_terminal_id text := NULLIF(btrim(p_sale ->> 'terminal_id'), '');
  v_prior_location_id uuid;
  v_prior_cashier_id uuid;
  v_prior_terminal_id text;
  v_prior_found boolean;
  v_sale public.commercial_sales;
  v_invoice public.commercial_invoices;
  v_payment public.commercial_invoice_payments;
  v_client public.transport_clients;
  v_line jsonb;
  v_item public.inventory_items;
  v_local public.business_location_inventory_items;
  v_line_id uuid;
  v_quantity numeric(14,3);
  v_price numeric(14,2);
  v_requested_quantity numeric(14,3);
  v_total numeric(14,2) := 0;
  v_stock_movement public.stock_movements;
  v_client_label text := 'Client comptoir';
  v_line_type text;
  v_service_name text;
  v_service_note text;
  v_existing_sale_id uuid;
  v_existing_invoice_number text;
  v_existing_payment_id uuid;
  v_existing_amount numeric(14,2);
  v_floor_price numeric(14,2);
BEGIN
  PERFORM public.permission_require('commerce.pos.sell');

  IF p_sale IS NULL
    OR jsonb_typeof(p_sale) <> 'object'
    OR jsonb_typeof(p_sale -> 'lines') <> 'array'
    OR jsonb_array_length(p_sale -> 'lines') = 0 THEN
    RAISE EXCEPTION 'La vente caisse doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;

  IF p_effective_at IS NULL THEN
    RAISE EXCEPTION 'Date d''effet de vente invalide.' USING ERRCODE = '22023';
  END IF;

  IF v_location_id IS NULL OR NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Point de vente non autorisé.' USING ERRCODE = '42501';
  END IF;

  -- Un retry pour le meme ticket persiste retourne son recu original. Ceci
  -- s'execute avant toute mutation stock, facture ou paiement. Detecte
  -- directement depuis les ventes/paiements commerciaux -- ne depend plus de
  -- finance_operations, qui ne recoit plus rien au moment de la vente.
  IF v_reference IS NOT NULL AND v_reference LIKE 'POS:%' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_location_id::text || ':' || v_reference, 0));

    SELECT sale.id, invoice.invoice_number, payment.id, payment.amount
    INTO v_existing_sale_id, v_existing_invoice_number, v_existing_payment_id, v_existing_amount
    FROM public.commercial_sales AS sale
    JOIN public.commercial_invoices AS invoice ON invoice.sale_id = sale.id
    JOIN public.commercial_invoice_payments AS payment ON payment.sale_id = sale.id AND payment.status = 'CONFIRMED'
    WHERE sale.business_location_id = v_location_id
      AND sale.reference = v_reference
      AND sale.status = 'CONFIRMED'
    ORDER BY payment.confirmed_at DESC NULLS LAST, payment.created_at DESC
    LIMIT 1;

    IF v_existing_sale_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'saleId', v_existing_sale_id,
        'saleNumber', (SELECT sale_number FROM public.commercial_sales WHERE id = v_existing_sale_id),
        'invoiceNumber', v_existing_invoice_number,
        'paymentId', v_existing_payment_id,
        'operationId', NULL,
        'amount', v_existing_amount
      );
    END IF;
  END IF;

  -- POS-06 session/terminal attribution. Never trusted blindly: re-validated
  -- against any prior sale or offline receipt already using this session id.
  IF (v_cash_session_id IS NULL) <> (v_terminal_id IS NULL) THEN
    RAISE EXCEPTION 'La session de caisse et le terminal doivent être fournis ensemble.' USING ERRCODE = '22023';
  END IF;

  IF v_cash_session_id IS NOT NULL THEN
    IF v_cash_session_id !~ '^[A-Za-z0-9_-]{8,160}$' OR v_terminal_id !~ '^[A-Za-z0-9_-]{8,160}$' THEN
      RAISE EXCEPTION 'Identifiant de session ou de terminal invalide.' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.commerce_pos_cash_session_closures closure_row
      WHERE closure_row.cash_session_id = v_cash_session_id
    ) THEN
      RAISE EXCEPTION 'Cette session de caisse est déjà clôturée.' USING ERRCODE = '22023';
    END IF;

    SELECT sale.business_location_id, sale.created_by, sale.terminal_id
    INTO v_prior_location_id, v_prior_cashier_id, v_prior_terminal_id
    FROM public.commercial_sales AS sale
    WHERE sale.cash_session_id = v_cash_session_id
    LIMIT 1;
    v_prior_found := FOUND;

    IF NOT v_prior_found THEN
      SELECT receipt.business_location_id, receipt.cashier_user_id, receipt.terminal_id
      INTO v_prior_location_id, v_prior_cashier_id, v_prior_terminal_id
      FROM public.commerce_pos_offline_receipts AS receipt
      WHERE receipt.cash_session_id = v_cash_session_id
      LIMIT 1;
      v_prior_found := FOUND;
    END IF;

    IF v_prior_found AND (
      v_prior_location_id IS DISTINCT FROM v_location_id
      OR v_prior_cashier_id IS DISTINCT FROM auth.uid()
      OR v_prior_terminal_id IS DISTINCT FROM v_terminal_id
    ) THEN
      RAISE EXCEPTION 'Cette session de caisse appartient à un autre magasin, caissier ou terminal.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT location_wallet.wallet_id
  INTO v_wallet_id
  FROM public.business_location_wallets AS location_wallet
  WHERE location_wallet.business_location_id = v_location_id
    AND location_wallet.purpose = 'CASH_DRAWER'
    AND location_wallet.is_active
    AND location_wallet.is_primary
  ORDER BY location_wallet.assigned_at DESC
  LIMIT 1;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Aucun wallet principal de caisse n’est configuré pour ce point de vente.' USING ERRCODE = '23503';
  END IF;

  IF v_client_id IS NOT NULL THEN
    SELECT * INTO v_client
    FROM public.transport_clients
    WHERE id = v_client_id AND status = 'ACTIVE';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Client actif introuvable.' USING ERRCODE = '23503';
    END IF;
    v_client_label := v_client.display_name;
  END IF;

  IF v_payment_method NOT IN ('CASH', 'WAVE', 'JEKO', 'CARD', 'OTHER') THEN
    RAISE EXCEPTION 'Moyen de paiement invalide.' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_sale -> 'lines') LOOP
    v_line_type := upper(coalesce(NULLIF(btrim(v_line ->> 'line_type'), ''), 'ARTICLE'));
    v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric;
    v_price := NULLIF(v_line ->> 'unit_price', '')::numeric;

    IF v_quantity IS NULL OR v_quantity <= 0 OR v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'Quantité ou prix de vente invalide.' USING ERRCODE = '22023';
    END IF;

    IF v_line_type = 'ARTICLE' THEN
      -- OVERRIDE PRIX DE VENTE (20260911100000, inchange) : un article
      -- catalogue se vend toujours a un prix strictement positif, avec ou
      -- sans permission de baisse.
      IF v_price <= 0 THEN
        RAISE EXCEPTION 'Le prix de vente doit être strictement supérieur à 0.' USING ERRCODE = '22023';
      END IF;

      SELECT * INTO v_local
      FROM public.business_location_inventory_items
      WHERE business_location_id = v_location_id
        AND inventory_item_id = NULLIF(v_line ->> 'inventory_item_id', '')::uuid
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Article indisponible dans ce magasin.' USING ERRCODE = '22023';
      END IF;

      -- Prix plancher : jamais celui envoyé par le client. La borne
      -- appliquée est celle en vigueur à p_effective_at (maintenant en
      -- ligne ; l'horodatage de la vente hors ligne originale lors d'une
      -- resynchronisation) -- jamais celle du jour si la vente a réellement
      -- eu lieu avant une hausse de prix ultérieure.
      SELECT history.sale_price INTO v_floor_price
      FROM public.business_location_inventory_item_price_history AS history
      WHERE history.business_location_id = v_location_id
        AND history.inventory_item_id = v_local.inventory_item_id
        AND history.effective_from <= p_effective_at
      ORDER BY history.effective_from DESC
      LIMIT 1;

      -- OVERRIDE PRIX DE VENTE (20260911100000, inchange) : seule une
      -- permission explicite autorise un prix sous ce plancher.
      IF v_floor_price IS NOT NULL AND v_price < v_floor_price
        AND NOT public.user_has_permission('commerce.sales.price_override') THEN
        RAISE EXCEPTION 'Le prix de vente ne peut pas être inférieur au prix catalogue de % FCFA.', v_floor_price USING ERRCODE = '22023';
      END IF;

      SELECT coalesce(sum((source_line.value ->> 'quantity')::numeric), 0)
      INTO v_requested_quantity
      FROM jsonb_array_elements(p_sale -> 'lines') AS source_line(value)
      WHERE upper(coalesce(NULLIF(btrim(source_line.value ->> 'line_type'), ''), 'ARTICLE')) = 'ARTICLE'
        AND source_line.value ->> 'inventory_item_id' = v_line ->> 'inventory_item_id';

      IF v_local.quantity < v_requested_quantity THEN
        RAISE EXCEPTION 'Quantité indisponible dans ce magasin.' USING ERRCODE = '22023';
      END IF;
    ELSIF v_line_type = 'SERVICE' THEN
      v_service_name := NULLIF(btrim(coalesce(v_line ->> 'service_name', v_line ->> 'description')), '');
      v_service_note := NULLIF(btrim(v_line ->> 'service_note'), '');
      IF v_service_name IS NULL OR length(v_service_name) > 160 OR length(coalesce(v_service_note, '')) > 1000
        OR NULLIF(v_line ->> 'inventory_item_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'Service invalide : désignation, note ou source article non conforme.' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'Type de ligne caisse invalide.' USING ERRCODE = '22023';
    END IF;

    v_total := v_total + round(v_quantity * v_price, 2);
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Le total de la vente doit être strictement positif.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.commercial_sales (
    sale_number, status, client_id, sale_date, reference, notes,
    business_unit_id, business_location_id, created_by, updated_by, confirmed_at,
    cash_session_id, terminal_id
  )
  SELECT public._internal_next_commercial_sale_number(), 'CONFIRMED', v_client_id,
    current_date, v_reference, v_notes, unit_row.id, v_location_id,
    auth.uid(), auth.uid(), now(), v_cash_session_id, v_terminal_id
  FROM public.business_locations AS location_row
  JOIN public.business_units AS unit_row ON unit_row.id = location_row.business_unit_id
  WHERE location_row.id = v_location_id
  RETURNING * INTO v_sale;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_sale -> 'lines') LOOP
    v_line_type := upper(coalesce(NULLIF(btrim(v_line ->> 'line_type'), ''), 'ARTICLE'));
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_price := (v_line ->> 'unit_price')::numeric;

    IF v_line_type = 'ARTICLE' THEN
      SELECT * INTO v_item FROM public.inventory_items WHERE id = (v_line ->> 'inventory_item_id')::uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Article introuvable.' USING ERRCODE = '23503';
      END IF;

      SELECT history.sale_price INTO v_floor_price
      FROM public.business_location_inventory_item_price_history AS history
      WHERE history.business_location_id = v_location_id
        AND history.inventory_item_id = v_item.id
        AND history.effective_from <= p_effective_at
      ORDER BY history.effective_from DESC
      LIMIT 1;

      INSERT INTO public.commercial_sale_lines (
        sale_id, line_type, description, quantity, unit, unit_price, line_total, inventory_item_id, catalog_price_at_sale
      ) VALUES (
        v_sale.id, 'ARTICLE', v_item.nom, v_quantity, coalesce(v_item.unite, 'UNITE'),
        v_price, round(v_quantity * v_price, 2), v_item.id, v_floor_price
      ) RETURNING id INTO v_line_id;

      UPDATE public.business_location_inventory_items
      SET quantity = quantity - v_quantity, updated_at = now()
      WHERE business_location_id = v_location_id AND inventory_item_id = v_item.id;

      UPDATE public.inventory_items
      SET stock_actuel = stock_actuel - v_quantity, updated_at = now()
      WHERE id = v_item.id;

      INSERT INTO public.stock_movements (
        inventory_item_id, movement_type, quantity, unit_price, wallet_id,
        movement_date, client, reference, description, status, created_by, business_location_id
      ) VALUES (
        v_item.id, 'SALE', v_quantity, v_price, v_wallet_id, current_date,
        v_client_label, v_sale.sale_number, 'Vente caisse ' || v_sale.sale_number,
        'VALID', auth.uid(), v_location_id
      ) RETURNING * INTO v_stock_movement;

      INSERT INTO public.commercial_sale_stock_movement_links (sale_line_id, stock_movement_id)
      VALUES (v_line_id, v_stock_movement.id);
    ELSE
      v_service_name := NULLIF(btrim(coalesce(v_line ->> 'service_name', v_line ->> 'description')), '');
      v_service_note := NULLIF(btrim(v_line ->> 'service_note'), '');
      INSERT INTO public.commercial_sale_lines (
        sale_id, line_type, description, quantity, unit, unit_price, line_total, service_note
      ) VALUES (
        v_sale.id, 'SERVICE', v_service_name, v_quantity, 'SERVICE',
        v_price, round(v_quantity * v_price, 2), v_service_note
      );
    END IF;
  END LOOP;

  INSERT INTO public.commercial_invoices (
    invoice_number, sale_id, client_id, status, issue_date, issued_at,
    subtotal_amount, tax_rate, tax_amount, total_amount, created_by, updated_by
  ) VALUES (
    public._internal_next_commercial_invoice_number(), v_sale.id, v_client_id,
    'PAID', current_date, now(), v_total, 0, 0, v_total, auth.uid(), auth.uid()
  ) RETURNING * INTO v_invoice;

  -- Le paiement decrit comment la vente a ete encaissee (wallet + mode de
  -- paiement) -- c'est un objet commercial, pas une ecriture Finance.
  -- Aucune ecriture finance_operations n'est creee ici : la vente ne touche
  -- plus jamais un wallet. Le CA/la marge/le stock restent intacts
  -- (commercial_sales/commercial_sale_lines/stock_movements), seule la
  -- confirmation gestionnaire (confirm_commerce_pos_cash_reception) credite
  -- le wallet, pour le montant reellement recu. payment_method restaure ici
  -- (avait disparu par erreur dans 20260911100000) : necessaire pour que
  -- _internal_commerce_pos_session_commercial_totals (20260815110000)
  -- ventile correctement especes/mobile money/autre a la cloture, sans
  -- dependre d'un repli sur une finance_operation qui, desormais, n'existe
  -- plus jamais pour une vente posterieure a ce correctif.
  INSERT INTO public.commercial_invoice_payments (
    invoice_id, sale_id, wallet_id, amount, payment_date, status, payment_kind,
    payment_method, reference, notes, created_by, updated_by, confirmed_at
  ) VALUES (
    v_invoice.id, v_sale.id, v_wallet_id, v_total, current_date, 'CONFIRMED',
    'PAYMENT', v_payment_method, coalesce(v_reference, v_sale.sale_number), v_notes,
    auth.uid(), auth.uid(), now()
  ) RETURNING * INTO v_payment;

  PERFORM public.business_finance_audit_event(
    'COMMERCIAL_SALE', v_sale.id, NULL, 'CREATE', NULL,
    jsonb_build_object('sale', to_jsonb(v_sale), 'invoice', to_jsonb(v_invoice), 'payment', to_jsonb(v_payment))
  );

  RETURN jsonb_build_object(
    'saleId', v_sale.id,
    'saleNumber', v_sale.sale_number,
    'invoiceNumber', v_invoice.invoice_number,
    'paymentId', v_payment.id,
    'operationId', NULL,
    'amount', v_total
  );
END;
$function$;

COMMENT ON FUNCTION public._internal_create_commerce_cash_sale_at(jsonb, timestamptz) IS
  'Coeur de la vente caisse (online et hors-ligne synchronisee). N''ecrit jamais dans finance_operations -- le CA/la marge/le stock restent visibles via commercial_sales/commercial_sale_lines/stock_movements, mais aucun wallet n''est credite a la vente. Seule confirm_commerce_pos_cash_reception, au moment de la cloture confirmee par un gestionnaire, materialise une ecriture de tresorerie. Inclut l''override de prix par permission commerce.sales.price_override (20260911100000, inchange par ce correctif) : plancher catalogue par defaut, prix toujours strictement positif.';
