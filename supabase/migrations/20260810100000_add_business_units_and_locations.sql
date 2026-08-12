-- CM-02: shared activity and operating-location foundation.
-- This migration deliberately does not create a second finance journal, move
-- existing activity, or modify wallet balances. It only makes future commerce
-- locations, assigned staff and authorised wallets explicit.

CREATE TABLE IF NOT EXISTS public.business_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_units_code_check CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  CONSTRAINT business_units_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT business_units_status_check CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT business_units_archive_state_check CHECK (
    (status = 'ACTIVE' AND archived_at IS NULL)
    OR (status = 'ARCHIVED' AND archived_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.business_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit_id uuid NOT NULL REFERENCES public.business_units(id) ON DELETE RESTRICT,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  location_type text NOT NULL DEFAULT 'STORE',
  status text NOT NULL DEFAULT 'ACTIVE',
  address text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_locations_code_check CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  CONSTRAINT business_locations_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT business_locations_type_check CHECK (
    location_type IN ('STORE', 'WAREHOUSE', 'FARM', 'DEPOT', 'OFFICE', 'OTHER')
  ),
  CONSTRAINT business_locations_status_check CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT business_locations_archive_state_check CHECK (
    (status = 'ACTIVE' AND archived_at IS NULL)
    OR (status = 'ARCHIVED' AND archived_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.business_location_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE RESTRICT,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  purpose text NOT NULL DEFAULT 'COLLECTION',
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_location_wallets_purpose_check CHECK (
    purpose IN ('CASH_DRAWER', 'COLLECTION', 'OPERATING')
  ),
  CONSTRAINT business_location_wallets_state_check CHECK (
    (is_active AND revoked_at IS NULL)
    OR (NOT is_active AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT business_location_wallets_unique_relation UNIQUE (business_location_id, wallet_id, purpose)
);

CREATE TABLE IF NOT EXISTS public.business_location_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assignment_role text NOT NULL DEFAULT 'CASHIER',
  start_date date NOT NULL DEFAULT current_date,
  end_date date,
  notes text,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_location_assignments_role_check CHECK (
    assignment_role IN ('CASHIER', 'STORE_MANAGER', 'STOCK_KEEPER', 'SALES_AGENT', 'OTHER')
  ),
  CONSTRAINT business_location_assignments_dates_check CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS business_location_wallets_one_active_primary_idx
  ON public.business_location_wallets(business_location_id)
  WHERE is_active AND is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS business_location_assignments_one_current_idx
  ON public.business_location_assignments(business_location_id, user_id)
  WHERE end_date IS NULL;
CREATE INDEX IF NOT EXISTS business_locations_unit_status_idx
  ON public.business_locations(business_unit_id, status, name);
CREATE INDEX IF NOT EXISTS business_location_wallets_wallet_active_idx
  ON public.business_location_wallets(wallet_id, business_location_id)
  WHERE is_active;
CREATE INDEX IF NOT EXISTS business_location_assignments_user_current_idx
  ON public.business_location_assignments(user_id, business_location_id)
  WHERE end_date IS NULL;

-- These nullable references preserve historical rows. New commerce workflows
-- will require them only once their dedicated UI and RPCs are released.
ALTER TABLE public.commercial_sales
  ADD COLUMN IF NOT EXISTS business_unit_id uuid REFERENCES public.business_units(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS business_location_id uuid REFERENCES public.business_locations(id) ON DELETE RESTRICT;
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS business_location_id uuid REFERENCES public.business_locations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS commercial_sales_unit_date_idx
  ON public.commercial_sales(business_unit_id, sale_date DESC)
  WHERE business_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commercial_sales_location_date_idx
  ON public.commercial_sales(business_location_id, sale_date DESC)
  WHERE business_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_movements_location_date_idx
  ON public.stock_movements(business_location_id, movement_date DESC)
  WHERE business_location_id IS NOT NULL;

INSERT INTO public.business_units(code, name, description, status)
VALUES
  ('TRANSPORT', 'Transport', 'Courses, véhicules, chauffeurs et activités de transport.', 'ACTIVE'),
  ('COMMERCE', 'Commerce', 'Magasins, ventes de marchandises et caisses.', 'ACTIVE'),
  ('AGRICULTURE', 'Agriculture', 'Exploitations, récoltes et ventes agricoles.', 'ACTIVE'),
  ('OTHER', 'Autres activités', 'Activités futures de l’entreprise.', 'ACTIVE')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = now();

INSERT INTO public.permissions(code, module, action, description, sensitivity)
VALUES
  ('business.units.read', 'business_units', 'read', 'Consulter les activités de l’entreprise autorisées.', 'SENSITIVE'),
  ('business.units.manage', 'business_units', 'manage', 'Créer, modifier ou archiver une activité.', 'CRITICAL'),
  ('locations.read', 'locations', 'read', 'Consulter les points d’exploitation autorisés.', 'SENSITIVE'),
  ('locations.manage', 'locations', 'manage', 'Créer, modifier ou archiver un point d’exploitation.', 'CRITICAL'),
  ('locations.assign', 'locations', 'assign', 'Affecter ou clôturer les affectations des collaborateurs.', 'CRITICAL'),
  ('locations.wallets.manage', 'locations', 'wallets_manage', 'Associer ou révoquer les wallets autorisés d’un point d’exploitation.', 'CRITICAL')
ON CONFLICT (code) DO UPDATE
SET module = EXCLUDED.module,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    sensitivity = EXCLUDED.sensitivity,
    updated_at = now();

INSERT INTO public.role_permissions(role, permission_code)
SELECT grant_row.role::public.app_role, grant_row.permission_code
FROM (VALUES
  ('admin', 'business.units.read'), ('admin', 'business.units.manage'),
  ('admin', 'locations.read'), ('admin', 'locations.manage'), ('admin', 'locations.assign'), ('admin', 'locations.wallets.manage'),
  ('gestionnaire', 'business.units.read'), ('gestionnaire', 'locations.read'),
  ('comptable', 'business.units.read'), ('comptable', 'locations.read'),
  ('stocks', 'business.units.read'), ('stocks', 'locations.read')
) AS grant_row(role, permission_code)
WHERE EXISTS (SELECT 1 FROM public.roles WHERE code = grant_row.role::public.app_role)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.business_location_is_assigned_to_current_user(p_location_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.business_location_assignments AS assignment_row
      WHERE assignment_row.business_location_id = p_location_id
        AND assignment_row.user_id = auth.uid()
        AND assignment_row.end_date IS NULL
    );
$function$;

CREATE OR REPLACE FUNCTION public.create_business_unit(p_business_unit jsonb)
RETURNS public.business_units
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_unit public.business_units;
  v_code text := upper(NULLIF(btrim(p_business_unit ->> 'code'), ''));
  v_name text := NULLIF(btrim(p_business_unit ->> 'name'), '');
  v_description text := NULLIF(btrim(p_business_unit ->> 'description'), '');
BEGIN
  PERFORM public.permission_require('business.units.manage');
  IF v_code IS NULL OR v_name IS NULL OR v_code !~ '^[A-Z][A-Z0-9_]{1,39}$' THEN
    RAISE EXCEPTION 'Code ou nom d’activité invalide.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.business_units(code, name, description, status, created_by, updated_by)
  VALUES (v_code, v_name, v_description, 'ACTIVE', auth.uid(), auth.uid())
  RETURNING * INTO v_unit;

  PERFORM public.business_finance_audit_event('BUSINESS_UNIT', v_unit.id, NULL, 'CREATE', NULL, to_jsonb(v_unit));
  RETURN v_unit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_business_location(p_location jsonb)
RETURNS public.business_locations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_location public.business_locations;
  v_unit_id uuid := NULLIF(p_location ->> 'business_unit_id', '')::uuid;
  v_code text := upper(NULLIF(btrim(p_location ->> 'code'), ''));
  v_name text := NULLIF(btrim(p_location ->> 'name'), '');
  v_type text := upper(coalesce(NULLIF(btrim(p_location ->> 'location_type'), ''), 'STORE'));
  v_address text := NULLIF(btrim(p_location ->> 'address'), '');
  v_notes text := NULLIF(btrim(p_location ->> 'notes'), '');
BEGIN
  PERFORM public.permission_require('locations.manage');
  IF v_unit_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.business_units WHERE id = v_unit_id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Activité introuvable ou archivée.' USING ERRCODE = '23503';
  END IF;
  IF v_code IS NULL OR v_name IS NULL OR v_code !~ '^[A-Z][A-Z0-9_]{1,39}$'
    OR v_type NOT IN ('STORE', 'WAREHOUSE', 'FARM', 'DEPOT', 'OFFICE', 'OTHER') THEN
    RAISE EXCEPTION 'Point d’exploitation invalide.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.business_locations(
    business_unit_id, code, name, location_type, address, notes, status, created_by, updated_by
  ) VALUES (
    v_unit_id, v_code, v_name, v_type, v_address, v_notes, 'ACTIVE', auth.uid(), auth.uid()
  ) RETURNING * INTO v_location;

  PERFORM public.business_finance_audit_event('BUSINESS_LOCATION', v_location.id, NULL, 'CREATE', NULL, to_jsonb(v_location));
  RETURN v_location;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_business_location_user(p_assignment jsonb)
RETURNS public.business_location_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_assignment public.business_location_assignments;
  v_location_id uuid := NULLIF(p_assignment ->> 'business_location_id', '')::uuid;
  v_user_id uuid := NULLIF(p_assignment ->> 'user_id', '')::uuid;
  v_role text := upper(coalesce(NULLIF(btrim(p_assignment ->> 'assignment_role'), ''), 'CASHIER'));
  v_start_date date := coalesce(NULLIF(p_assignment ->> 'start_date', '')::date, current_date);
  v_notes text := NULLIF(btrim(p_assignment ->> 'notes'), '');
BEGIN
  PERFORM public.permission_require('locations.assign');
  IF v_location_id IS NULL OR v_user_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.business_locations WHERE id = v_location_id AND status = 'ACTIVE')
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'Utilisateur ou point d’exploitation introuvable.' USING ERRCODE = '23503';
  END IF;
  IF v_role NOT IN ('CASHIER', 'STORE_MANAGER', 'STOCK_KEEPER', 'SALES_AGENT', 'OTHER') THEN
    RAISE EXCEPTION 'Rôle d’affectation invalide.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.business_location_assignments
  SET end_date = v_start_date,
      ended_by = auth.uid(),
      updated_at = now()
  WHERE business_location_id = v_location_id
    AND user_id = v_user_id
    AND end_date IS NULL;

  INSERT INTO public.business_location_assignments(
    business_location_id, user_id, assignment_role, start_date, notes, assigned_by
  ) VALUES (
    v_location_id, v_user_id, v_role, v_start_date, v_notes, auth.uid()
  ) RETURNING * INTO v_assignment;

  PERFORM public.business_finance_audit_event('BUSINESS_LOCATION_ASSIGNMENT', v_assignment.id, NULL, 'ASSIGN', NULL, to_jsonb(v_assignment));
  RETURN v_assignment;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_business_location_wallet(p_mapping jsonb)
RETURNS public.business_location_wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_mapping public.business_location_wallets;
  v_location_id uuid := NULLIF(p_mapping ->> 'business_location_id', '')::uuid;
  v_wallet_id uuid := NULLIF(p_mapping ->> 'wallet_id', '')::uuid;
  v_purpose text := upper(coalesce(NULLIF(btrim(p_mapping ->> 'purpose'), ''), 'COLLECTION'));
  v_primary boolean := coalesce((p_mapping ->> 'is_primary')::boolean, false);
BEGIN
  PERFORM public.permission_require('locations.wallets.manage');
  IF v_location_id IS NULL OR v_wallet_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.business_locations WHERE id = v_location_id AND status = 'ACTIVE')
    OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Wallet ou point d’exploitation introuvable.' USING ERRCODE = '23503';
  END IF;
  IF v_purpose NOT IN ('CASH_DRAWER', 'COLLECTION', 'OPERATING') THEN
    RAISE EXCEPTION 'Usage de wallet invalide.' USING ERRCODE = '22023';
  END IF;

  IF v_primary THEN
    UPDATE public.business_location_wallets
    SET is_primary = false, updated_at = now()
    WHERE business_location_id = v_location_id
      AND is_active
      AND is_primary;
  END IF;

  INSERT INTO public.business_location_wallets(
    business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by, revoked_at
  ) VALUES (
    v_location_id, v_wallet_id, v_purpose, v_primary, true, auth.uid(), NULL
  )
  ON CONFLICT (business_location_id, wallet_id, purpose) DO UPDATE
  SET is_primary = EXCLUDED.is_primary,
      is_active = true,
      assigned_by = auth.uid(),
      assigned_at = now(),
      revoked_at = NULL,
      updated_at = now()
  RETURNING * INTO v_mapping;

  PERFORM public.business_finance_audit_event('BUSINESS_LOCATION_WALLET', v_mapping.id, NULL, 'ASSIGN', NULL, to_jsonb(v_mapping));
  RETURN v_mapping;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_business_location_wallet(p_mapping_id uuid)
RETURNS public.business_location_wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.business_location_wallets;
  v_mapping public.business_location_wallets;
BEGIN
  PERFORM public.permission_require('locations.wallets.manage');
  SELECT * INTO v_before
  FROM public.business_location_wallets
  WHERE id = p_mapping_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Affectation de wallet introuvable.' USING ERRCODE = '23503';
  END IF;

  UPDATE public.business_location_wallets
  SET is_active = false,
      is_primary = false,
      revoked_at = now(),
      updated_at = now()
  WHERE id = p_mapping_id
  RETURNING * INTO v_mapping;

  PERFORM public.business_finance_audit_event('BUSINESS_LOCATION_WALLET', v_mapping.id, NULL, 'UNASSIGN', to_jsonb(v_before), to_jsonb(v_mapping));
  RETURN v_mapping;
END;
$function$;

ALTER TABLE public.business_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_location_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_location_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_units, public.business_locations,
  public.business_location_wallets, public.business_location_assignments FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.business_units, public.business_locations,
  public.business_location_wallets, public.business_location_assignments FROM authenticated;
GRANT SELECT ON TABLE public.business_units, public.business_locations,
  public.business_location_wallets, public.business_location_assignments TO authenticated;

DROP POLICY IF EXISTS business_units_read ON public.business_units;
CREATE POLICY business_units_read ON public.business_units
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission('business.units.read')
    OR EXISTS (
      SELECT 1
      FROM public.business_locations AS location_row
      JOIN public.business_location_assignments AS assignment_row
        ON assignment_row.business_location_id = location_row.id
      WHERE location_row.business_unit_id = business_units.id
        AND assignment_row.user_id = auth.uid()
        AND assignment_row.end_date IS NULL
    )
  );

DROP POLICY IF EXISTS business_locations_read ON public.business_locations;
CREATE POLICY business_locations_read ON public.business_locations
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission('locations.read')
    OR public.business_location_is_assigned_to_current_user(id)
  );

DROP POLICY IF EXISTS business_location_wallets_read ON public.business_location_wallets;
CREATE POLICY business_location_wallets_read ON public.business_location_wallets
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission('locations.read')
    OR public.business_location_is_assigned_to_current_user(business_location_id)
  );

DROP POLICY IF EXISTS business_location_assignments_read ON public.business_location_assignments;
CREATE POLICY business_location_assignments_read ON public.business_location_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.user_has_permission('locations.assign')
  );

REVOKE ALL ON FUNCTION public.business_location_is_assigned_to_current_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_business_unit(jsonb), public.create_business_location(jsonb),
  public.assign_business_location_user(jsonb), public.set_business_location_wallet(jsonb),
  public.revoke_business_location_wallet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_location_is_assigned_to_current_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_business_unit(jsonb), public.create_business_location(jsonb),
  public.assign_business_location_user(jsonb), public.set_business_location_wallet(jsonb),
  public.revoke_business_location_wallet(uuid) TO authenticated;

DO $function$
BEGIN
  IF to_regprocedure('public.tg_touch_updated_at()') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.business_units'::regclass AND tgname = 'trg_business_units_updated'
    ) THEN
      CREATE TRIGGER trg_business_units_updated
      BEFORE UPDATE ON public.business_units
      FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.business_locations'::regclass AND tgname = 'trg_business_locations_updated'
    ) THEN
      CREATE TRIGGER trg_business_locations_updated
      BEFORE UPDATE ON public.business_locations
      FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.business_location_wallets'::regclass AND tgname = 'trg_business_location_wallets_updated'
    ) THEN
      CREATE TRIGGER trg_business_location_wallets_updated
      BEFORE UPDATE ON public.business_location_wallets
      FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.business_location_assignments'::regclass AND tgname = 'trg_business_location_assignments_updated'
    ) THEN
      CREATE TRIGGER trg_business_location_assignments_updated
      BEFORE UPDATE ON public.business_location_assignments
      FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
    END IF;
  END IF;
END;
$function$;
