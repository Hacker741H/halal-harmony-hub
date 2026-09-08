-- STABILISATION TRANSVERSALE (2/3) -- durcissement des portes Finance.
--
-- Audit systematique en base reelle (pg_proc + has_function_privilege) de
-- toute fonction '_internal_%' du schema public plus les 5 helpers de
-- permission Finance/Wallets connus : 19 fonctions '_internal_*' avaient
-- encore EXECUTE accorde a authenticated (2 meme a anon), alors que la
-- convention deja etablie dans ce depot (cf. le balayage REVOKE de
-- 20260729092000_apply_permissions_to_rls_and_rpcs.sql et le REVOKE
-- partiel de 20260823000000_add_wallet_parent_hierarchy.sql) est que ces
-- fonctions ne sont jamais des points d'entree publics -- seul leur
-- wrapper public (qui verifie permission_require(...) en premier) doit
-- pouvoir les atteindre.
--
-- Deux de ces 19 sont EXPLOITABLES DES AUJOURD'HUI, prouve par test
-- garanti-annule (rollback absolu) contre la production reelle : un vrai
-- utilisateur avec le role caissier (aucune permission finance.*/
-- wallets.manage) a reussi a appeler _internal_create_finance_operation
-- directement et a creer une vraie ligne finance_operations sur un vrai
-- wallet -- le corps de cette fonction ne verifie AUCUNE permission, pas
-- meme auth.uid() IS NOT NULL. _internal_course_upsert_finance a le meme
-- defaut (aucune verification interne) et n'a jamais eu de REVOKE du
-- tout, contrairement a _internal_create_finance_operation dont le
-- REVOKE existant (20260823000000, lignes 302-303) couvre PUBLIC et anon
-- mais pas authenticated -- un oubli precis, pas une absence totale de
-- protection voulue.
--
-- Les 17 autres n'ont PAS d'impact financier direct demontrable :
-- - _internal_plan_wallet_parent_conversion verifie deja en interne
--   _internal_require_wallet_hierarchy_manage() -- reellement auto-gardee
--   malgre le nom '_internal_'.
-- - _internal_require_wallet_hierarchy_manage / _internal_require_wallet_
--   read SONT des verificateurs de permission (user_has_any_permission) --
--   les appeler directement ne fait qu'executer le controle lui-meme.
-- - _internal_enforce_wallet_not_parent / _internal_track_business_
--   location_inventory_item_price sont des fonctions TRIGGER (RETURNS
--   trigger) -- Postgres refuse de les executer hors contexte de
--   declencheur (NEW/OLD/TG_OP non definis), la GRANT est vestige, sans
--   effet exploitable.
-- - Le reste (generateurs de numeros de sequence, validation pure sans
--   ecriture, notifications) n'a aucun effet financier direct.
-- Revoques ici quand meme, par hygiene et defense en profondeur -- pour
-- restaurer l'invariant "aucune fonction _internal_* jamais appelable
-- directement", plus robuste face a une future migration que de ne
-- fermer que les deux cas prouves aujourd'hui.
--
-- Correctif additif pur : REVOKE ne touche aucune donnee, aucune ligne
-- existante, aucun grant legitime (les wrappers publics restent
-- fonctionnels -- un appel interne entre fonctions SECURITY DEFINER
-- s'execute comme le proprietaire de la fonction, jamais comme
-- authenticated, exactement le mecanisme deja en place et deja verifie
-- fonctionnel pour les 28 fonctions renommees par 20260729092000).

REVOKE EXECUTE ON FUNCTION public._internal_create_finance_operation(jsonb, text, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._internal_course_upsert_finance(uuid, text, numeric, date, text, text, transport_missions, text) FROM authenticated, anon;

REVOKE EXECUTE ON FUNCTION public._internal_commerce_pos_session_commercial_totals(text, text, uuid, uuid) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_create_transport_course_notification(text, text, text, text, uuid, date, uuid, uuid) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_enforce_wallet_not_parent() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_ensure_asset_wallet(text, text, text, uuid, uuid, uuid) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_ensure_module_general_wallet(text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_next_client_number() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_next_commercial_invoice_number() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_next_commercial_sale_number() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_next_transport_invoice_number() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_next_transport_mission_number() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_plan_wallet_parent_conversion(uuid, jsonb) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_refresh_transport_course_budget_notification(uuid) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_require_wallet_hierarchy_manage() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_require_wallet_read() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_track_business_location_inventory_item_price() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_upsert_commercial_sale_lines(uuid, jsonb) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_validate_client_payload(jsonb) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._internal_validate_wallet_parent_link(uuid, uuid) FROM authenticated, anon;
