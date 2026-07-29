# Audit RLS et sécurité Supabase

Date de l'audit : 28 juillet 2026.
Source examinée : projet distant Supabase lié, migrations locales jusqu'à `20260728192000`, types générés et Server Functions TanStack.

## Synthèse

- La RLS est activée sur toutes les tables métier auditées, mais aucune table ne force la RLS pour son propriétaire. Ce dernier point est normal pour les migrations et le `service_role`, mais impose que les RPC `SECURITY DEFINER` soient strictement contrôlées.
- De nombreuses politiques de lecture à destination de `authenticated` utilisent `USING (true)`. Elles donnent aujourd'hui accès directement, sans filtre de rôle, aux personnes, contrats, documents, finances, wallets, stocks et données historiques.
- Les tables disposent encore de privilèges SQL larges pour `anon` et `authenticated`. La RLS bloque souvent les lignes, mais les privilèges doivent être réduits pour une défense en profondeur.
- Toutes les fonctions `SECURITY DEFINER` opérationnelles sont détenues par `postgres`. Au moment de l'audit, presque toutes étaient exécables par `anon` via le privilège `PUBLIC`, y compris les helpers de finance, de migration et de génération de notifications.
- Le bucket Storage `documents` est public et ses politiques permettent à tout utilisateur authentifié de lire, envoyer et mettre à jour un objet du bucket. Il contient 3 documents, tous adressés par une URL publique.
- Il n'existe pas encore de tables `roles`, `permissions` ou `role_permissions`. La source de vérité actuelle des rôles est `public.user_roles.role` (enum `app_role`).

## Rôles réellement présents

`super_admin`, `admin`, `gestionnaire`, `comptable`, `chauffeur`, `employe`, `lecture_seule`.

Les rôles RH, Opérations et Stocks demandés fonctionnellement ne sont pas encore des rôles distincts dans la base. Cet audit ne les crée pas en doublon : les droits actuels sont donc exprimés avec `gestionnaire` pour la gestion opérationnelle transversale, et le manque de granularité est documenté comme risque à traiter ultérieurement.

## État des ressources et correction ciblée

| Ressource | RLS / politiques observées | Sensibilité et risque | Correction prévue |
| --- | --- | --- | --- |
| `profiles` | RLS active ; lecture `authenticated` avec `USING (true)` ; écriture propre profil | nom, téléphone, avatar visibles à tous les comptes | lecture propre profil + administration seulement |
| `user_roles` | RLS active ; lecture propre profil et administration ; écriture administration | rôle d'autorisation | conserver le modèle, retirer les privilèges SQL inutiles ; ajouter des helpers fiables basés sur `auth.uid()` |
| `employees`, `drivers` | RLS active ; lecture `USING (true)` ; écriture admin/gestionnaire | coordonnées, permis, statut, données RH | lecture administration/gestionnaire, propre fiche si relation utilisateur ; aucune finance implicite |
| `contracts` et `contract_*_links` | RLS active ; lecture `USING (true)` ; écriture admin/gestionnaire | parties, dates, montants contractuels | lecture et écriture réservées à administration/gestionnaire ; liens alignés |
| `documents` et `document_*_links` | RLS active ; lecture `USING (true)` ; écriture admin/gestionnaire | contrats, identité, permis et pièces sensibles | lecture/gestion administration-gestionnaire, URLs signées pour fichiers privés |
| `vehicles`, `motorcycles`, affectations | RLS active ; lecture `USING (true)` ; écriture admin/gestionnaire | données opérationnelles et affectations | lecture administration/gestionnaire/comptable si nécessaire au contexte financier ; écriture RPC ou administration/gestionnaire |
| `farms`, `harvests` | RLS active ; lecture `USING (true)` ; écriture admin/gestionnaire | données agricoles, recettes liées | lecture administration/gestionnaire/comptable ; écriture administration/gestionnaire ou RPC métier |
| `motorcycle_maintenances`, `maintenances` / entretiens véhicule | RLS active ; lecture `USING (true)` (deux politiques sur entretien moto) | coûts et historique opérationnel | supprimer le doublon, lecture administration/gestionnaire/comptable ; mutations par RPC métier |
| `wallets` | RLS active ; lecture `USING (true)` ; écriture large finance/gestion | solde et trésorerie | lecture et mutations directes limitées à admin/super_admin/comptable ; mutations de solde par RPC |
| `finance_operations`, `finance_links`, `finance_*_links` | RLS active ; lecture `USING (true)` ; écriture directe finance/gestion | journal financier et relations de coût | lecture finance seulement ; aucune mutation directe par utilisateur, RPC typées uniquement |
| `salary_payments`, `finance_salary_links` | RLS active ; lecture `USING (true)` | salaires et paiements très sensibles | lecture finance/admin ; mutations seulement via RPC salaire |
| `business_finance_audit` | RLS active ; lecture finance/gestion | piste d'audit financière | lecture admin/super_admin/comptable ; aucune mutation directe |
| `revenues`, `expenses`, `payments`, `stocks` | RLS active ; trois premières tables lisibles par tous ; `stocks` sans politique | archives historiques | lecture admin/super_admin/comptable ; bloquer INSERT/UPDATE/DELETE pour les rôles applicatifs |
| `inventory_items`, `stock_movements`, `finance_stock_movement_links` | RLS active ; lecture `USING (true)` | quantité, coûts et mouvements | lecture administration/gestionnaire/comptable ; écritures via RPC mouvement |
| `notifications`, `notification_*_links` | RLS active ; notification et liens déjà filtrés par destinataire ou admin | alertes financières/RH possibles | conserver le filtre et renforcer les RPC de mise à jour ; ne pas accorder de mutation directe |
| `notification_alert_rules`, `company_settings`, `notification_generation_runs` | RLS active ; paramètres et règles lisibles par tous ; run limité aux gestionnaires | sécurité et fonctionnement du scheduler | lecture/écriture réservées aux rôles adéquats, exécution via RPC contrôlée |
| `saved_reports` | RLS active ; propriétaire ou partage ; l'insertion permet aujourd'hui `is_shared=true` à tout propriétaire | fuite par rapport partagé ou export | restreindre partage/modèle admin à admin/super_admin et vérifier côté RPC |
| `notification_generation_runs` | RLS active ; lecture admin/gestionnaire | historique du scheduler | conserver lecture d'exploitation, aucune mutation directe |

## Politiques permissives identifiées

Les politiques suivantes reposaient explicitement sur `USING (true)` pour `authenticated` :

- personnes et opérationnel : `profiles_read_all_auth`, `employees_read`, `drivers_read`, `vehicles_read`, `motos_read`, `farms_read`, `harvests_read`, `motorcycle_maintenances_read`, `Allow authenticated select`, `inv_items_read`, `stock_movements_read` ;
- finance : `wallets_read`, `finance_operations_read`, `finance_links_read`, toutes les politiques de lecture `finance_*_links`, `salary_payments_read` ;
- contrats et documents : `contracts_read`, les dix politiques `contract_*_links_read`, les huit politiques `document_*_links_read`, `documents_read` ;
- historique : `revenues_read`, `expenses_read`, `payments_read` ;
- paramètres : `settings_read`, `notification_alert_rules_read` ;
- intégration : `notion_database_mappings` expose aussi des politiques permissives et doit être traité comme une configuration d'administration.

Ces politiques seront remplacées par des politiques qui appellent un helper de rôle fondé exclusivement sur `auth.uid()`. Aucune politique `WITH CHECK (true)` n'a été trouvée sur les tables ciblées.

## Fonctions et RPC `SECURITY DEFINER`

Les fonctions métier, financières, d'affectation, de documents, de notifications et de reporting sont toutes détenues par `postgres`, ce qui est attendu pour les opérations atomiques. Le risque vient de leurs droits d'exécution : `anon` pouvait les appeler avant durcissement.

Les familles concernées sont :

- finance : `finance_create_operation`, `finance_update_operation`, `finance_delete_operation`, `update_wallet_balance`, `business_*`, achats véhicule/moto, entretiens, salaires et stock ;
- relations : affectations chauffeur, contrats et documents ;
- notifications : génération, résolution, planification, paramètres et mise à jour d'alertes ;
- reporting : `reporting_can_access_report`, `get_management_report*` ;
- migration : snapshots et backfill de finance historique.

La migration de sécurité doit :

1. révoquer `PUBLIC` et `anon` sur toutes les fonctions `SECURITY DEFINER` ;
2. ne redonner `authenticated` qu'aux RPC expressément appelées par l'application ;
3. réserver les helpers, snapshots, backfills et générateurs internes au `service_role` ou aux appels composés ;
4. définir un `search_path` explicite et sûr pour chaque fonction (`public, auth, pg_temp`, et `pg_catalog` pour le helper système) ;
5. conserver les contrôles de rôle internes aux RPC, même si la Server Function TypeScript les contrôle déjà.

## Vues et données exposées

Deux vues existent : `finance_wallet_reconciliation` et `finance_legacy_migration_reconciliation`. Elles sont détenues par `postgres`, ne disposent pas de RLS propre et ne doivent pas être ouvertes directement à `authenticated`. Les rapports utilisateurs doivent passer par les RPC de reporting qui vérifient leurs rôles.

## Storage

| Bucket | État observé | Risque | Correction prévue |
| --- | --- | --- | --- |
| `documents` | public ; `SELECT`, `INSERT`, `UPDATE` permis à tout `authenticated` pour tout objet du bucket | lecture publique, remplacement possible d'un fichier d'autrui, liens permanents | bucket privé, politiques sur utilisateurs de gestion, URLs signées côté Server Function, chemin `storage_path` lié au document |

Il n'existe aucun autre bucket au moment de l'audit. Les 3 URL publiques existantes seront reprises vers un chemin interne sans suppression de données ; les URL externes éventuelles restent inchangées.

## Surface applicative vérifiée

Les Server Functions transmettent le JWT utilisateur aux requêtes Supabase par `requireSupabaseAuth`; elles ne disposent donc pas d'un contournement serveur de la RLS. Les écritures atomiques passent déjà par des RPC dans les modules finance, véhicule, moto, entretien, salaire, stock, récolte, contrats, documents, affectations et notifications.

Les lectures directes concernent notamment les listes, fiches 360°, filtres de reporting, tableau de bord et documents. Les politiques ciblées doivent préserver les lectures autorisées ; les sections financières doivent retourner une autorisation refusée pour les rôles non financiers plutôt que des montants masqués uniquement dans React.

## Décisions de durcissement

- aucune table, donnée ni migration historique n'est supprimée ;
- les tables historiques deviennent lecture seule pour les rôles autorisés ;
- les opérations financières et soldes ne seront plus mutables directement par l'utilisateur ;
- les notifications restent limitées au destinataire ou à l'administration ;
- les exports de reporting sont protégés par les RPC existantes, et leur invocation sera journalisée sans conserver le contenu exporté ;
- la séparation RH / Opérations / Stocks ne peut pas être exprimée plus finement sans introduire des rôles ou permissions nouveaux : ce point reste explicitement ouvert.

## Durcissement appliqué et vérifié

Les migrations `20260728193000_harden_rls_and_erp_data_security.sql` et `20260728194000_refine_security_helpers_and_document_writes.sql` ont été appliquées au projet Supabase lié.

- les politiques de lecture permissives relevées sur les données sensibles ont été remplacées par des contrôles de rôle fondés sur `auth.uid()` ;
- les tables historiques `revenues`, `expenses`, `payments` et `stocks` sont consultables seulement par `super_admin`, `admin` ou `comptable`, sans écriture applicative directe ;
- les wallets, le journal financier, les liens financiers, les paiements salariaux et l'audit financier n'acceptent plus de mutation directe par `authenticated` ; les écritures autorisées passent par les RPC contrôlées ;
- le bucket `documents` est privé, les trois documents existants ont été repris vers `storage_path`, et l'application délivre désormais des URL signées temporaires ;
- les fonctions `SECURITY DEFINER` ont un `search_path` explicite, `anon` ne dispose plus d'`EXECUTE`, et seules les RPC applicatives nécessaires sont rendues exécutables par `authenticated` ;
- les vues de réconciliation financière ne sont plus accessibles directement à `anon` ni à `authenticated`.

La vérification distante confirme le bucket privé, l'absence d'`EXECUTE` pour `anon` sur les fonctions `SECURITY DEFINER` et l'absence de politique directe d'écriture pour les archives ciblées.
