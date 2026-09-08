-- STABILISATION TRANSVERSALE (2/3) -- test de non-regression pour la
-- classe de bug corrigee par 20260908100000_lock_down_internal_finance_
-- functions.sql + 20260908100500_fix_residual_public_grant_on_internal_
-- functions.sql.
--
-- Regle a ne plus jamais casser : aucune fonction '_internal_*' du
-- schema public ne doit etre executable directement par authenticated ou
-- anon -- seul son wrapper public (qui verifie permission_require(...)
-- ou l'equivalent en premier) doit pouvoir l'atteindre. La violation
-- concrete de cette regle (finance_delete_operation en 20260822270000,
-- puis _internal_create_finance_operation ici, prouve par test
-- garanti-annule contre la production reelle -- un vrai utilisateur
-- caissier a reussi a creer une vraie ligne finance_operations en
-- appelant _internal_create_finance_operation directement, sans aucune
-- permission) a chaque fois permis a n'importe quel utilisateur
-- authentifie, quel que soit son role, d'agir sur des ecritures
-- financieres ou des wallets sans aucune permission.
--
-- COMMENT L'EXECUTER (lecture seule cote donnees -- un seul bloc
-- garanti-annule, rien de ce script ne survit, y compris la ligne
-- finance_operations creee par la verification du chemin legitime) :
--   npx supabase db query --linked -f supabase/tests/finance_internal_functions_lockdown.sql
--
-- RESULTAT ATTENDU : le script echoue TOUJOURS (RAISE EXCEPTION final
-- volontaire = le mecanisme de garantie d'annulation) -- ce qui compte
-- est le TEXTE du message :
--   "DIAG_RESULT: OK -- ..." pour les deux verifications = la classe de
--   bug reste corrigee, rien a faire.
--   "DIAG_RESULT: REGRESSION -- blocage manquant ..." = un role sans
--   permission finance/wallet peut de nouveau appeler la fonction interne
--   directement -- investiguer et corriger avant tout deploiement.
--   "DIAG_RESULT: REGRESSION -- chemin legitime casse ..." = un
--   correctif ulterieur a casse l'usage normal (un admin ne peut plus
--   creer une ecriture financiere via le vrai point d'entree public) --
--   corriger avant tout deploiement.
--
-- Si ce projet a un jour un environnement non-production, faire tourner
-- ce meme script contre lui plutot que contre la production -- inchange
-- jusque-la faute d'environnement disponible (meme contrainte que le
-- reste de cet audit).
DO $do$
DECLARE
  v_low_priv_user uuid;
  v_low_priv_role text;
  v_admin_user uuid;
  v_wallet_id uuid;
  v_result public.finance_operations;
  v_bypass_blocked boolean := false;
  v_bypass_detail text;
  v_legit_ok boolean := false;
  v_legit_detail text;
BEGIN
  -- Verification 1 : un role sans aucune permission finance/wallet ne
  -- doit plus pouvoir agir en appelant la fonction interne directement.
  SELECT ur.user_id, ur.role INTO v_low_priv_user, v_low_priv_role
  FROM public.user_roles ur
  JOIN auth.users au ON au.id = ur.user_id
  WHERE ur.role = 'caissier'
  LIMIT 1;

  IF v_low_priv_user IS NULL THEN
    v_bypass_detail := 'SKIPPED -- no caissier user found to test with (adjust the role filter for this environment)';
  ELSE
    SELECT id INTO v_wallet_id FROM public.wallets LIMIT 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_low_priv_user::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    BEGIN
      v_result := public._internal_create_finance_operation(
        jsonb_build_object(
          'type', 'REVENUE', 'wallet_id', v_wallet_id::text, 'amount', 1,
          'category', 'DIAG_PROBE_DO_NOT_KEEP', 'description', 'regression test probe'
        )
      );
      v_bypass_detail := format('REGRESSION -- role=%s user=%s created finance_operations id=%s on wallet=%s by calling _internal_create_finance_operation directly, with ZERO permission check', v_low_priv_role, v_low_priv_user, v_result.id, v_wallet_id);
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLSTATE = '42501' THEN
          v_bypass_blocked := true;
          v_bypass_detail := format('OK -- role=%s correctly blocked (42501) from calling _internal_create_finance_operation directly', v_low_priv_role);
        ELSE
          v_bypass_detail := format('UNEXPECTED -- sqlstate=%s message=%s (blocked, but not with the expected 42501 -- investigate)', SQLSTATE, SQLERRM);
        END IF;
    END;
  END IF;

  -- Reinitialise le role de session avant la verification 2 (superuser/
  -- postgres, comme au debut du script) -- ne pas enchainer sur le role
  -- authenticated encore actif depuis la verification 1.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Verification 2 : le chemin legitime (utilisateur reellement
  -- autorise, en passant par le wrapper public) doit continuer a
  -- fonctionner -- ce verrou ne doit jamais devenir un verrou pour tout
  -- le monde.
  SELECT ur.user_id INTO v_admin_user
  FROM public.user_roles ur
  JOIN auth.users au ON au.id = ur.user_id
  WHERE ur.role = 'admin'
  LIMIT 1;

  IF v_admin_user IS NULL THEN
    v_legit_detail := 'SKIPPED -- no admin user found to test with (adjust the role filter for this environment)';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_user::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    BEGIN
      v_result := public.finance_create_operation(
        jsonb_build_object(
          'type', 'REVENUE', 'wallet_id', v_wallet_id::text, 'amount', 1,
          'category', 'DIAG_PROBE_DO_NOT_KEEP', 'description', 'regression test probe (legitimate path)'
        )
      );
      v_legit_ok := true;
      v_legit_detail := format('OK -- admin user=%s created finance_operations id=%s via the real public wrapper (finance_create_operation), the lockdown did not break legitimate use', v_admin_user, v_result.id);
    EXCEPTION
      WHEN OTHERS THEN
        v_legit_detail := format('REGRESSION -- chemin legitime casse -- sqlstate=%s message=%s', SQLSTATE, SQLERRM);
    END;
  END IF;

  RAISE EXCEPTION 'DIAG_RESULT: [1/2 bypass check] % | [2/2 legitimate path] %', v_bypass_detail, v_legit_detail;
END;
$do$;
