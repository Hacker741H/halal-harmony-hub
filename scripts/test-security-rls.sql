-- Lot 10 — tests RLS et sécurité.
-- Exécuter avec un rôle de migration/administration ; chaque bloc est annulé.
-- Les tests dynamiques utilisent des comptes existants dans user_roles. Ajouter
-- temporairement des comptes de test Finance/Gestionnaire si la couverture
-- complète est requise, puis les retirer hors production.

BEGIN;

-- 1. Invariants de schéma et de privilèges.
DO $assertions$
DECLARE
  permissive_policy_count integer;
  anonymous_definer_count integer;
  historical_write_policy_count integer;
  document_write_policy_count integer;
  public_document_path_count integer;
  definer_without_search_path_count integer;
  documents_public boolean;
  permission_catalog_count integer;
BEGIN
  SELECT count(*) INTO permissive_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'profiles', 'employees', 'drivers', 'contracts', 'documents', 'wallets',
      'finance_operations', 'finance_links', 'salary_payments', 'revenues',
      'expenses', 'payments', 'stocks', 'inventory_items', 'stock_movements'
    )
    AND (qual = 'true' OR with_check = 'true');
  IF permissive_policy_count <> 0 THEN
    RAISE EXCEPTION 'Politiques RLS permissives trouvées : %', permissive_policy_count;
  END IF;

  SELECT count(*) INTO anonymous_definer_count
  FROM pg_proc AS function_row
  JOIN pg_namespace AS namespace ON namespace.oid = function_row.pronamespace
  WHERE namespace.nspname = 'public'
    AND function_row.prosecdef
    AND has_function_privilege('anon', function_row.oid, 'EXECUTE');
  IF anonymous_definer_count <> 0 THEN
    RAISE EXCEPTION 'Fonctions SECURITY DEFINER accessibles à anon : %', anonymous_definer_count;
  END IF;

  SELECT count(*) INTO historical_write_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('revenues', 'expenses', 'payments', 'stocks')
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  IF historical_write_policy_count <> 0 THEN
    RAISE EXCEPTION 'Une table historique accepte encore une écriture directe : %', historical_write_policy_count;
  END IF;

  SELECT count(*) INTO document_write_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'documents'
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  IF document_write_policy_count <> 0 THEN
    RAISE EXCEPTION 'Une politique permet encore l''écriture directe de documents : %', document_write_policy_count;
  END IF;

  SELECT count(*) INTO public_document_path_count
  FROM public.documents
  WHERE url ~ '^https?://.*/storage/v1/object/public/documents/.+'
    AND storage_path IS NULL;
  IF public_document_path_count <> 0 THEN
    RAISE EXCEPTION 'Des URL publiques de documents ne sont pas reprises : %', public_document_path_count;
  END IF;

  SELECT count(*) INTO definer_without_search_path_count
  FROM pg_proc AS function_row
  JOIN pg_namespace AS namespace ON namespace.oid = function_row.pronamespace
  WHERE namespace.nspname = 'public'
    AND function_row.prosecdef
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(function_row.proconfig, ARRAY[]::text[])) AS setting
      WHERE setting LIKE 'search_path=%'
    );
  IF definer_without_search_path_count <> 0 THEN
    RAISE EXCEPTION 'Fonctions SECURITY DEFINER sans search_path explicite : %', definer_without_search_path_count;
  END IF;

  SELECT public INTO documents_public FROM storage.buckets WHERE id = 'documents';
  IF documents_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Le bucket documents doit être privé.';
  END IF;
  SELECT count(*) INTO permission_catalog_count
  FROM public.permissions;
  IF permission_catalog_count = 0 THEN
    RAISE EXCEPTION 'Permission catalog is empty.';
  END IF;
END;
$assertions$;

-- 2. Vérification des deux rôles déjà présents dans l'environnement distant.
-- Aucun identifiant n'est affiché ni enregistré par ce script.
SELECT set_config(
  'app.security_test_super_admin',
  COALESCE((SELECT user_id::text FROM public.user_roles WHERE role = 'super_admin' LIMIT 1), ''),
  true
);
SELECT set_config(
  'app.security_test_read_only',
  COALESCE((
    SELECT read_only_role.user_id::text
    FROM public.user_roles AS read_only_role
    WHERE read_only_role.role = 'lecture_seule'
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_roles AS privileged_role
        WHERE privileged_role.user_id = read_only_role.user_id
          AND privileged_role.role IN ('super_admin', 'admin', 'gestionnaire', 'comptable')
      )
    LIMIT 1
  ), ''),
  true
);

-- Super-administrateur : finance visible et helper de rôle fiable.
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', current_setting('app.security_test_super_admin'), true)
WHERE current_setting('app.security_test_super_admin') <> '';
SET LOCAL ROLE authenticated;

DO $super_admin$
BEGIN
  IF current_setting('app.security_test_super_admin', true) <> ''
     AND public.current_user_role() <> 'super_admin'::public.app_role THEN
    RAISE EXCEPTION 'Le rôle super_admin n''est pas résolu depuis auth.uid().';
  END IF;
END;
$super_admin$;

SELECT count(*) AS finance_rows_visible_to_super_admin
FROM public.finance_operations;

-- A user with super_admin and lecture_seule receives the union of permissions.
DO $permission_union$
BEGIN
  IF current_setting('app.security_test_super_admin', true) <> ''
     AND NOT public.user_has_permission('roles.manage') THEN
    RAISE EXCEPTION 'The super_admin permission union is incorrect.';
  END IF;
END;
$permission_union$;

ROLLBACK;

BEGIN;

-- Utilisateur lecture seule : aucune ligne financière et aucun droit d'écriture
-- direct sur les archives ni le journal. Le rôle est fixé uniquement dans le
-- JWT de test, pas par une valeur applicative.
SELECT set_config(
  'request.jwt.claim.sub',
  current_setting('app.security_test_read_only'),
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $read_only$
DECLARE
  finance_visible integer;
BEGIN
  IF current_setting('request.jwt.claim.sub', true) = '' THEN
    RAISE NOTICE 'Test lecture seule dynamique ignoré : aucun compte exclusivement lecture_seule.';
  ELSE
    SELECT count(*) INTO finance_visible FROM public.finance_operations;
    IF finance_visible <> 0 THEN
      RAISE EXCEPTION 'Un utilisateur lecture seule voit des opérations financières.';
    END IF;
    IF has_table_privilege('authenticated', 'public.finance_operations', 'INSERT') THEN
      RAISE EXCEPTION 'authenticated possède encore INSERT sur finance_operations.';
    END IF;
    IF has_table_privilege('authenticated', 'public.revenues', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.expenses', 'DELETE')
       OR has_table_privilege('authenticated', 'public.payments', 'INSERT') THEN
      RAISE EXCEPTION 'Une archive financière conserve un droit d''écriture SQL.';
    END IF;
  END IF;
END;
$read_only$;

ROLLBACK;

-- Couverture à exécuter dès que les comptes existent :
--  * comptable : finance_operations et wallets visibles, documents RH refusés ;
--  * gestionnaire : véhicules/motos/stocks autorisés, finance_operations et
--    salary_payments invisibles ;
--  * lecture seule : notification d'un autre utilisateur et URL Storage privée
--    refusées ;
--  * tous : appel direct aux helpers business_* et aux migrations de finance
--    refusé (absence d'EXECUTE), appel RPC métier autorisé seulement si son
--    contrôle interne de rôle l'accepte.
