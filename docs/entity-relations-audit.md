# Audit relationnel — lot 6

Audit réalisé le 28 juillet 2026, avant toute évolution relationnelle. La base Supabase liée a été interrogée directement ; son schéma appliqué est la source de vérité.

## Synthèse et modèle cible

Le modèle à conserver est le suivant :

```text
employees 1 ── 0..1 drivers
drivers   1 ── N driver_vehicle_assignments ── 1 vehicles
drivers   1 ── N driver_motorcycle_assignments ── 1 motorcycles
```

`employees` reste la source unique des informations personnelles (nom, prénom, téléphone, e-mail, poste, matricule, salaire). `drivers` est un profil métier facultatif lié par `drivers.employee_id` et ne doit contenir que les informations de conduite (permis, catégorie, échéance, statut et notes).

Les anciennes colonnes `vehicles.driver_id` et `motorcycles.driver_id` restent nécessaires à la compatibilité pendant le lot. Elles deviendront des projections du chauffeur actuellement affecté, alimentées transactionnellement par les nouvelles tables d'affectation, et ne seront pas supprimées dans ce lot.

## État des données observé

| Table | Lignes distantes |
| --- | ---: |
| `employees` | 1 |
| `drivers` | 1 |
| `vehicles` | 1 |
| `motorcycles` | 2 |
| `farms` | 1 |
| `contracts` | 0 |
| `documents` | 2 |
| `harvests` | 1 |
| `maintenances` | 0 |
| `motorcycle_maintenances` | 0 |
| `salary_payments` | 0 |

Les tables `driver_vehicle_assignments` et `driver_motorcycle_assignments` n'existent pas encore dans le schéma distant. Le backfill part donc des valeurs non nulles de `vehicles.driver_id` et `motorcycles.driver_id` ; toute date de début inconnue devra rester `NULL`, sans date inventée.

## Entités et relations existantes

### Employés

- **Clé primaire :** `employees.id`.
- **Source de vérité :** identité, coordonnées, emploi, matricule, salaire théorique et statut.
- **Relations existantes :** `drivers.employee_id → employees.id` (`ON DELETE SET NULL`), `salary_payments.employee_id → employees.id` (`ON DELETE RESTRICT`), `finance_operations.employee_id → employees.id` (`ON DELETE SET NULL`, contrainte historique `NOT VALID`).
- **Historique existant :** paiements de salaire et opérations financières ; aucun journal général relationnel.
- **Interface existante :** liste, formulaire et dialogue de paiement de salaire ; aucune route `/employees/$employeeId`.
- **Risque :** la suppression d'un employé est actuellement exposée par l'interface mais peut être bloquée par les salaires. La fiche 360° doit privilégier l'archivage au contournement de cette contrainte.

### Chauffeurs

- **Clé primaire :** `drivers.id`.
- **Relations existantes :** profil facultatif vers `employees`, références directes depuis `vehicles.driver_id`, `motorcycles.driver_id`, `salary_payments.driver_id` et `finance_operations.driver_id`.
- **Données propres :** numéro/catégorie/expiration du permis, statut et notes. Aucune donnée personnelle n'est stockée dans `drivers`.
- **Interface existante :** liste et formulaire, avec sélection d'un employé ; aucune route `/drivers/$driverId`.
- **Doublon fonctionnel :** le formulaire véhicule et le formulaire moto proposent encore le champ direct `driver_id`. Cela ne peut pas produire d'historique.
- **Risque :** `drivers.employee_id` est nullable en base alors que le formulaire le rend obligatoire. Les données historiques sans employé doivent être affichables et signalées, non supprimées.

### Véhicules

- **Clé primaire :** `vehicles.id`.
- **Relations existantes :** `driver_id → drivers.id`, `purchase_wallet_id → wallets.id`, et références depuis `finance_operations.vehicle_id`. Les entretiens utilisent encore `maintenances(entity_type = 'vehicule', entity_id)` sans clé étrangère.
- **Interface existante :** route `/vehicles/$vehicleId` avec Informations, Entretiens, Finances, Affectations, Documents, Historique et Statistiques. L'onglet Affectations ne montre que le `driver_id` actuel ; Documents interroge le lien polymorphe historique.
- **Manques :** pas d'historique d'affectations, pas de création/clôture d'affectation dans la fiche, pas de lien de navigation vers le chauffeur.

### Motos

- **Clé primaire :** `motorcycles.id`.
- **Relations existantes :** `driver_id → drivers.id`, `purchase_wallet_id → wallets.id`, `motorcycle_maintenances.motorcycle_id → motorcycles.id`, et références depuis `finance_operations.motorcycle_id`.
- **Interface existante :** route `/motorcycles/$motorcycleId`, entretiens et finances disponibles ; l'onglet Documents est encore un état d'attente et l'affectation n'a pas d'historique.
- **Manques :** mêmes tables d'affectation et navigation bidirectionnelle que les véhicules.

### Exploitations

- **Clé primaire :** `farms.id`.
- **Relations existantes :** `harvests.farm_id → farms.id`, `finance_operations.farm_id → farms.id` et lien historique polymorphe dans `documents`/`contracts`.
- **Interface existante :** route `/farms/$farmId`, récoltes, finances et téléversement de documents. `DocumentUpload` est actuellement spécialisé exploitation.
- **Risque :** cette spécialisation réécrit `entity_type = 'exploitation'`, même lorsqu'un document doit appartenir à une autre entité.

### Contrats

- **Clé primaire :** `contracts.id`.
- **Colonnes relationnelles actuelles :** uniquement `entity_type` et `entity_id`, sans clé étrangère. Les contrats peuvent être référencés par `salary_payments.contract_id` et `finance_operations.contract_id`.
- **Interface existante :** page `/contracts` placeholder ; aucun formulaire, aucune fonction serveur métier ni fiche liée.
- **Décision à prendre après mise en place de la base relationnelle :** ne pas réutiliser le polymorphisme pour les nouvelles écritures. La migration additive ajoutera des clés étrangères explicites optionnelles (`employee_id`, `driver_id`, `vehicle_id`, `motorcycle_id`, `farm_id`) adaptées aux contrats à partie unique. Un contrat multi-entités nécessitera ensuite une table de liaison dédiée ; aucune donnée n'existe actuellement dans `contracts`.

### Documents

- **Clé primaire :** `documents.id`.
- **Colonnes relationnelles actuelles :** `entity_type` et `entity_id`, sans clé étrangère ; `nom`, `type`, `url`, dates d'émission/expiration et métadonnées Notion.
- **Interface existante :** page `/documents` placeholder, composant `DocumentUpload` seulement pour les exploitations, lecture dans la fiche véhicule ; aucune gestion complète pour moto, employé, chauffeur ou contrat.
- **Cible :** conserver les colonnes polymorphes pour l'historique, mais utiliser des tables d'association à clés étrangères explicites pour les nouvelles liaisons : employé, chauffeur, véhicule, moto, exploitation, contrat, entretien véhicule et entretien moto. Un document peut ainsi être rattaché à plusieurs entités si nécessaire sans recopier ses métadonnées.

## Relations polymorphes et données historiques

| Table | Relation polymorphe | Décision |
| --- | --- | --- |
| `contracts` | `entity_type`, `entity_id` | Lecture historique conservée ; nouvelles relations explicites. |
| `documents` | `entity_type`, `entity_id` | Lecture historique et rétrocompatibilité conservées ; nouvelles liaisons explicites. |
| `maintenances` | `entity_type`, `entity_id` | Hors refonte de table dans ce lot ; déjà reliée à la finance. Les liaisons documentaires viseront l'identifiant de l'entretien. |
| `revenues`, `expenses` historiques | `entity_type`, `entity_id` | Dépréciées depuis le lot Finance ; non modifiées dans ce lot. |

## Composants et Server Functions à réutiliser

| Élément | Usage prévu |
| --- | --- |
| `src/lib/drivers.functions.ts` | Étendre avec la lecture 360° et les listes de sélection, sans dupliquer le profil chauffeur. |
| `src/lib/employees.functions.ts` | Étendre avec lecture 360° et recherche du profil chauffeur. |
| `src/lib/vehicles.functions.ts` | Remplacer la lecture directe de `driver_id` dans la fiche par les affectations, tout en gardant la compatibilité. |
| `src/lib/motorcycles.functions.ts` | Même évolution pour les motos. |
| `src/lib/documents.functions.ts` | Normaliser les validateurs et généraliser le composant d'upload existant. |
| `src/components/documents/document-upload.tsx` | Base du formulaire commun ; à rendre relationnel et réutilisable. |
| `src/components/drivers/driver-table.tsx` / `src/components/employees/employee-table.tsx` | Ajouter l'action « Voir la fiche ». |
| `src/routes/_authenticated/vehicles/$vehicleId.tsx` | Fiche véhicule existante à compléter, sans route parallèle. |
| `src/routes/_authenticated/motorcycles/$motorcycleId.tsx` | Fiche moto existante à compléter. |

## Politiques RLS et permissions

Les tables cœur existantes sont en RLS avec lecture authentifiée et écriture réservée aux rôles `super_admin`, `admin`, `gestionnaire` : employés, chauffeurs, véhicules, motos, exploitations, contrats, documents et entretiens. Les documents et contrats ne distinguent toutefois pas encore les droits d'accès aux salaires/finances dans une fiche 360°.

`salary_payments` n'a qu'une politique de lecture authentifiée : les écritures passent par les RPC `SECURITY DEFINER` du lot 5. Les nouvelles fiches doivent continuer à consommer ce flux et ne doivent pas ajouter d'écriture directe. Les nouvelles tables d'affectation et de liaison documentaire devront reprendre le même niveau de lecture/écriture que les entités concernées, sans élargir l'accès aux salaires ou aux opérations financières.

## Risques et plan de reprise

1. **Affectations existantes :** les dates de début ne sont pas portées par `vehicles.driver_id` ni `motorcycles.driver_id`. Le backfill créera une affectation active avec `start_date = NULL` et une note d'origine ; aucune date artificielle.
2. **Concurrence :** deux formulaires ne doivent pas pouvoir affecter simultanément deux chauffeurs au même actif. Des index uniques partiels et des RPC transactionnelles fermeront l'affectation active précédente avant l'insertion.
3. **Colonnes historiques :** `driver_id` ne sera ni supprimé ni renommé. Les RPC mettront à jour sa projection actuelle pendant la période de transition.
4. **Documents et contrats historiques :** aucune ligne n'est modifiée ni supprimée ; des liaisons explicites seront ajoutées avec backfill uniquement lorsque le type et l'identifiant sont valides.
5. **Permissions :** les onglets Finances et Salaires doivent rester conditionnés aux données déjà autorisées par les politiques/RPC existantes ; ce lot ne crée pas de rôle métier supplémentaire.
6. **Contrats :** la table est vide. Le schéma explicite pourra être préparé sans choix de reprise de données, mais l'interface opérationnelle doit rester limitée aux relations que le modèle actuel permet de déterminer sans ambiguïté.
