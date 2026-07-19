
-- =========================================================================
-- HALAL ERP schema v1
-- =========================================================================

-- Enums --------------------------------------------------------------------
CREATE TYPE public.app_role AS ENUM (
  'super_admin', 'admin', 'gestionnaire', 'comptable',
  'chauffeur', 'employe', 'lecture_seule'
);

CREATE TYPE public.entity_kind AS ENUM (
  'employe','chauffeur','moto','vehicule','exploitation','contrat','autre'
);

CREATE TYPE public.statut_general AS ENUM ('actif','inactif','archive','en_service','en_reparation');

-- Utility: updated_at trigger ---------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Profiles -----------------------------------------------------------------
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  avatar_url text,
  locale text NOT NULL DEFAULT 'fr',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_read_all_auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_self"  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_insert_self"  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- User roles ---------------------------------------------------------------
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles_self_read" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles));
$$;

-- Admins can see all roles
CREATE POLICY "user_roles_admin_read" ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin']::public.app_role[]));
CREATE POLICY "user_roles_admin_write" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin']::public.app_role[]));

-- Signup handler -> profile + default read-only role -----------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'lecture_seule');
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Common columns helper (added directly per table below) -------------------

-- Employees ----------------------------------------------------------------
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricule text UNIQUE,
  nom text NOT NULL,
  prenom text,
  poste text,
  telephone text,
  email text,
  date_embauche date,
  date_naissance date,
  salaire_base numeric(14,2) DEFAULT 0,
  statut public.statut_general NOT NULL DEFAULT 'actif',
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notion_page_id text UNIQUE,
  notion_workspace_id text,
  notion_last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.employees(statut);
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees_read" ON public.employees FOR SELECT TO authenticated USING (true);
CREATE POLICY "employees_write" ON public.employees FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]));

-- Drivers ------------------------------------------------------------------
CREATE TABLE public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  numero_permis text,
  categorie_permis text,
  date_expiration_permis date,
  statut public.statut_general NOT NULL DEFAULT 'actif',
  notes text,
  notion_page_id text UNIQUE,
  notion_workspace_id text,
  notion_last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.drivers(employee_id);
CREATE INDEX ON public.drivers(date_expiration_permis);
CREATE TRIGGER trg_drivers_updated BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drivers TO authenticated;
GRANT ALL ON public.drivers TO service_role;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers_read" ON public.drivers FOR SELECT TO authenticated USING (true);
CREATE POLICY "drivers_write" ON public.drivers FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]));

-- Motorcycles --------------------------------------------------------------
CREATE TABLE public.motorcycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  immatriculation text UNIQUE NOT NULL,
  marque text,
  modele text,
  annee int,
  kilometrage int DEFAULT 0,
  statut public.statut_general NOT NULL DEFAULT 'actif',
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  notion_page_id text UNIQUE,
  notion_workspace_id text,
  notion_last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.motorcycles(driver_id);
CREATE TRIGGER trg_motos_updated BEFORE UPDATE ON public.motorcycles
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.motorcycles TO authenticated;
GRANT ALL ON public.motorcycles TO service_role;
ALTER TABLE public.motorcycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "motos_read" ON public.motorcycles FOR SELECT TO authenticated USING (true);
CREATE POLICY "motos_write" ON public.motorcycles FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]));

-- Vehicles -----------------------------------------------------------------
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  immatriculation text UNIQUE NOT NULL,
  marque text,
  modele text,
  type text,
  annee int,
  kilometrage int DEFAULT 0,
  statut public.statut_general NOT NULL DEFAULT 'actif',
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  notion_page_id text UNIQUE,
  notion_workspace_id text,
  notion_last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.vehicles(driver_id);
CREATE TRIGGER trg_vehicles_updated BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles TO authenticated;
GRANT ALL ON public.vehicles TO service_role;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicles_read" ON public.vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "vehicles_write" ON public.vehicles FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]));

-- Farms --------------------------------------------------------------------
CREATE TABLE public.farms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL,
  localisation text,
  superficie_ha numeric(10,2),
  type_culture text,
  statut public.statut_general NOT NULL DEFAULT 'actif',
  notion_page_id text UNIQUE,
  notion_workspace_id text,
  notion_last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_farms_updated BEFORE UPDATE ON public.farms
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.farms TO authenticated;
GRANT ALL ON public.farms TO service_role;
ALTER TABLE public.farms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "farms_read" ON public.farms FOR SELECT TO authenticated USING (true);
CREATE POLICY "farms_write" ON public.farms FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]));

-- Contracts ----------------------------------------------------------------
CREATE TABLE public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE,
  type text,
  partie text,
  date_debut date,
  date_fin date,
  montant numeric(14,2) DEFAULT 0,
  statut text DEFAULT 'en_cours',
  entity_type public.entity_kind,
  entity_id uuid,
  description text,
  notion_page_id text UNIQUE,
  notion_workspace_id text,
  notion_last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.contracts(entity_type, entity_id);
CREATE INDEX ON public.contracts(date_fin);
CREATE TRIGGER trg_contracts_updated BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contracts_read" ON public.contracts FOR SELECT TO authenticated USING (true);
CREATE POLICY "contracts_write" ON public.contracts FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]));

-- Expenses -----------------------------------------------------------------
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT current_date,
  categorie text,
  montant numeric(14,2) NOT NULL DEFAULT 0,
  description text,
  entity_type public.entity_kind,
  entity_id uuid,
  paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notion_page_id text UNIQUE,
  notion_workspace_id text,
  notion_last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.expenses(date);
CREATE INDEX ON public.expenses(entity_type, entity_id);
CREATE TRIGGER trg_expenses_updated BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses_read" ON public.expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "expenses_write" ON public.expenses FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]));

-- Revenues -----------------------------------------------------------------
CREATE TABLE public.revenues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT current_date,
  source text,
  montant numeric(14,2) NOT NULL DEFAULT 0,
  description text,
  entity_type public.entity_kind,
  entity_id uuid,
  notion_page_id text UNIQUE,
  notion_workspace_id text,
  notion_last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.revenues(date);
CREATE INDEX ON public.revenues(entity_type, entity_id);
CREATE TRIGGER trg_revenues_updated BEFORE UPDATE ON public.revenues
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenues TO authenticated;
GRANT ALL ON public.revenues TO service_role;
ALTER TABLE public.revenues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "revenues_read" ON public.revenues FOR SELECT TO authenticated USING (true);
CREATE POLICY "revenues_write" ON public.revenues FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]));

-- Payments -----------------------------------------------------------------
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT current_date,
  type text NOT NULL DEFAULT 'entrant', -- entrant/sortant
  montant numeric(14,2) NOT NULL DEFAULT 0,
  methode text,
  reference text,
  contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  description text,
  notion_page_id text UNIQUE,
  notion_workspace_id text,
  notion_last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.payments(date);
CREATE INDEX ON public.payments(contract_id);
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_read" ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "payments_write" ON public.payments FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]));

-- Inventory items ----------------------------------------------------------
CREATE TABLE public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text UNIQUE,
  nom text NOT NULL,
  categorie text,
  unite text DEFAULT 'unite',
  stock_actuel numeric(12,2) NOT NULL DEFAULT 0,
  seuil_alerte numeric(12,2) DEFAULT 0,
  notion_page_id text UNIQUE,
  notion_workspace_id text,
  notion_last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_inv_items_updated BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_items TO service_role;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inv_items_read" ON public.inventory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "inv_items_write" ON public.inventory_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]));

-- Inventory movements ------------------------------------------------------
CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  type text NOT NULL, -- entree / sortie
  quantite numeric(12,2) NOT NULL,
  date date NOT NULL DEFAULT current_date,
  motif text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.inventory_movements(item_id);
CREATE INDEX ON public.inventory_movements(date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inv_mv_read" ON public.inventory_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "inv_mv_write" ON public.inventory_movements FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]));

-- Documents ----------------------------------------------------------------
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL,
  type text,
  entity_type public.entity_kind,
  entity_id uuid,
  url text,
  date_emission date,
  date_expiration date,
  notion_page_id text UNIQUE,
  notion_workspace_id text,
  notion_last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.documents(entity_type, entity_id);
CREATE INDEX ON public.documents(date_expiration);
CREATE TRIGGER trg_documents_updated BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "documents_read" ON public.documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "documents_write" ON public.documents FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]));

-- Maintenances -------------------------------------------------------------
CREATE TABLE public.maintenances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type public.entity_kind NOT NULL, -- moto / vehicule
  entity_id uuid NOT NULL,
  date date NOT NULL DEFAULT current_date,
  type text,
  cout numeric(14,2) DEFAULT 0,
  kilometrage int,
  prestataire text,
  notes text,
  notion_page_id text UNIQUE,
  notion_workspace_id text,
  notion_last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.maintenances(entity_type, entity_id);
CREATE INDEX ON public.maintenances(date);
CREATE TRIGGER trg_maint_updated BEFORE UPDATE ON public.maintenances
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenances TO authenticated;
GRANT ALL ON public.maintenances TO service_role;
ALTER TABLE public.maintenances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "maint_read" ON public.maintenances FOR SELECT TO authenticated USING (true);
CREATE POLICY "maint_write" ON public.maintenances FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]));

-- Notifications ------------------------------------------------------------
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, -- null = broadcast
  type text,
  titre text NOT NULL,
  message text,
  lu boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.notifications(user_id);
CREATE INDEX ON public.notifications(created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_read_self_or_broadcast" ON public.notifications FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "notif_update_self" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "notif_admin_write" ON public.notifications FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin']::public.app_role[]));

-- Company settings (singleton) ---------------------------------------------
CREATE TABLE public.company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL DEFAULT 'HALAL ERP',
  devise text NOT NULL DEFAULT 'XOF',
  timezone text NOT NULL DEFAULT 'Africa/Dakar',
  adresse text,
  logo_url text,
  notion_workspace_id text,
  notion_sync_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT ON public.company_settings TO authenticated;
GRANT ALL ON public.company_settings TO service_role;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_read" ON public.company_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_write" ON public.company_settings FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin']::public.app_role[]));

-- Seed singleton row
INSERT INTO public.company_settings (nom) VALUES ('HALAL ERP');

-- Notion database mappings -------------------------------------------------
CREATE TABLE public.notion_database_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text UNIQUE NOT NULL, -- 'employees','drivers',...
  notion_database_id text,
  last_synced_at timestamptz,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_notion_map_updated BEFORE UPDATE ON public.notion_database_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT SELECT ON public.notion_database_mappings TO authenticated;
GRANT ALL ON public.notion_database_mappings TO service_role;
ALTER TABLE public.notion_database_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notion_map_read" ON public.notion_database_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY "notion_map_write" ON public.notion_database_mappings FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin']::public.app_role[]));
