-- Chantier de stabilisation globale, section Finance/Wallets -- faille
-- d'autorisation reelle et actuellement ouverte, trouvee en verifiant la
-- fragmentation des garde-fous finance (permission_require /
-- security_require_finance_role / finance_require_write_role /
-- business_finance_require_write_role).
--
-- public.finance_delete_operation(uuid) est GRANT EXECUTE TO authenticated
-- depuis 20260728160000 (jamais revoque). Sa version d'origine verifiait
-- finance_require_write_role() avant d'agir. La reecriture DELETE->CANCEL
-- de 20260822270000_harden_finance_audit_and_privileges.sql ("C1/T10") a
-- delegue tout le corps a business_cancel_finance_operation(uuid) --
-- correctement reutilise le mecanisme CANCELLED existant plutot que d'en
-- creer un second, comme voulu -- mais sans jamais restaurer de
-- verification de permission dans finance_delete_operation elle-meme, et
-- sans revoquer son GRANT authenticated comme cela a ete fait
-- systematiquement pour toutes les vraies fonctions internes (voir le
-- balayage REVOKE de 20260729092000).
--
-- Consequence verifiee par lecture directe de la chaine d'appel complete
-- (finance_delete_operation -> business_cancel_finance_operation ->
-- business_finance_require_write_role) : cette derniere ne verifie que
-- "auth.uid() IS NOT NULL", par conception -- elle sert de filet partage a
-- ~26 fonctions _internal_* dont l'autorisation reelle est deja verifiee
-- une fois par leur propre wrapper public avant delegation. Mais
-- finance_delete_operation EST elle-meme un point d'entree public direct,
-- pas un wrapper interne -- elle n'a donc plus aucune verification de
-- permission sur son propre chemin. Net : n'importe quel utilisateur
-- authentifie, quel que soit son role, peut aujourd'hui annuler n'importe
-- quelle operation financiere sur n'importe quel wallet.
--
-- Correctif minimal et additif : restaurer l'appel a
-- finance_require_write_role() (le meme garde-fou que finance_update_
-- operation, sa fonction sœur la plus proche) au tout debut du corps,
-- avant toute delegation -- sans toucher ni business_cancel_finance_
-- operation (qui reste utilisable par ses ~26 autres appelants internes,
-- deja proteges chacun a leur niveau) ni sa signature (RETURNS boolean
-- inchange, aucun appelant frontend a modifier).
CREATE OR REPLACE FUNCTION public.finance_delete_operation(p_operation_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.finance_require_write_role();
  PERFORM public.business_cancel_finance_operation(p_operation_id);
  RETURN true;
END;
$function$;
