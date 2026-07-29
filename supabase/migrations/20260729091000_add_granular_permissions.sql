-- Lot 11: one permission model built on the existing user_roles relation.
-- No user is created here. app_role remains the single role identity; roles is
-- its catalogue and role_permissions is the only role-to-permission mapping.

CREATE TABLE IF NOT EXISTS public.roles (
  code public.app_role PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL,
  is_system boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.permissions (
  code text PRIMARY KEY CHECK (code ~ '^[a-z]+(\.[a-z_]+)+$'),
  module text NOT NULL,
  action text NOT NULL,
  description text NOT NULL,
  sensitivity text NOT NULL CHECK (sensitivity IN ('STANDARD', 'SENSITIVE', 'CRITICAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role public.app_role NOT NULL REFERENCES public.roles(code) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES public.permissions(code) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission_code)
);

CREATE INDEX IF NOT EXISTS role_permissions_permission_role_idx
  ON public.role_permissions(permission_code, role);
CREATE INDEX IF NOT EXISTS user_roles_user_role_idx
  ON public.user_roles(user_id, role);

INSERT INTO public.roles(code, label, description)
VALUES
  ('super_admin', 'Super administrateur', 'Administration système complète, audit et gestion des permissions.'),
  ('admin', 'Administrateur', 'Administration fonctionnelle sans contrôle des super-administrateurs.'),
  ('comptable', 'Comptable', 'Journal financier, wallets, salaires autorisés et rapports financiers.'),
  ('rh', 'Ressources humaines', 'Employés, chauffeurs, contrats et documents RH.'),
  ('operations', 'Opérations', 'Véhicules, motos, affectations et entretiens.'),
  ('stocks', 'Stocks', 'Articles, mouvements, coûts de stock et alertes.'),
  ('exploitations', 'Exploitations', 'Exploitations agricoles, récoltes et finance agricole limitée.'),
  ('gestionnaire', 'Gestionnaire', 'Coordination opérationnelle limitée, sans accès financier ni salarial global.'),
  ('chauffeur', 'Chauffeur', 'Accès personnel minimal.'),
  ('employe', 'Employé', 'Accès personnel minimal.'),
  ('lecture_seule', 'Lecture seule', 'Lecture explicitement accordée, sans mutation ni export sensible.')
ON CONFLICT (code) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    updated_at = now();

INSERT INTO public.permissions(code, module, action, description, sensitivity)
VALUES
  ('dashboard.read', 'dashboard', 'read', 'Consulter le tableau de bord autorisé.', 'STANDARD'),
  ('employees.read', 'employees', 'read', 'Consulter les employés.', 'SENSITIVE'),
  ('employees.create', 'employees', 'create', 'Créer un employé.', 'SENSITIVE'),
  ('employees.update', 'employees', 'update', 'Modifier un employé.', 'SENSITIVE'),
  ('employees.delete', 'employees', 'delete', 'Supprimer ou archiver un employé.', 'CRITICAL'),
  ('drivers.read', 'drivers', 'read', 'Consulter les chauffeurs et permis.', 'SENSITIVE'),
  ('drivers.create', 'drivers', 'create', 'Créer un chauffeur.', 'SENSITIVE'),
  ('drivers.update', 'drivers', 'update', 'Modifier un chauffeur.', 'SENSITIVE'),
  ('drivers.delete', 'drivers', 'delete', 'Supprimer ou archiver un chauffeur.', 'CRITICAL'),
  ('drivers.assign', 'drivers', 'assign', 'Créer ou clôturer des affectations chauffeur.', 'SENSITIVE'),
  ('vehicles.read', 'vehicles', 'read', 'Consulter les véhicules.', 'STANDARD'),
  ('vehicles.create', 'vehicles', 'create', 'Créer un véhicule.', 'SENSITIVE'),
  ('vehicles.update', 'vehicles', 'update', 'Modifier un véhicule.', 'SENSITIVE'),
  ('vehicles.delete', 'vehicles', 'delete', 'Supprimer un véhicule selon les règles métier.', 'CRITICAL'),
  ('vehicles.assign', 'vehicles', 'assign', 'Gérer les affectations de véhicule.', 'SENSITIVE'),
  ('vehicles.maintenance.manage', 'vehicles', 'maintenance_manage', 'Gérer les entretiens véhicule.', 'SENSITIVE'),
  ('vehicles.finance.read', 'vehicles', 'finance_read', 'Consulter les coûts explicitement liés aux véhicules.', 'SENSITIVE'),
  ('motorcycles.read', 'motorcycles', 'read', 'Consulter les motos.', 'STANDARD'),
  ('motorcycles.create', 'motorcycles', 'create', 'Créer une moto.', 'SENSITIVE'),
  ('motorcycles.update', 'motorcycles', 'update', 'Modifier une moto.', 'SENSITIVE'),
  ('motorcycles.delete', 'motorcycles', 'delete', 'Supprimer une moto selon les règles métier.', 'CRITICAL'),
  ('motorcycles.assign', 'motorcycles', 'assign', 'Gérer les affectations de moto.', 'SENSITIVE'),
  ('motorcycles.maintenance.manage', 'motorcycles', 'maintenance_manage', 'Gérer les entretiens moto.', 'SENSITIVE'),
  ('motorcycles.finance.read', 'motorcycles', 'finance_read', 'Consulter les coûts explicitement liés aux motos.', 'SENSITIVE'),
  ('farms.read', 'farms', 'read', 'Consulter les exploitations.', 'STANDARD'),
  ('farms.manage', 'farms', 'manage', 'Créer et modifier les exploitations.', 'SENSITIVE'),
  ('farms.finance.read', 'farms', 'finance_read', 'Consulter les finances agricoles liées.', 'SENSITIVE'),
  ('harvests.manage', 'harvests', 'manage', 'Gérer les récoltes et encaissements associés.', 'SENSITIVE'),
  ('contracts.read', 'contracts', 'read', 'Consulter les contrats.', 'SENSITIVE'),
  ('contracts.manage', 'contracts', 'manage', 'Créer et modifier les contrats.', 'SENSITIVE'),
  ('documents.read', 'documents', 'read', 'Consulter les documents non sensibles.', 'SENSITIVE'),
  ('documents.upload', 'documents', 'upload', 'Téléverser un document autorisé.', 'SENSITIVE'),
  ('documents.archive', 'documents', 'archive', 'Archiver un document.', 'SENSITIVE'),
  ('documents.sensitive.read', 'documents', 'sensitive_read', 'Consulter les documents RH ou d’identité.', 'CRITICAL'),
  ('finance.read', 'finance', 'read', 'Consulter le journal financier.', 'CRITICAL'),
  ('finance.create', 'finance', 'create', 'Créer une opération financière.', 'CRITICAL'),
  ('finance.update', 'finance', 'update', 'Modifier une opération financière.', 'CRITICAL'),
  ('finance.cancel', 'finance', 'cancel', 'Annuler une opération financière.', 'CRITICAL'),
  ('finance.export', 'finance', 'export', 'Exporter des données financières.', 'CRITICAL'),
  ('wallets.read', 'wallets', 'read', 'Consulter les wallets.', 'CRITICAL'),
  ('wallets.manage', 'wallets', 'manage', 'Gérer les wallets et leurs seuils.', 'CRITICAL'),
  ('salaries.read', 'salaries', 'read', 'Consulter les salaires et paiements.', 'CRITICAL'),
  ('salaries.pay', 'salaries', 'pay', 'Créer, modifier ou annuler un paiement salarial.', 'CRITICAL'),
  ('salaries.export', 'salaries', 'export', 'Exporter les données salariales.', 'CRITICAL'),
  ('stocks.read', 'stocks', 'read', 'Consulter les stocks.', 'STANDARD'),
  ('stocks.manage', 'stocks', 'manage', 'Gérer les articles et mouvements de stock.', 'SENSITIVE'),
  ('stocks.finance.read', 'stocks', 'finance_read', 'Consulter les coûts de stock.', 'SENSITIVE'),
  ('notifications.read', 'notifications', 'read', 'Consulter les notifications visibles.', 'STANDARD'),
  ('notifications.manage', 'notifications', 'manage', 'Traiter les alertes opérationnelles.', 'SENSITIVE'),
  ('notifications.settings.manage', 'notifications', 'settings_manage', 'Configurer les règles et le scheduler.', 'CRITICAL'),
  ('reports.read', 'reports', 'read', 'Consulter les rapports autorisés.', 'STANDARD'),
  ('reports.finance', 'reports', 'finance', 'Consulter les rapports financiers.', 'CRITICAL'),
  ('reports.hr', 'reports', 'hr', 'Consulter les rapports RH.', 'CRITICAL'),
  ('reports.operations', 'reports', 'operations', 'Consulter les rapports opérationnels.', 'SENSITIVE'),
  ('reports.stocks', 'reports', 'stocks', 'Consulter les rapports de stock.', 'SENSITIVE'),
  ('reports.export', 'reports', 'export', 'Exporter les rapports autorisés.', 'SENSITIVE'),
  ('reports.share', 'reports', 'share', 'Partager ou gérer les modèles de rapport.', 'CRITICAL'),
  ('settings.read', 'settings', 'read', 'Consulter les paramètres autorisés.', 'SENSITIVE'),
  ('settings.manage', 'settings', 'manage', 'Modifier les paramètres ERP.', 'CRITICAL'),
  ('roles.read', 'roles', 'read', 'Consulter les rôles et permissions.', 'SENSITIVE'),
  ('roles.manage', 'roles', 'manage', 'Modifier les permissions des rôles système.', 'CRITICAL'),
  ('users.roles.assign', 'users', 'roles_assign', 'Attribuer ou retirer un rôle autorisé.', 'CRITICAL'),
  ('security.audit.read', 'security', 'audit_read', 'Consulter le journal de sécurité.', 'CRITICAL')
ON CONFLICT (code) DO UPDATE
SET module = EXCLUDED.module,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    sensitivity = EXCLUDED.sensitivity,
    updated_at = now();

-- The role sets are explicit; role inheritance is intentionally not implicit.
WITH role_grants(role, permission_code) AS (
  SELECT 'super_admin'::public.app_role, code FROM public.permissions
  UNION ALL SELECT 'admin'::public.app_role, code FROM public.permissions
    WHERE code NOT IN ('roles.manage', 'security.audit.read')
  UNION ALL SELECT 'gestionnaire'::public.app_role, unnest(ARRAY[
    'dashboard.read','employees.read','drivers.read','vehicles.read','vehicles.create','vehicles.update','vehicles.delete','vehicles.assign','vehicles.maintenance.manage',
    'motorcycles.read','motorcycles.create','motorcycles.update','motorcycles.delete','motorcycles.assign','motorcycles.maintenance.manage',
    'farms.read','farms.manage','harvests.manage','contracts.read','contracts.manage','documents.read','documents.upload','documents.archive',
    'notifications.read','notifications.manage','reports.read','reports.operations'
  ])
  UNION ALL SELECT 'comptable'::public.app_role, unnest(ARRAY[
    'dashboard.read','vehicles.read','vehicles.finance.read','motorcycles.read','motorcycles.finance.read','farms.read','farms.finance.read',
    'finance.read','finance.create','finance.update','finance.cancel','finance.export','wallets.read','wallets.manage',
    'salaries.read','salaries.pay','salaries.export','stocks.read','stocks.finance.read','notifications.read',
    'reports.read','reports.finance','reports.export','settings.read'
  ])
  UNION ALL SELECT 'rh'::public.app_role, unnest(ARRAY[
    'dashboard.read','employees.read','employees.create','employees.update','employees.delete','drivers.read','drivers.create','drivers.update','drivers.delete',
    'contracts.read','contracts.manage','documents.read','documents.upload','documents.archive','documents.sensitive.read',
    'salaries.read','notifications.read','reports.read','reports.hr'
  ])
  UNION ALL SELECT 'operations'::public.app_role, unnest(ARRAY[
    'dashboard.read','drivers.read','drivers.assign','vehicles.read','vehicles.create','vehicles.update','vehicles.delete','vehicles.assign','vehicles.maintenance.manage',
    'motorcycles.read','motorcycles.create','motorcycles.update','motorcycles.delete','motorcycles.assign','motorcycles.maintenance.manage',
    'contracts.read','documents.read','documents.upload','documents.archive','notifications.read','notifications.manage','reports.read','reports.operations'
  ])
  UNION ALL SELECT 'stocks'::public.app_role, unnest(ARRAY[
    'dashboard.read','stocks.read','stocks.manage','stocks.finance.read','documents.read','documents.upload','notifications.read','notifications.manage','reports.read','reports.stocks'
  ])
  UNION ALL SELECT 'exploitations'::public.app_role, unnest(ARRAY[
    'dashboard.read','farms.read','farms.manage','farms.finance.read','harvests.manage','contracts.read','documents.read','documents.upload','documents.archive',
    'notifications.read','notifications.manage','reports.read','reports.operations'
  ])
  UNION ALL SELECT 'lecture_seule'::public.app_role, unnest(ARRAY[
    'dashboard.read','vehicles.read','motorcycles.read','farms.read','contracts.read','stocks.read','notifications.read','reports.read','reports.operations','reports.stocks'
  ])
  UNION ALL SELECT 'chauffeur'::public.app_role, unnest(ARRAY['dashboard.read','notifications.read'])
  UNION ALL SELECT 'employe'::public.app_role, unnest(ARRAY['dashboard.read','notifications.read'])
), valid_grants AS (
  SELECT role, permission_code FROM role_grants
  WHERE EXISTS (SELECT 1 FROM public.permissions p WHERE p.code = role_grants.permission_code)
)
INSERT INTO public.role_permissions(role, permission_code)
SELECT role, permission_code FROM valid_grants
ON CONFLICT DO NOTHING;

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- The helpers below use the caller derived exclusively from auth.uid().
CREATE OR REPLACE FUNCTION public.current_user_permissions()
RETURNS TABLE(permission_code text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT DISTINCT p.code
  FROM public.permissions AS p
  WHERE auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles AS super_role
        JOIN public.roles AS super_catalogue ON super_catalogue.code = super_role.role AND super_catalogue.is_active
        WHERE super_role.user_id = auth.uid() AND super_role.role = 'super_admin'
      )
      OR EXISTS (
        SELECT 1
        FROM public.user_roles AS role_row
        JOIN public.roles AS role_catalogue ON role_catalogue.code = role_row.role AND role_catalogue.is_active
        JOIN public.role_permissions AS role_permission ON role_permission.role = role_row.role
        WHERE role_row.user_id = auth.uid() AND role_permission.permission_code = p.code
      )
    )
  ORDER BY p.code;
$function$;

CREATE OR REPLACE FUNCTION public.user_has_permission(p_permission_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.current_user_permissions() AS permission_row
    WHERE permission_row.permission_code = p_permission_code
  );
$function$;

CREATE OR REPLACE FUNCTION public.user_has_any_permission(p_permission_codes text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT COALESCE(p_permission_codes, ARRAY[]::text[]) && ARRAY(
    SELECT permission_code FROM public.current_user_permissions()
  );
$function$;

CREATE OR REPLACE FUNCTION public.user_has_all_permissions(p_permission_codes text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_permission_codes, ARRAY[]::text[])) AS requested(code)
    WHERE NOT public.user_has_permission(requested.code)
  );
$function$;

CREATE OR REPLACE FUNCTION public.permission_require(p_permission_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_permission(p_permission_code) THEN
    RAISE EXCEPTION 'Vous n''avez pas la permission d''effectuer cette action.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_permission_administration()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.permission_require('roles.read');

  SELECT jsonb_build_object(
    'roles', COALESCE((
      SELECT jsonb_agg(to_jsonb(role_data) ORDER BY role_data.label)
      FROM (
        SELECT r.code::text AS code, r.label, r.description, r.is_system, r.is_active,
               count(DISTINCT ur.user_id)::integer AS user_count,
               COALESCE(array_agg(DISTINCT rp.permission_code ORDER BY rp.permission_code)
                 FILTER (WHERE rp.permission_code IS NOT NULL), ARRAY[]::text[]) AS permission_codes
        FROM public.roles r
        LEFT JOIN public.user_roles ur ON ur.role = r.code
        LEFT JOIN public.role_permissions rp ON rp.role = r.code
        GROUP BY r.code, r.label, r.description, r.is_system, r.is_active
      ) AS role_data
    ), '[]'::jsonb),
    'permissions', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.module, p.code) FROM public.permissions p), '[]'::jsonb),
    'users', COALESCE((
      SELECT jsonb_agg(to_jsonb(user_data) ORDER BY user_data.full_name NULLS LAST, user_data.user_id)
      FROM (
        SELECT p.id AS user_id, p.full_name,
               COALESCE(array_agg(ur.role::text ORDER BY ur.role::text)
                 FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::text[]) AS roles
        FROM public.profiles p
        LEFT JOIN public.user_roles ur ON ur.user_id = p.id
        GROUP BY p.id, p.full_name
      ) AS user_data
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$function$;

ALTER TABLE public.security_audit_log
  DROP CONSTRAINT IF EXISTS security_audit_log_event_type_check;
ALTER TABLE public.security_audit_log
  ADD CONSTRAINT security_audit_log_event_type_check CHECK (event_type IN (
    'ROLE_CHANGE', 'ROLE_PERMISSION_CHANGE', 'DOCUMENT_ARCHIVED', 'DOCUMENT_ORPHAN_CLEANUP',
    'WALLET_CREATED', 'WALLET_UPDATED', 'WALLET_DELETED', 'REPORT_EXPORT'
  ));

CREATE OR REPLACE FUNCTION public.set_role_permissions(
  p_role public.app_role,
  p_permission_codes text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  current_codes text[];
  requested_codes text[] := ARRAY(SELECT DISTINCT code FROM unnest(COALESCE(p_permission_codes, ARRAY[]::text[])) AS input(code) ORDER BY code);
BEGIN
  PERFORM public.permission_require('roles.manage');
  IF NOT public.current_user_has_any_role(ARRAY['super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Seul un super administrateur peut modifier un rôle système.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE code = p_role AND is_active) THEN
    RAISE EXCEPTION 'Rôle introuvable ou inactif.' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(requested_codes) AS requested(code)
    WHERE NOT EXISTS (SELECT 1 FROM public.permissions WHERE code = requested.code)
  ) THEN
    RAISE EXCEPTION 'Une permission demandée est inconnue.' USING ERRCODE = '23503';
  END IF;
  IF p_role = 'super_admin' THEN
    RAISE EXCEPTION 'Les permissions du super administrateur sont implicites et ne peuvent pas être réduites.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(permission_code ORDER BY permission_code), ARRAY[]::text[])
  INTO current_codes FROM public.role_permissions WHERE role = p_role;

  DELETE FROM public.role_permissions WHERE role = p_role;
  INSERT INTO public.role_permissions(role, permission_code)
  SELECT p_role, requested.code FROM unnest(requested_codes) AS requested(code);

  INSERT INTO public.security_audit_log(actor_user_id, event_type, resource_type, metadata)
  VALUES (auth.uid(), 'ROLE_PERMISSION_CHANGE', 'ROLE', jsonb_build_object(
    'role', p_role::text, 'before', current_codes, 'after', requested_codes
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_role(
  p_user_id uuid,
  p_role public.app_role,
  p_assigned boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  target_permissions text[];
BEGIN
  PERFORM public.permission_require('users.roles.assign');
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Utilisateur introuvable.' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE code = p_role AND is_active) THEN
    RAISE EXCEPTION 'Rôle introuvable ou inactif.' USING ERRCODE = '23503';
  END IF;
  IF NOT public.current_user_has_any_role(ARRAY['super_admin']::public.app_role[]) THEN
    IF p_user_id = auth.uid() THEN
      RAISE EXCEPTION 'Vous ne pouvez pas modifier vos propres rôles.' USING ERRCODE = '42501';
    END IF;
    IF p_role IN ('super_admin', 'admin') THEN
      RAISE EXCEPTION 'Vous ne pouvez pas attribuer un rôle administratif protégé.' USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(array_agg(permission_code), ARRAY[]::text[])
    INTO target_permissions FROM public.role_permissions WHERE role = p_role;
    IF NOT public.user_has_all_permissions(target_permissions) THEN
      RAISE EXCEPTION 'Vous ne pouvez pas attribuer une permission que vous ne possédez pas.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_assigned THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (p_user_id, p_role) ON CONFLICT DO NOTHING;
  ELSE
    IF p_role = 'super_admin' AND (
      SELECT count(*) FROM public.user_roles WHERE role = 'super_admin'
    ) <= 1 THEN
      RAISE EXCEPTION 'Le dernier super administrateur ne peut pas être retiré.' USING ERRCODE = '23514';
    END IF;
    DELETE FROM public.user_roles WHERE user_id = p_user_id AND role = p_role;
  END IF;
END;
$function$;

-- current_user_role remains a display/legacy helper. Authorization must use
-- current_user_permissions and user_has_permission, which use union semantics.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT role_row.role
  FROM public.user_roles AS role_row
  WHERE role_row.user_id = auth.uid()
  ORDER BY CASE role_row.role
    WHEN 'super_admin' THEN 1
    WHEN 'admin' THEN 2
    WHEN 'comptable' THEN 3
    WHEN 'rh' THEN 4
    WHEN 'operations' THEN 5
    WHEN 'stocks' THEN 6
    WHEN 'exploitations' THEN 7
    WHEN 'gestionnaire' THEN 8
    WHEN 'chauffeur' THEN 9
    WHEN 'employe' THEN 10
    WHEN 'lecture_seule' THEN 11
  END
  LIMIT 1;
$function$;

-- Permissions catalogue is readable only through the secured administration
-- RPC or by callers that have roles.read. No direct mutation is granted.
CREATE POLICY roles_read_authorized ON public.roles
  FOR SELECT TO authenticated USING (public.user_has_permission('roles.read'));
CREATE POLICY permissions_read_authorized ON public.permissions
  FOR SELECT TO authenticated USING (public.user_has_permission('roles.read'));
CREATE POLICY role_permissions_read_authorized ON public.role_permissions
  FOR SELECT TO authenticated USING (public.user_has_permission('roles.read'));

DROP POLICY IF EXISTS user_roles_admin_read ON public.user_roles;
DROP POLICY IF EXISTS user_roles_admin_write ON public.user_roles;
CREATE POLICY user_roles_read_authorized ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.user_has_permission('roles.read'));

DROP POLICY IF EXISTS security_audit_log_read ON public.security_audit_log;
CREATE POLICY security_audit_log_read ON public.security_audit_log
  FOR SELECT TO authenticated USING (public.user_has_permission('security.audit.read'));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.roles, public.permissions, public.role_permissions, public.user_roles FROM authenticated;

REVOKE ALL ON FUNCTION public.current_user_permissions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_has_permission(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_has_any_permission(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_has_all_permissions(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_permission_administration() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_role_permissions(public.app_role, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_user_role(uuid, public.app_role, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.permission_require(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_permissions(), public.user_has_permission(text), public.user_has_any_permission(text[]), public.user_has_all_permissions(text[]), public.get_permission_administration(), public.set_role_permissions(public.app_role, text[]), public.set_user_role(uuid, public.app_role, boolean) TO authenticated;
