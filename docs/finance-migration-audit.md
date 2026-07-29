# Audit de migration financière — LOT 4

Date de l'audit : 28 juillet 2026.
Source examinée : projet local, migrations Supabase et schéma distant du projet lié. Les volumes ci-dessous proviennent de requêtes en lecture seule sur la base distante.

## Conclusion

`finance_operations` est déjà le journal réellement utilisé par le module Finance et les achats de véhicules. En revanche, le tableau de bord et le module des dépenses lisent encore les modèles historiques. Les trois modèles historiques ne possèdent pas de clé `wallet_id` : une migration automatique ne peut donc pas choisir un wallet sans règle métier explicite. La procédure de backfill devra refuser toute migration de données historiques non nulles tant qu'un wallet de migration n'aura pas été configuré explicitement.

Les tables historiques sont actuellement vides. Le backfill pourra donc être appliqué sans écrire d'opération, tout en restant prêt à migrer une restauration future de manière contrôlée et idempotente.

## Inventaire du schéma distant

### `revenues` (historique)

| Colonne | Type | Nullabilité / rôle |
| --- | --- | --- |
| `id` | `uuid` | clé primaire |
| `date` | `date` | obligatoire, date de l'écriture |
| `source` | `text` | catégorie/source historique facultative |
| `montant` | `numeric` | obligatoire |
| `description` | `text` | facultative |
| `entity_type` | `entity_kind` | relation polymorphe historique facultative |
| `entity_id` | `uuid` | identifiant polymorphe historique facultatif |
| `notion_page_id` | `text` | unique, synchronisation Notion facultative |
| `notion_workspace_id` | `text` | synchronisation Notion facultative |
| `notion_last_synced_at` | `timestamptz` | synchronisation Notion facultative |
| `created_at`, `updated_at` | `timestamptz` | obligatoires |

Relations : aucune clé étrangère pour `entity_id`.
RLS : lecture pour les utilisateurs authentifiés ; écriture réservée aux rôles `super_admin`, `admin`, `gestionnaire` et `comptable`.

### `expenses` (historique)

Le schéma distant est différent de la première migration historique : il faut retenir le schéma distant ci-dessous.

| Colonne | Type | Nullabilité / rôle |
| --- | --- | --- |
| `id` | `uuid` | clé primaire |
| `farm_id` | `uuid` | obligatoire, FK vers `farms(id)` |
| `date` | `date` | obligatoire |
| `categorie` | `text` | obligatoire |
| `description` | `text` | facultative |
| `fournisseur` | `text` | facultatif |
| `montant` | `numeric` | obligatoire, défaut `0` |
| `created_at`, `updated_at` | `timestamptz` | obligatoires |

Relations : `farm_id → farms(id)`.
RLS : aucune politique n'a été retournée par l'inventaire `pg_policies` ; ce point doit être réconcilié dans la migration additive, sans ouvrir la table.

### `payments` (historique)

| Colonne | Type | Nullabilité / rôle |
| --- | --- | --- |
| `id` | `uuid` | clé primaire |
| `date` | `date` | obligatoire |
| `type` | `text` | obligatoire, défaut `entrant` ; valeurs observables prévues : `entrant`, `sortant` |
| `montant` | `numeric` | obligatoire |
| `methode` | `text` | facultative |
| `reference` | `text` | facultative |
| `contract_id` | `uuid` | facultative, FK vers `contracts(id)` |
| `description` | `text` | facultative |
| `notion_page_id` | `text` | unique, synchronisation Notion facultative |
| `notion_workspace_id` | `text` | synchronisation Notion facultative |
| `notion_last_synced_at` | `timestamptz` | synchronisation Notion facultative |
| `created_at`, `updated_at` | `timestamptz` | obligatoires |

Relations : `contract_id → contracts(id)`.
RLS : lecture pour les utilisateurs authentifiés ; écriture réservée aux rôles `super_admin`, `admin`, `gestionnaire` et `comptable`.

### `finance_operations` (journal cible)

| Colonne | Type | Rôle |
| --- | --- | --- |
| `id` | `uuid` | clé primaire |
| `wallet_id` | `uuid` | obligatoire, FK vers `wallets(id)` |
| `destination_wallet_id` | `uuid` | FK facultative vers `wallets(id)` |
| `type` | `text` | type d'opération ; données actuelles en ancien vocabulaire français |
| `category` | `text` | catégorie facultative |
| `amount` | `numeric` | montant obligatoire |
| `description`, `reference`, `payment_method`, `payment_reference`, `attachment_url`, `origin`, `notes`, `module` | `text` | métadonnées facultatives |
| `operation_date` | `date` | date métier |
| `status` | `text` | défaut `VALIDE` |
| `client`, `supplier`, `employee`, `project` | `text` | informations historiques/libres facultatives |
| `vehicle_id` | `uuid` | FK facultative vers `vehicles(id)` |
| `module_id` | `uuid` | identifiant historique polymorphe facultatif |
| `created_by` | `uuid` | auteur facultatif |
| `created_at`, `updated_at` | `timestamptz` | audit |

Relations : `wallet_id` et `destination_wallet_id → wallets(id)` ; `vehicle_id → vehicles(id)`. `module` + `module_id` est une relation polymorphe historique, non protégée par clé étrangère.

RLS : la table est protégée par RLS, mais l'audit a trouvé à la fois des anciennes politiques permissives (`finance_select`, `finance_insert`, `finance_update`, `finance_delete`) et les politiques de rôle ajoutées au lot 1. Les politiques permissives rendent les restrictions de rôle inopérantes ; elles devront être remplacées par des politiques cohérentes dans une migration additive.

### `finance_links`

| Colonne | Type | Rôle |
| --- | --- | --- |
| `id` | `uuid` | clé primaire |
| `finance_operation_id` | `uuid` | FK vers `finance_operations(id)` |
| `module` | `text` | type du module lié |
| `module_record_id` | `uuid` | identifiant de l'entité liée |
| `created_at` | `timestamptz` | audit |

Deux liens `VEHICLE` existent. La table est actuellement utilisée par l'automatisation d'achat de véhicule. Elle restera inchangée ; les liens de migration des tables historiques seront explicites et séparés.

### `wallets`

| Colonne | Type | Rôle |
| --- | --- | --- |
| `id` | `uuid` | clé primaire |
| `name`, `type` | `text` | identité du wallet |
| `balance` | `numeric` | solde matérialisé, recalculé par la fonction officielle |
| `color`, `icon` | `text` | présentation facultative |
| `is_default` | `boolean` | wallet par défaut éventuel |
| `created_at`, `updated_at` | `timestamptz` | audit |

RLS : même chevauchement entre anciennes politiques permissives et politiques de rôle que pour `finance_operations`. Cela devra être normalisé sans désactiver RLS.

## Volumes et montants avant migration

| Table | Lignes | Somme des montants |
| --- | ---: | ---: |
| `revenues` | 0 | 0 FCFA |
| `expenses` | 0 | 0 FCFA |
| `payments` | 0 | 0 FCFA |
| `finance_operations` | 11 | 17 600 444 FCFA (somme brute, tous types confondus) |
| `finance_links` | 2 | — |
| `wallets` | 5 | solde stocké total : -4 455 444 FCFA |

Les trois tables historiques ne contiennent donc actuellement aucune donnée sans wallet, aucune pièce jointe et aucune ligne impossible à mapper. Leur schéma ne comporte de toute façon pas de `wallet_id` : cette absence reste une contrainte bloquante pour toute restauration de données historiques non vides sans configuration métier préalable.

Répartition actuelle du journal existant :

| Type historique | Lignes | Montant brut |
| --- | ---: | ---: |
| `DEPENSE` | 4 | 11 000 444 FCFA |
| `RECETTE` | 1 | 45 000 FCFA |
| `TRANSFERT` | 2 | 55 000 FCFA |
| `VERSEMENT` | 4 | 6 500 000 FCFA |

Les cinq wallets ont été recalculés selon la fonction existante ; pour chacun, le solde stocké correspondait au solde calculé. Les montants doivent être interprétés par type (et non par somme brute du journal) : la somme brute ne constitue pas un solde.

## Usages applicatifs identifiés

| Modèle | Création / modification / suppression | Lecture / affichage | Autres dépendances |
| --- | --- | --- | --- |
| `revenues` | aucun server function applicatif direct trouvé | `src/lib/dashboard.functions.ts` | `src/lib/notion/mappings.ts`, route historique `src/routes/_authenticated/revenues.tsx` actuellement statique |
| `expenses` | `src/lib/expenses.functions.ts` | `src/components/expenses/expense-form.tsx`, `expense-table.tsx`, `src/routes/_authenticated/farms/$farmId.tsx`, tableau de bord | `src/lib/notion/mappings.ts`, route historique `src/routes/_authenticated/expenses.tsx` statique |
| `payments` | aucun server function applicatif direct trouvé | aucune table applicative active trouvée ; route `src/routes/_authenticated/payments.tsx` statique | `src/lib/notion/mappings.ts` |
| `finance_operations` | `src/lib/finance.functions.ts`, `src/lib/finance.service.ts`, `src/lib/vehicles.functions.ts` | `src/routes/_authenticated/finance.tsx`, composants `src/components/finance/*`, fiche véhicule | `finance_links`, fonctions de recalcul de wallet |
| `finance_links` | service financier et module véhicule | fiche véhicule | conservation obligatoire des liens `VEHICLE` existants |
| `wallets` | `src/lib/wallet.functions.ts`, recalcul PostgreSQL | route et composants wallets, formulaires finance/véhicule | `update_wallet_balance` |

Les mappings Notion des trois modèles historiques sont un risque de création indirecte de lignes : ils devront être gelés ou rendus explicitement archivistiques au moment de la bascule, après vérification de la fonction de synchronisation qui les consomme.

## Relations et données non automatiquement mappables

- `revenues.entity_type` + `entity_id` est une relation polymorphe sans FK. Les entités reconnues pourront être projetées vers des clés explicites (`farm_id`, `vehicle_id`, `motorcycle_id`, `driver_id`, `employee_id`, `contract_id`). Les valeurs inconnues seront conservées dans le lien d'archive et signalées, jamais transformées en relation inventée.
- `expenses.farm_id` se mappe explicitement vers `finance_operations.farm_id`, à ajouter de façon additive.
- `payments.contract_id` se mappe explicitement vers `finance_operations.contract_id`, à ajouter de façon additive.
- Aucune des trois tables historiques ne porte de wallet source ou destination. Un transfert interne ne peut donc pas être déduit de `payments` et ne sera jamais créé automatiquement. Les paiements `entrant`/`sortant`, liés éventuellement à un contrat, seront traités comme règlements externes (recette/dépense) et non comme transferts, sous réserve d'un wallet de migration explicitement choisi.

## Mapping proposé

Les nouveaux types techniques canoniques seront `REVENUE`, `EXPENSE`, `DEPOSIT` et `TRANSFER`. Les libellés visibles restent en français. Les valeurs françaises déjà présentes dans `finance_operations` seront normalisées une seule fois : `RECETTE → REVENUE`, `DEPENSE → EXPENSE`, `VERSEMENT → DEPOSIT`, `TRANSFERT → TRANSFER`.

| Source | Type cible | Champs préservés | Relation cible |
| --- | --- | --- | --- |
| `revenues` | `REVENUE` | `montant`, `date`, `description`, `source`, références Notion, dates d'audit | entité reconnue projetée vers FK explicite ; sinon métadonnée d'archive |
| `expenses` | `EXPENSE` | `montant`, `date`, `categorie`, `description`, `fournisseur`, dates d'audit | `farm_id` |
| `payments.type = entrant` | `REVENUE` | `montant`, `date`, `methode`, `reference`, `description`, données Notion, dates d'audit | `contract_id` |
| `payments.type = sortant` | `EXPENSE` | mêmes champs | `contract_id` |

`payments` n'est pas un transfert interne dans son schéma réel : il ne comporte ni wallet source, ni wallet destination, et son seul lien métier est un contrat. Si une donnée historique future devait représenter un transfert, elle devra être examinée et saisie comme transfert explicite ; elle ne sera pas devinée pendant le backfill.

## Prévention des doublons et sauvegarde prévues

La migration créera :

- une table de runs et six snapshots horodatés pour `revenues`, `expenses`, `payments`, `finance_operations`, `finance_links` et `wallets` ;
- les liens explicites uniques `finance_revenue_links`, `finance_expense_links` et `finance_payment_links` ;
- des index sur les FKs, dates et types ;
- une configuration de wallet de migration explicitement renseignée avant toute migration de données historiques non vides ;
- une fonction transactionnelle qui crée l'opération et son lien dans la même transaction ;
- des vues/fonctions de réconciliation par total, wallet, mois, catégorie et statut.

Restauration : sélectionner le `run_id` de snapshot documenté, restaurer les tables d'archive dans une transaction à partir de leur colonne `row_data`, supprimer uniquement les liens et opérations créés par ce run, puis exécuter la fonction officielle de recalcul sur chaque wallet concerné. Aucune restauration ne devra écraser une ligne active sans une validation métier distincte.

## Anomalies et risques ouverts

1. `expenses` distant ne correspond pas à sa première migration historique ; les types générés et le schéma distant doivent rester la source de vérité.
2. Les politiques RLS permissives existantes sur `finance_operations` et `wallets` contournent les politiques de rôle plus strictes ; elles doivent être remplacées de manière additive et testée.
3. Les modèles historiques n'ont pas de wallet. Une migration de données restaurées sans configuration de wallet doit s'arrêter sans écrire partiellement.
4. Les pages Recettes, Dépenses et Versements sont aujourd'hui des routes statiques ; le seul écran financier actif est la page Finance.
5. La synchronisation Notion peut constituer un écrivain indirect des tables historiques. Sa configuration doit être gelée lors de la bascule applicative.
6. Les liaisons `module`/`module_id` déjà présentes restent polymorphes et historiques. Les nouvelles relations introduites par ce lot privilégieront les FKs explicites.
