-- CC-01: common commercial foundation for agricultural and merchandise sales.
-- Transport invoices remain in their dedicated tables.  This migration only
-- introduces the credit-sale cycle for non-transport activities.

CREATE SEQUENCE IF NOT EXISTS public.commercial_sale_number_sequence AS bigint START WITH 1;
CREATE SEQUENCE IF NOT EXISTS public.commercial_invoice_number_sequence AS bigint START WITH 1;

CREATE TABLE IF NOT EXISTS public.commercial_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'DRAFT',
  client_id uuid NOT NULL REFERENCES public.transport_clients(id) ON DELETE RESTRICT,
  farm_id uuid REFERENCES public.farms(id) ON DELETE RESTRICT,
  sale_date date NOT NULL DEFAULT current_date,
  reference text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_sales_status_check CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED', 'ARCHIVED'))
);

CREATE TABLE IF NOT EXISTS public.commercial_sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.commercial_sales(id) ON DELETE RESTRICT,
  description text NOT NULL,
  quantity numeric(14, 3) NOT NULL,
  unit text NOT NULL DEFAULT 'UNITE',
  unit_price numeric(14, 2) NOT NULL,
  line_total numeric(14, 2) NOT NULL,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  harvest_id uuid REFERENCES public.harvests(id) ON DELETE RESTRICT,
  farm_id uuid REFERENCES public.farms(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_sale_lines_description_check CHECK (btrim(description) <> ''),
  CONSTRAINT commercial_sale_lines_quantity_check CHECK (quantity > 0),
  CONSTRAINT commercial_sale_lines_unit_check CHECK (btrim(unit) <> ''),
  CONSTRAINT commercial_sale_lines_price_check CHECK (unit_price >= 0),
  CONSTRAINT commercial_sale_lines_total_check CHECK (line_total = round(quantity * unit_price, 2)),
  CONSTRAINT commercial_sale_lines_one_source_check CHECK (
    NOT (inventory_item_id IS NOT NULL AND harvest_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.commercial_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  sale_id uuid NOT NULL REFERENCES public.commercial_sales(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.transport_clients(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'DRAFT',
  issue_date date,
  due_date date,
  subtotal_amount numeric(14, 2) NOT NULL,
  tax_rate numeric(5, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(14, 2) NOT NULL DEFAULT 0,
  total_amount numeric(14, 2) NOT NULL,
  notes text,
  cancellation_reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_invoices_status_check CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')),
  CONSTRAINT commercial_invoices_amount_check CHECK (
    subtotal_amount >= 0 AND tax_rate >= 0 AND tax_rate <= 100 AND tax_amount >= 0
    AND total_amount = round(subtotal_amount + tax_amount, 2)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_invoices_one_active_per_sale_idx
  ON public.commercial_invoices(sale_id) WHERE status <> 'CANCELLED';

CREATE TABLE IF NOT EXISTS public.commercial_invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.commercial_invoices(id) ON DELETE RESTRICT,
  sale_id uuid NOT NULL REFERENCES public.commercial_sales(id) ON DELETE RESTRICT,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL,
  payment_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'PLANNED',
  payment_kind text NOT NULL DEFAULT 'PAYMENT',
  reference text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_invoice_payments_amount_check CHECK (amount > 0),
  CONSTRAINT commercial_invoice_payments_status_check CHECK (status IN ('PLANNED', 'RECEIVED', 'CONFIRMED', 'CANCELLED')),
  CONSTRAINT commercial_invoice_payments_kind_check CHECK (payment_kind IN ('DEPOSIT', 'PAYMENT', 'SETTLEMENT', 'REFUND'))
);

CREATE TABLE IF NOT EXISTS public.finance_commercial_invoice_payment_links (
  payment_id uuid NOT NULL REFERENCES public.commercial_invoice_payments(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  link_type text NOT NULL DEFAULT 'PAYMENT',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id, operation_id),
  CONSTRAINT finance_commercial_invoice_payment_links_type_check CHECK (link_type IN ('PAYMENT', 'REVERSAL')),
  CONSTRAINT finance_commercial_invoice_payment_links_once_per_type UNIQUE (payment_id, link_type)
);

-- CC-01 records the intended explicit stock relation.  The physical stock
-- release will be activated with the dedicated Stock sales workflow (CC-04),
-- rather than creating an immediate cash SALE movement for a credit sale.
CREATE TABLE IF NOT EXISTS public.commercial_sale_stock_movement_links (
  sale_line_id uuid NOT NULL REFERENCES public.commercial_sale_lines(id) ON DELETE RESTRICT,
  stock_movement_id uuid NOT NULL REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sale_line_id, stock_movement_id),
  CONSTRAINT commercial_sale_stock_movement_once_per_line UNIQUE (sale_line_id)
);

CREATE TABLE IF NOT EXISTS public.document_commercial_sale_links (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  sale_id uuid NOT NULL REFERENCES public.commercial_sales(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (document_id, sale_id)
);

CREATE INDEX IF NOT EXISTS commercial_sales_client_date_idx
  ON public.commercial_sales(client_id, sale_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS commercial_sales_status_date_idx
  ON public.commercial_sales(status, sale_date DESC);
CREATE INDEX IF NOT EXISTS commercial_sales_farm_date_idx
  ON public.commercial_sales(farm_id, sale_date DESC) WHERE farm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commercial_sale_lines_sale_idx
  ON public.commercial_sale_lines(sale_id, created_at);
CREATE INDEX IF NOT EXISTS commercial_sale_lines_inventory_item_idx
  ON public.commercial_sale_lines(inventory_item_id) WHERE inventory_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commercial_sale_lines_harvest_idx
  ON public.commercial_sale_lines(harvest_id) WHERE harvest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commercial_invoices_client_due_idx
  ON public.commercial_invoices(client_id, due_date ASC) WHERE status IN ('ISSUED', 'PARTIALLY_PAID');
CREATE INDEX IF NOT EXISTS commercial_invoices_sale_idx
  ON public.commercial_invoices(sale_id, status, issue_date DESC);
CREATE INDEX IF NOT EXISTS commercial_invoice_payments_invoice_date_idx
  ON public.commercial_invoice_payments(invoice_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS commercial_invoice_payments_wallet_date_idx
  ON public.commercial_invoice_payments(wallet_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS finance_commercial_invoice_payment_links_operation_idx
  ON public.finance_commercial_invoice_payment_links(operation_id);
CREATE INDEX IF NOT EXISTS document_commercial_sale_links_sale_idx
  ON public.document_commercial_sale_links(sale_id, document_id);

INSERT INTO public.permissions(code, module, action, description, sensitivity)
VALUES
  ('sales.read', 'sales', 'read', 'Consulter les ventes commerciales autorisées.', 'SENSITIVE'),
  ('sales.create', 'sales', 'create', 'Créer des ventes commerciales brouillon.', 'SENSITIVE'),
  ('sales.update', 'sales', 'update', 'Modifier et confirmer les ventes commerciales.', 'SENSITIVE'),
  ('sales.cancel', 'sales', 'cancel', 'Annuler une vente ou une facture commerciale selon les règles.', 'CRITICAL'),
  ('sales.invoice', 'sales', 'invoice', 'Créer et émettre les factures commerciales.', 'CRITICAL'),
  ('sales.payments', 'sales', 'payments', 'Enregistrer et confirmer les paiements commerciaux.', 'CRITICAL'),
  ('sales.finance.read', 'sales', 'financial_read', 'Consulter les montants facturés, encaissés et dus.', 'CRITICAL')
ON CONFLICT (code) DO UPDATE
SET module = EXCLUDED.module,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    sensitivity = EXCLUDED.sensitivity,
    updated_at = now();

INSERT INTO public.role_permissions(role, permission_code)
SELECT grant_row.role::public.app_role, grant_row.permission_code
FROM (VALUES
  ('admin', 'sales.read'), ('admin', 'sales.create'), ('admin', 'sales.update'), ('admin', 'sales.cancel'), ('admin', 'sales.invoice'), ('admin', 'sales.payments'), ('admin', 'sales.finance.read'),
  ('comptable', 'sales.read'), ('comptable', 'sales.invoice'), ('comptable', 'sales.payments'), ('comptable', 'sales.finance.read'),
  ('gestionnaire', 'sales.read'), ('gestionnaire', 'sales.create'), ('gestionnaire', 'sales.update'), ('gestionnaire', 'sales.invoice'), ('gestionnaire', 'sales.payments'), ('gestionnaire', 'sales.finance.read'),
  ('exploitations', 'sales.read'), ('exploitations', 'sales.create'), ('exploitations', 'sales.update'),
  ('stocks', 'sales.read'), ('stocks', 'sales.create'), ('stocks', 'sales.update'),
  ('operations', 'sales.read'),
  ('lecture_seule', 'sales.read')
) AS grant_row(role, permission_code)
WHERE EXISTS (SELECT 1 FROM public.roles WHERE code = grant_row.role::public.app_role)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public._internal_next_commercial_sale_number()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT format(
    'VTE-%s-%s',
    to_char(current_date, 'YYYY'),
    lpad(nextval('public.commercial_sale_number_sequence')::text, 6, '0')
  );
$function$;

CREATE OR REPLACE FUNCTION public._internal_next_commercial_invoice_number()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT format(
    'FAC-%s-%s',
    to_char(current_date, 'YYYY'),
    lpad(nextval('public.commercial_invoice_number_sequence')::text, 6, '0')
  );
$function$;

CREATE OR REPLACE FUNCTION public._internal_upsert_commercial_sale_lines(
  p_sale_id uuid,
  p_lines jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_line jsonb;
  v_count integer := 0;
  v_description text;
  v_quantity numeric(14, 3);
  v_unit text;
  v_unit_price numeric(14, 2);
  v_inventory_item_id uuid;
  v_harvest_id uuid;
  v_farm_id uuid;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Une vente doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.commercial_sale_lines WHERE sale_id = p_sale_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF jsonb_typeof(v_line) <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_line) AS key_name
      WHERE key_name NOT IN ('description', 'quantity', 'unit', 'unit_price', 'inventory_item_id', 'harvest_id', 'farm_id')
    ) THEN
      RAISE EXCEPTION 'Une ligne de vente contient une propriété non autorisée.' USING ERRCODE = '22023';
    END IF;

    v_description := NULLIF(btrim(v_line ->> 'description'), '');
    v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric;
    v_unit := COALESCE(NULLIF(btrim(v_line ->> 'unit'), ''), 'UNITE');
    v_unit_price := NULLIF(v_line ->> 'unit_price', '')::numeric;
    v_inventory_item_id := NULLIF(v_line ->> 'inventory_item_id', '')::uuid;
    v_harvest_id := NULLIF(v_line ->> 'harvest_id', '')::uuid;
    v_farm_id := NULLIF(v_line ->> 'farm_id', '')::uuid;

    IF v_description IS NULL OR v_quantity IS NULL OR v_quantity <= 0 OR v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Chaque ligne doit posséder un libellé, une quantité positive et un prix unitaire valide.' USING ERRCODE = '22023';
    END IF;
    IF v_inventory_item_id IS NOT NULL AND v_harvest_id IS NOT NULL THEN
      RAISE EXCEPTION 'Une ligne ne peut pas référencer simultanément un article et une récolte.' USING ERRCODE = '22023';
    END IF;
    IF v_inventory_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inventory_items WHERE id = v_inventory_item_id) THEN
      RAISE EXCEPTION 'Article de stock introuvable.' USING ERRCODE = '23503';
    END IF;
    IF v_harvest_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.harvests WHERE id = v_harvest_id) THEN
      RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = '23503';
    END IF;
    IF v_farm_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.farms WHERE id = v_farm_id) THEN
      RAISE EXCEPTION 'Exploitation introuvable.' USING ERRCODE = '23503';
    END IF;

    INSERT INTO public.commercial_sale_lines(
      sale_id, description, quantity, unit, unit_price, line_total,
      inventory_item_id, harvest_id, farm_id
    ) VALUES (
      p_sale_id, v_description, v_quantity, v_unit, v_unit_price,
      round(v_quantity * v_unit_price, 2), v_inventory_item_id, v_harvest_id, v_farm_id
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Une vente doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_commercial_sale(p_sale jsonb)
RETURNS public.commercial_sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_sale public.commercial_sales;
  v_client_id uuid := NULLIF(p_sale ->> 'client_id', '')::uuid;
  v_farm_id uuid := NULLIF(p_sale ->> 'farm_id', '')::uuid;
BEGIN
  PERFORM public.permission_require('sales.create');
  IF p_sale IS NULL OR jsonb_typeof(p_sale) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_sale) AS key_name
    WHERE key_name NOT IN ('client_id', 'farm_id', 'sale_date', 'reference', 'notes', 'lines')
  ) THEN
    RAISE EXCEPTION 'Les données de vente sont invalides.' USING ERRCODE = '22023';
  END IF;
  IF v_client_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.transport_clients WHERE id = v_client_id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Un client actif est obligatoire pour une vente.' USING ERRCODE = '23503';
  END IF;
  IF v_farm_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.farms WHERE id = v_farm_id) THEN
    RAISE EXCEPTION 'Exploitation introuvable.' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.commercial_sales(
    sale_number, client_id, farm_id, sale_date, reference, notes, created_by, updated_by
  ) VALUES (
    public._internal_next_commercial_sale_number(), v_client_id, v_farm_id,
    COALESCE(NULLIF(p_sale ->> 'sale_date', '')::date, current_date),
    NULLIF(btrim(p_sale ->> 'reference'), ''), NULLIF(btrim(p_sale ->> 'notes'), ''), auth.uid(), auth.uid()
  ) RETURNING * INTO v_sale;

  PERFORM public._internal_upsert_commercial_sale_lines(v_sale.id, p_sale -> 'lines');
  PERFORM public.business_finance_audit_event('COMMERCIAL_SALE', v_sale.id, NULL, 'CREATE', NULL, to_jsonb(v_sale));
  RETURN v_sale;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_commercial_sale(p_sale_id uuid, p_sale jsonb)
RETURNS public.commercial_sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commercial_sales;
  v_sale public.commercial_sales;
  v_client_id uuid := NULLIF(p_sale ->> 'client_id', '')::uuid;
  v_farm_id uuid := NULLIF(p_sale ->> 'farm_id', '')::uuid;
BEGIN
  PERFORM public.permission_require('sales.update');
  IF p_sale IS NULL OR jsonb_typeof(p_sale) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_sale) AS key_name
    WHERE key_name NOT IN ('client_id', 'farm_id', 'sale_date', 'reference', 'notes', 'lines')
  ) THEN
    RAISE EXCEPTION 'Les données de vente sont invalides.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_before FROM public.commercial_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Seule une vente brouillon peut être modifiée.' USING ERRCODE = '22023';
  END IF;
  IF v_client_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.transport_clients WHERE id = v_client_id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Un client actif est obligatoire pour une vente.' USING ERRCODE = '23503';
  END IF;
  IF v_farm_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.farms WHERE id = v_farm_id) THEN
    RAISE EXCEPTION 'Exploitation introuvable.' USING ERRCODE = '23503';
  END IF;

  UPDATE public.commercial_sales
  SET client_id = v_client_id,
      farm_id = v_farm_id,
      sale_date = COALESCE(NULLIF(p_sale ->> 'sale_date', '')::date, v_before.sale_date),
      reference = NULLIF(btrim(p_sale ->> 'reference'), ''),
      notes = NULLIF(btrim(p_sale ->> 'notes'), ''),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  PERFORM public._internal_upsert_commercial_sale_lines(v_sale.id, p_sale -> 'lines');
  PERFORM public.business_finance_audit_event('COMMERCIAL_SALE', v_sale.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_sale));
  RETURN v_sale;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_commercial_sale(p_sale_id uuid)
RETURNS public.commercial_sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commercial_sales;
  v_sale public.commercial_sales;
BEGIN
  PERFORM public.permission_require('sales.update');
  SELECT * INTO v_before FROM public.commercial_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vente introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CONFIRMED' THEN RETURN v_before; END IF;
  IF v_before.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Seule une vente brouillon peut être confirmée.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.commercial_sale_lines WHERE sale_id = p_sale_id) THEN
    RAISE EXCEPTION 'Une vente doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.commercial_sales
  SET status = 'CONFIRMED', confirmed_at = now(), updated_by = auth.uid(), updated_at = now()
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  PERFORM public.business_finance_audit_event('COMMERCIAL_SALE', v_sale.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_sale));
  RETURN v_sale;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_commercial_sale(p_sale_id uuid, p_reason text)
RETURNS public.commercial_sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commercial_sales;
  v_sale public.commercial_sales;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  PERFORM public.permission_require('sales.cancel');
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Un motif d''annulation est obligatoire.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_before FROM public.commercial_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vente introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CANCELLED' THEN RETURN v_before; END IF;
  IF v_before.status = 'ARCHIVED' THEN RAISE EXCEPTION 'Une vente archivée ne peut pas être annulée.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.commercial_invoices WHERE sale_id = p_sale_id AND status <> 'CANCELLED') THEN
    RAISE EXCEPTION 'Annulez d''abord la facture active de cette vente.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.commercial_sales
  SET status = 'CANCELLED', cancelled_at = now(), notes = concat_ws(E'\n', notes, 'Annulation : ' || v_reason),
      updated_by = auth.uid(), updated_at = now()
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  PERFORM public.business_finance_audit_event('COMMERCIAL_SALE', v_sale.id, NULL, 'CANCEL', to_jsonb(v_before), to_jsonb(v_sale));
  RETURN v_sale;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_commercial_invoice(p_sale_id uuid, p_invoice jsonb DEFAULT '{}'::jsonb)
RETURNS public.commercial_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_sale public.commercial_sales;
  v_invoice public.commercial_invoices;
  v_subtotal numeric(14, 2);
  v_rate numeric(5, 2) := 0;
  v_tax numeric(14, 2);
  v_vat_enabled boolean := false;
  v_configured_rate numeric(5, 2);
BEGIN
  PERFORM public.permission_require('sales.invoice');
  IF p_invoice IS NULL OR jsonb_typeof(p_invoice) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_invoice) AS key_name
    WHERE key_name NOT IN ('due_date', 'tax_rate', 'notes')
  ) THEN
    RAISE EXCEPTION 'Les données de facture sont invalides.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_sale FROM public.commercial_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'La vente doit être confirmée avant facturation.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commercial_invoices WHERE sale_id = p_sale_id AND status <> 'CANCELLED') THEN
    RAISE EXCEPTION 'Une facture active existe déjà pour cette vente.' USING ERRCODE = '23505';
  END IF;
  SELECT COALESCE(sum(line_total), 0) INTO v_subtotal FROM public.commercial_sale_lines WHERE sale_id = p_sale_id;
  IF v_subtotal <= 0 THEN RAISE EXCEPTION 'La vente doit posséder un montant facturable.' USING ERRCODE = '22023'; END IF;

  SELECT vat_enabled, vat_rate INTO v_vat_enabled, v_configured_rate FROM public.company_settings LIMIT 1;
  IF COALESCE(v_vat_enabled, false) THEN
    v_rate := COALESCE(NULLIF(p_invoice ->> 'tax_rate', '')::numeric, v_configured_rate, 0);
    IF v_rate < 0 OR v_rate > 100 THEN RAISE EXCEPTION 'Le taux de TVA est invalide.' USING ERRCODE = '22023'; END IF;
  END IF;
  v_tax := round(v_subtotal * v_rate / 100, 2);

  INSERT INTO public.commercial_invoices(
    invoice_number, sale_id, client_id, due_date, subtotal_amount, tax_rate, tax_amount, total_amount,
    notes, created_by, updated_by
  ) VALUES (
    public._internal_next_commercial_invoice_number(), p_sale_id, v_sale.client_id,
    NULLIF(p_invoice ->> 'due_date', '')::date, v_subtotal, v_rate, v_tax, round(v_subtotal + v_tax, 2),
    NULLIF(btrim(p_invoice ->> 'notes'), ''), auth.uid(), auth.uid()
  ) RETURNING * INTO v_invoice;

  PERFORM public.business_finance_audit_event('COMMERCIAL_INVOICE', v_invoice.id, NULL, 'CREATE', NULL, to_jsonb(v_invoice));
  RETURN v_invoice;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_commercial_invoice(p_invoice_id uuid)
RETURNS public.commercial_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commercial_invoices;
  v_invoice public.commercial_invoices;
BEGIN
  PERFORM public.permission_require('sales.invoice');
  SELECT * INTO v_before FROM public.commercial_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'ISSUED' THEN RETURN v_before; END IF;
  IF v_before.status <> 'DRAFT' THEN RAISE EXCEPTION 'Cette facture ne peut plus être émise.' USING ERRCODE = '22023'; END IF;

  UPDATE public.commercial_invoices
  SET status = 'ISSUED', issue_date = COALESCE(issue_date, current_date), issued_at = now(), updated_by = auth.uid(), updated_at = now()
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;
  PERFORM public.business_finance_audit_event('COMMERCIAL_INVOICE', v_invoice.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_invoice));
  RETURN v_invoice;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_commercial_invoice(p_invoice_id uuid, p_reason text)
RETURNS public.commercial_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commercial_invoices;
  v_invoice public.commercial_invoices;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  PERFORM public.permission_require('sales.cancel');
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Un motif d''annulation est obligatoire.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_before FROM public.commercial_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CANCELLED' THEN RETURN v_before; END IF;
  IF EXISTS (SELECT 1 FROM public.commercial_invoice_payments WHERE invoice_id = p_invoice_id AND status = 'CONFIRMED') THEN
    RAISE EXCEPTION 'Une facture avec paiement confirmé ne peut pas être annulée directement.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.commercial_invoices
  SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = v_reason, updated_by = auth.uid(), updated_at = now()
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;
  PERFORM public.business_finance_audit_event('COMMERCIAL_INVOICE', v_invoice.id, NULL, 'CANCEL', to_jsonb(v_before), to_jsonb(v_invoice));
  RETURN v_invoice;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_commercial_invoice_payment(p_invoice_id uuid, p_payment jsonb)
RETURNS public.commercial_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_invoice public.commercial_invoices;
  v_payment public.commercial_invoice_payments;
  v_wallet_id uuid := NULLIF(p_payment ->> 'wallet_id', '')::uuid;
  v_amount numeric(14, 2) := NULLIF(p_payment ->> 'amount', '')::numeric;
  v_status text := upper(COALESCE(NULLIF(btrim(p_payment ->> 'status'), ''), 'PLANNED'));
  v_kind text := upper(COALESCE(NULLIF(btrim(p_payment ->> 'payment_kind'), ''), 'PAYMENT'));
  v_reserved numeric(14, 2);
BEGIN
  PERFORM public.permission_require('sales.payments');
  IF p_payment IS NULL OR jsonb_typeof(p_payment) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_payment) AS key_name
    WHERE key_name NOT IN ('wallet_id', 'amount', 'payment_date', 'status', 'payment_kind', 'reference', 'notes')
  ) THEN
    RAISE EXCEPTION 'Les données de paiement sont invalides.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_invoice FROM public.commercial_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'La facture doit être émise avant de recevoir un paiement.' USING ERRCODE = '22023';
  END IF;
  IF v_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Un wallet valide est obligatoire.' USING ERRCODE = '23503';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Le montant doit être strictement positif.' USING ERRCODE = '22023'; END IF;
  IF v_status NOT IN ('PLANNED', 'RECEIVED') OR v_kind NOT IN ('DEPOSIT', 'PAYMENT', 'SETTLEMENT', 'REFUND') THEN
    RAISE EXCEPTION 'Le statut ou le type de paiement est invalide.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_reserved
  FROM public.commercial_invoice_payments
  WHERE invoice_id = p_invoice_id AND status IN ('PLANNED', 'RECEIVED', 'CONFIRMED');
  IF v_reserved + v_amount > v_invoice.total_amount THEN
    RAISE EXCEPTION 'Le surpaiement est bloqué.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.commercial_invoice_payments(
    invoice_id, sale_id, wallet_id, amount, payment_date, status, payment_kind,
    reference, notes, created_by, updated_by
  ) VALUES (
    v_invoice.id, v_invoice.sale_id, v_wallet_id, v_amount,
    COALESCE(NULLIF(p_payment ->> 'payment_date', '')::date, current_date), v_status, v_kind,
    NULLIF(btrim(p_payment ->> 'reference'), ''), NULLIF(btrim(p_payment ->> 'notes'), ''), auth.uid(), auth.uid()
  ) RETURNING * INTO v_payment;
  PERFORM public.business_finance_audit_event('COMMERCIAL_PAYMENT', v_payment.id, NULL, 'CREATE', NULL, to_jsonb(v_payment));
  RETURN v_payment;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_commercial_invoice_payment(p_payment_id uuid)
RETURNS public.commercial_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commercial_invoice_payments;
  v_payment public.commercial_invoice_payments;
  v_invoice public.commercial_invoices;
  v_sale public.commercial_sales;
  v_client public.transport_clients;
  v_operation public.finance_operations;
  v_confirmed numeric(14, 2);
BEGIN
  PERFORM public.permission_require('sales.payments');
  PERFORM public.permission_require('finance.create');
  SELECT * INTO v_before FROM public.commercial_invoice_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CONFIRMED' THEN RETURN v_before; END IF;
  IF v_before.status NOT IN ('PLANNED', 'RECEIVED') THEN
    RAISE EXCEPTION 'Seul un paiement prévu ou reçu peut être confirmé.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_commercial_invoice_payment_links
    WHERE payment_id = v_before.id AND link_type = 'PAYMENT'
  ) THEN
    RAISE EXCEPTION 'Une écriture financière existe déjà pour ce paiement.' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_invoice FROM public.commercial_invoices WHERE id = v_before.invoice_id FOR UPDATE;
  IF v_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'La facture doit être émise pour confirmer un paiement.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_sale FROM public.commercial_sales WHERE id = v_before.sale_id;
  SELECT * INTO v_client FROM public.transport_clients WHERE id = v_invoice.client_id;
  SELECT COALESCE(sum(amount), 0) INTO v_confirmed
  FROM public.commercial_invoice_payments
  WHERE invoice_id = v_invoice.id AND status = 'CONFIRMED';
  IF v_confirmed + v_before.amount > v_invoice.total_amount THEN
    RAISE EXCEPTION 'Le surpaiement est bloqué.' USING ERRCODE = '22023';
  END IF;

  v_operation := public.finance_create_operation(
    jsonb_build_object(
      'type', 'REVENUE',
      'amount', v_before.amount,
      'wallet_id', v_before.wallet_id,
      'operation_date', v_before.payment_date,
      'category', 'VENTE COMMERCIALE',
      'description', 'Encaissement facture ' || v_invoice.invoice_number,
      'reference', COALESCE(v_before.reference, v_before.id::text),
      'status', 'VALIDE',
      'origin', 'COMMERCIAL_PAYMENT',
      'module', 'COMMERCIAL_INVOICE_PAYMENT',
      'module_id', v_before.id,
      'farm_id', v_sale.farm_id,
      'client', v_client.display_name
    ),
    'COMMERCIAL_INVOICE_PAYMENT',
    v_before.id
  );
  INSERT INTO public.finance_commercial_invoice_payment_links(payment_id, operation_id, link_type)
  VALUES (v_before.id, v_operation.id, 'PAYMENT');

  UPDATE public.commercial_invoice_payments
  SET status = 'CONFIRMED', confirmed_at = now(), updated_by = auth.uid(), updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_payment;

  v_confirmed := v_confirmed + v_payment.amount;
  UPDATE public.commercial_invoices
  SET status = CASE WHEN v_confirmed >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
      updated_by = auth.uid(), updated_at = now()
  WHERE id = v_invoice.id;

  PERFORM public.business_finance_audit_event('COMMERCIAL_PAYMENT', v_payment.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_payment));
  RETURN v_payment;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_commercial_invoice_payment(p_payment_id uuid, p_reason text)
RETURNS public.commercial_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commercial_invoice_payments;
  v_payment public.commercial_invoice_payments;
  v_invoice public.commercial_invoices;
  v_sale public.commercial_sales;
  v_client public.transport_clients;
  v_operation public.finance_operations;
  v_confirmed numeric(14, 2);
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  PERFORM public.permission_require('sales.payments');
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Un motif d''annulation est obligatoire.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_before FROM public.commercial_invoice_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CANCELLED' THEN RETURN v_before; END IF;
  SELECT * INTO v_invoice FROM public.commercial_invoices WHERE id = v_before.invoice_id FOR UPDATE;
  SELECT * INTO v_sale FROM public.commercial_sales WHERE id = v_before.sale_id;
  SELECT * INTO v_client FROM public.transport_clients WHERE id = v_invoice.client_id;

  IF v_before.status = 'CONFIRMED' THEN
    PERFORM public.permission_require('finance.cancel');
    IF EXISTS (
      SELECT 1 FROM public.finance_commercial_invoice_payment_links
      WHERE payment_id = v_before.id AND link_type = 'REVERSAL'
    ) THEN
      RAISE EXCEPTION 'La contre-écriture existe déjà pour ce paiement.' USING ERRCODE = '23505';
    END IF;
    v_operation := public.finance_create_operation(
      jsonb_build_object(
        'type', 'EXPENSE',
        'amount', v_before.amount,
        'wallet_id', v_before.wallet_id,
        'operation_date', current_date,
        'category', 'ANNULATION VENTE COMMERCIALE',
        'description', 'Contre-écriture encaissement facture ' || v_invoice.invoice_number,
        'reference', 'REV-' || v_before.id::text,
        'status', 'VALIDE',
        'origin', 'COMMERCIAL_PAYMENT_REVERSAL',
        'module', 'COMMERCIAL_INVOICE_PAYMENT',
        'module_id', v_before.id,
        'farm_id', v_sale.farm_id,
        'client', v_client.display_name
      ),
      'COMMERCIAL_INVOICE_PAYMENT',
      v_before.id
    );
    INSERT INTO public.finance_commercial_invoice_payment_links(payment_id, operation_id, link_type)
    VALUES (v_before.id, v_operation.id, 'REVERSAL');
  END IF;

  UPDATE public.commercial_invoice_payments
  SET status = 'CANCELLED', cancelled_at = now(), notes = concat_ws(E'\n', notes, 'Annulation : ' || v_reason),
      updated_by = auth.uid(), updated_at = now()
  WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  SELECT COALESCE(sum(amount), 0) INTO v_confirmed
  FROM public.commercial_invoice_payments
  WHERE invoice_id = v_invoice.id AND status = 'CONFIRMED';
  UPDATE public.commercial_invoices
  SET status = CASE WHEN v_confirmed = 0 THEN 'ISSUED' WHEN v_confirmed >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
      updated_by = auth.uid(), updated_at = now()
  WHERE id = v_invoice.id;

  PERFORM public.business_finance_audit_event('COMMERCIAL_PAYMENT', v_payment.id, v_operation.id, 'CANCEL', to_jsonb(v_before), to_jsonb(v_payment));
  RETURN v_payment;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_commercial_sale_financial_summary(p_sale_id uuid)
RETURNS TABLE(
  subtotal_amount numeric,
  tax_amount numeric,
  total_invoiced numeric,
  total_received numeric,
  amount_due numeric,
  invoice_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  PERFORM public.permission_require('sales.finance.read');
  IF NOT EXISTS (SELECT 1 FROM public.commercial_sales WHERE id = p_sale_id) THEN
    RAISE EXCEPTION 'Vente introuvable.' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT
    COALESCE((SELECT sum(subtotal_amount) FROM public.commercial_invoices WHERE sale_id = p_sale_id AND status <> 'CANCELLED'), 0),
    COALESCE((SELECT sum(tax_amount) FROM public.commercial_invoices WHERE sale_id = p_sale_id AND status <> 'CANCELLED'), 0),
    COALESCE((SELECT sum(total_amount) FROM public.commercial_invoices WHERE sale_id = p_sale_id AND status <> 'CANCELLED'), 0),
    COALESCE((SELECT sum(payment.amount) FROM public.commercial_invoice_payments payment JOIN public.commercial_invoices invoice ON invoice.id = payment.invoice_id WHERE payment.sale_id = p_sale_id AND invoice.status <> 'CANCELLED' AND payment.status = 'CONFIRMED'), 0),
    COALESCE((SELECT sum(total_amount) FROM public.commercial_invoices WHERE sale_id = p_sale_id AND status <> 'CANCELLED'), 0)
      - COALESCE((SELECT sum(payment.amount) FROM public.commercial_invoice_payments payment JOIN public.commercial_invoices invoice ON invoice.id = payment.invoice_id WHERE payment.sale_id = p_sale_id AND invoice.status <> 'CANCELLED' AND payment.status = 'CONFIRMED'), 0),
    (SELECT status FROM public.commercial_invoices WHERE sale_id = p_sale_id AND status <> 'CANCELLED' ORDER BY created_at DESC LIMIT 1);
END;
$function$;

ALTER TABLE public.commercial_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_sale_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_commercial_invoice_payment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_sale_stock_movement_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_commercial_sale_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.commercial_sales, public.commercial_sale_lines, public.commercial_invoices,
  public.commercial_invoice_payments, public.finance_commercial_invoice_payment_links,
  public.commercial_sale_stock_movement_links, public.document_commercial_sale_links FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.commercial_sales, public.commercial_sale_lines,
  public.commercial_invoices, public.commercial_invoice_payments,
  public.finance_commercial_invoice_payment_links, public.commercial_sale_stock_movement_links,
  public.document_commercial_sale_links FROM authenticated;
GRANT SELECT ON TABLE public.commercial_sales, public.commercial_sale_lines, public.commercial_invoices,
  public.commercial_invoice_payments, public.finance_commercial_invoice_payment_links,
  public.commercial_sale_stock_movement_links, public.document_commercial_sale_links TO authenticated;

CREATE POLICY commercial_sales_read ON public.commercial_sales
  FOR SELECT TO authenticated USING (public.user_has_permission('sales.read'));
CREATE POLICY commercial_sale_lines_read ON public.commercial_sale_lines
  FOR SELECT TO authenticated USING (public.user_has_permission('sales.read'));
CREATE POLICY commercial_invoices_read ON public.commercial_invoices
  FOR SELECT TO authenticated USING (public.user_has_permission('sales.finance.read'));
CREATE POLICY commercial_invoice_payments_read ON public.commercial_invoice_payments
  FOR SELECT TO authenticated USING (public.user_has_permission('sales.finance.read'));
CREATE POLICY finance_commercial_invoice_payment_links_read ON public.finance_commercial_invoice_payment_links
  FOR SELECT TO authenticated USING (public.user_has_permission('sales.finance.read'));
CREATE POLICY commercial_sale_stock_movement_links_read ON public.commercial_sale_stock_movement_links
  FOR SELECT TO authenticated USING (public.user_has_permission('sales.read'));
CREATE POLICY document_commercial_sale_links_read ON public.document_commercial_sale_links
  FOR SELECT TO authenticated USING (
    public.user_has_permission('sales.read') AND public.user_has_permission('documents.read')
  );

REVOKE ALL ON FUNCTION public._internal_next_commercial_sale_number(),
  public._internal_next_commercial_invoice_number(),
  public._internal_upsert_commercial_sale_lines(uuid, jsonb),
  public.create_commercial_sale(jsonb),
  public.update_commercial_sale(uuid, jsonb),
  public.confirm_commercial_sale(uuid),
  public.cancel_commercial_sale(uuid, text),
  public.create_commercial_invoice(uuid, jsonb),
  public.issue_commercial_invoice(uuid),
  public.cancel_commercial_invoice(uuid, text),
  public.create_commercial_invoice_payment(uuid, jsonb),
  public.confirm_commercial_invoice_payment(uuid),
  public.cancel_commercial_invoice_payment(uuid, text),
  public.get_commercial_sale_financial_summary(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_commercial_sale(jsonb),
  public.update_commercial_sale(uuid, jsonb),
  public.confirm_commercial_sale(uuid),
  public.cancel_commercial_sale(uuid, text),
  public.create_commercial_invoice(uuid, jsonb),
  public.issue_commercial_invoice(uuid),
  public.cancel_commercial_invoice(uuid, text),
  public.create_commercial_invoice_payment(uuid, jsonb),
  public.confirm_commercial_invoice_payment(uuid),
  public.cancel_commercial_invoice_payment(uuid, text),
  public.get_commercial_sale_financial_summary(uuid)
TO authenticated;

DO $triggers$
BEGIN
  IF to_regprocedure('public.tg_touch_updated_at()') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.commercial_sales'::regclass AND tgname = 'trg_commercial_sales_updated' AND NOT tgisinternal) THEN
      CREATE TRIGGER trg_commercial_sales_updated BEFORE UPDATE ON public.commercial_sales FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.commercial_sale_lines'::regclass AND tgname = 'trg_commercial_sale_lines_updated' AND NOT tgisinternal) THEN
      CREATE TRIGGER trg_commercial_sale_lines_updated BEFORE UPDATE ON public.commercial_sale_lines FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.commercial_invoices'::regclass AND tgname = 'trg_commercial_invoices_updated' AND NOT tgisinternal) THEN
      CREATE TRIGGER trg_commercial_invoices_updated BEFORE UPDATE ON public.commercial_invoices FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.commercial_invoice_payments'::regclass AND tgname = 'trg_commercial_invoice_payments_updated' AND NOT tgisinternal) THEN
      CREATE TRIGGER trg_commercial_invoice_payments_updated BEFORE UPDATE ON public.commercial_invoice_payments FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
    END IF;
  END IF;
END;
$triggers$;
