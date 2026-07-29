# Audit de base de données — Lot 1

Date : 28 juillet 2026
Périmètre : migrations `supabase/migrations`, snapshot typé `src/integrations/supabase/types.ts` et références applicatives sous `src/`.

## Méthode et limite de vérification distante

`types.ts` est le snapshot du schéma Supabase consommé par l'application et sert ici de référence du schéma distant attendu. Le CLI Supabase est lié au projet `rpdhmranermceanyginr`, mais cette session non interactive ne dispose pas du jeton CLI de l'opérateur ; la liste des migrations réellement appliquées au distant ne peut donc pas être lue ici. Avant le déploiement, exécuter `supabase migration list` depuis un terminal authentifié et comparer son résultat à ce document.

## Inventaire des tables

| Table | Migration locale | Snapshot `types.ts` | Utilisation applicative | État |
| --- | --- | --- | --- | --- |
| `profiles`, `user_roles` | Oui | Oui | Authentification et RLS | Socle actif |
| `employees`, `drivers` | Oui | Oui | CRUD employés/chauffeurs | Actif ; `drivers.employee_id` est une FK |
| `motorcycles` | Oui | Oui | CRUD, fiche et entretiens moto | Actif ; `driver_id` est une FK |
| `vehicles` | Oui, schéma ancien | Oui, schéma différent | CRUD et achat financier | Actif, mais dérive de schéma |
| `farms`, `harvests` | Oui | Oui | CRUD exploitation et récoltes | Actif ; `harvests.farm_id` est une FK |
| `expenses`, `revenues`, `payments` | Oui | Oui | Dépenses exploitation, dashboard, placeholders | Historiques à migrer vers le journal unique |
| `wallets`, `finance_operations`, `finance_links` | **Non** | Oui | Finance, wallets, achats de véhicules | Actifs dans le code, non reproductibles depuis les migrations |
| `inventory_items`, `inventory_movements` | Oui | Oui | Le module Stocks utilise `inventory_items` | Cible stock valide |
| `stocks` | Oui, migration isolée | Oui | Aucun accès runtime | Doublon historique de `inventory_items` |
| `motorcycle_maintenances` | **Non** | Oui | Fiche moto et entretiens | Actif dans le code, non reproductible |
| `maintenances` | Oui | Oui | Aucun accès runtime | Modèle générique non utilisé |
| `documents` | Oui | Oui | Upload direct depuis une exploitation | Actif mais seulement pour les exploitations |
| `contracts`, `notifications`, `company_settings`, `notion_database_mappings` | Oui | Oui | Pages placeholder ou mappings Notion | Schéma présent, fonctionnalités non finalisées |

## Écarts migrations / schéma consommé

1. Les tables `wallets`, `finance_operations`, `finance_links` et `motorcycle_maintenances`, ainsi que la fonction `update_wallet_balance(uuid)`, existent dans le snapshot typé et sont appelées par le code, mais ne sont créées par aucune migration locale.
2. La migration initiale `vehicles` utilise `immatriculation`, `marque`, `modele`, `annee` et `statut`. Le code courant et `types.ts` utilisent `registration`, `brand`, `model`, `year`, `status`, ainsi que les colonnes d'achat. Une base reconstruite uniquement avec les migrations locales ne serait pas compatible.
3. La migration initiale `expenses` est polymorphe (`entity_type`, `entity_id`), alors que le code courant et `types.ts` utilisent `farm_id`, `fournisseur` et une relation vers `farms`.
4. La migration `stocks` ajoute une seconde table, alors que le code du module Stocks utilise déjà `inventory_items`.
5. Les mappings Notion des véhicules utilisent encore les anciens noms de colonnes (`immatriculation`, `marque`, `modele`, `annee`, `statut`).

## Relations et intégrité référentielle

### Clés étrangères présentes

- `drivers.employee_id -> employees.id`
- `motorcycles.driver_id -> drivers.id`
- `vehicles.driver_id -> drivers.id`
- `vehicles.purchase_wallet_id -> wallets.id` (snapshot typé)
- `harvests.farm_id -> farms.id`
- `expenses.farm_id -> farms.id` (snapshot typé)
- `payments.contract_id -> contracts.id`
- `inventory_movements.item_id -> inventory_items.id`
- `motorcycle_maintenances.motorcycle_id -> motorcycles.id` (snapshot typé)
- `finance_operations.wallet_id` et `destination_wallet_id -> wallets.id` (snapshot typé)
- `finance_links.finance_operation_id -> finance_operations.id` (snapshot typé)

### Relations polymorphes à remplacer progressivement

- `contracts.entity_type + entity_id`
- ancien modèle `expenses.entity_type + entity_id`
- `revenues.entity_type + entity_id`
- `documents.entity_type + entity_id`
- `maintenances.entity_type + entity_id`
- `finance_links.module + module_record_id`

Ces paires ne garantissent pas qu'une entité cible existe. Elles restent inchangées dans ce lot afin de préserver les données. Les futurs liens devront passer par des tables d'association à clés étrangères explicites (affectations, documents, contrats et écritures source).

## RLS et droits

- La migration initiale active RLS sur les tables du socle et autorise la lecture aux utilisateurs authentifiés. Les écritures sont limitées selon les rôles `super_admin`, `admin`, `gestionnaire` et, pour la finance, `comptable`.
- La migration de création de `harvests` ne comportait pas de droits ni de politiques. La migration locale `20260728123000_add_harvests_rls_policies.sql` comble ce manque.
- Les migrations de `stocks` et des tables absentes (`wallets`, finance, entretiens moto) ne définissent pas de RLS localement. La migration ajoutée dans ce lot crée les politiques manquantes sans modifier une politique déjà présente.

## Modèles uniques retenus

| Domaine | Modèle cible | Modèles conservés provisoirement | Décision |
| --- | --- | --- | --- |
| Journal financier | `finance_operations` | `revenues`, `expenses`, `payments` | Aucune suppression ni bascule UI dans ce lot |
| Trésorerie | `wallets` | Aucun | Les opérations portent un wallet source et, pour les transferts, un wallet destination |
| Stock | `inventory_items` | `stocks` | Le code utilise déjà `inventory_items` ; `stocks` reste intact jusqu'à inventaire et migration des données |
| Entretien moto | `motorcycle_maintenances` | `maintenances` | Le modèle générique n'est pas supprimé tant que les entretiens véhicule ne sont pas conçus |

## Plan de migration des données historiques

### Finance

`revenues`, `expenses` et `payments` ne possèdent pas tous un `wallet_id`. Une migration automatique vers `finance_operations` serait donc risquée sans règle métier de rattachement à un wallet.

Avant toute copie de données :

1. sauvegarder les lignes historiques et les soldes de wallets dans des tables de contrôle ;
2. choisir un wallet par défaut et une règle explicite pour chaque enregistrement sans wallet ;
3. créer les écritures `RECETTE`, `DEPENSE`, `VERSEMENT` ou `TRANSFERT` avec une référence d'origine ;
4. comparer les montants, les volumes et les soldes avant/après ;
5. basculer les pages Recettes, Dépenses et Versements en vues filtrées de `finance_operations` ;
6. conserver les tables historiques en lecture seule jusqu'à validation métier.

Fichiers actuellement liés aux anciens modèles :

- `src/lib/dashboard.functions.ts` lit `revenues` et `expenses`.
- `src/lib/expenses.functions.ts`, `src/components/expenses/expense-form.tsx`, `src/components/expenses/expense-table.tsx` et `src/routes/_authenticated/farms/$farmId.tsx` utilisent `expenses`.
- `src/lib/notion/mappings.ts` référence `revenues`, `expenses` et `payments`.
- `src/integrations/supabase/types.ts` et les migrations décrivent les trois tables.

### Stock

`stocks` contient des informations supplémentaires (fournisseur, emplacement, prix, expiration) absentes de `inventory_items`. Il faut donc d'abord définir le futur modèle d'article et des mouvements avant de copier les données. Aucun enregistrement ne sera supprimé ou fusionné dans ce lot.

Fichiers concernés :

- `src/lib/stocks.functions.ts`, `src/components/stocks/*` et `src/routes/_authenticated/stocks.tsx` utilisent déjà `inventory_items`.
- `supabase/migrations/20260722113000_create_stocks_table.sql` et `src/integrations/supabase/types.ts` décrivent le modèle historique `stocks`.

## Code mort certain traité dans ce lot

- Dashboard statique `/dashboard`, redondant avec le dashboard dynamique `/` utilisé par la navigation.
- Route publique factice `/vehicles/$vehicleId` qui n'affiche qu'un texte de démonstration.
- Composant `VehicleDetails` non importé et dépendant de cinq composants inexistants.
- Ancien `VehicleForm` sous `src/components/ui/vehicles.tsx`, non importé et incompatible avec le schéma courant.
- Fichiers vides `src/lib/vehicles/vehicle.functions.ts` et `src/lib/vehicles/vehicle.service.ts`.

Le service financier non importé et les server functions de documents sont conservés : leur suppression pourrait gêner le prochain lot de centralisation.

## Risques à traiter après le lot 1

- Vérifier le schéma et les migrations réellement appliquées sur Supabase avec un CLI authentifié.
- Décider le wallet de rattachement des opérations financières historiques.
- Remplacer les relations polymorphes par des associations à clés étrangères, sans perte d'historique.
- Mettre les créations métier et leurs écritures financières dans des transactions atomiques côté base.
- Regénérer `src/integrations/supabase/types.ts` après chaque migration appliquée.
