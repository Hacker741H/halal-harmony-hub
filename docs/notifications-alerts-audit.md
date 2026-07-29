# Audit — notifications et alertes ERP

Date de l'audit : 28 juillet 2026. Cet audit a été effectué avant toute
modification du schéma ou du code du lot 7. Le schéma distant lié à Supabase est
la source de vérité ; les résultats ont été comparés aux migrations locales et à
`src/integrations/supabase/types.ts`.

## État actuel

La table `notifications` existe, mais elle est un modèle minimal : `id`,
`user_id`, `type`, `titre`, `message`, `lu`, `created_at`. La route
`/notifications` est un `ModulePlaceholder`, la barre latérale n'a pas de
compteur et le tableau de bord ne calcule que les documents arrivant à échéance.
Il n'existe aucun moteur de génération, aucune clé de déduplication, aucune
relation explicite vers une entité et aucune fonction de résolution.

La migration fondatrice `20260719105553_…sql` est cohérente avec ce constat.
Le type Supabase généré contient également ce modèle minimal. Aucune migration
locale ultérieure ne modifie `notifications`.

## Sources d'alerte auditées

| Alerte | Source réelle | Donnée disponible | Niveau / destinataires proposés | Route | Résolution | État |
| --- | --- | --- | --- | --- | --- | --- |
| Permis chauffeur | `drivers.date_expiration_permis` | Oui ; 1 date renseignée | WARNING à 30/15/7 jours, CRITICAL le jour J et après ; admin, gestionnaire | `/drivers/$driverId` | Date déplacée, permis renouvelé ou chauffeur archivé | Implémentable |
| Contrat | `contracts.date_fin` | Oui, mais aucune date renseignée actuellement | WARNING / CRITICAL ; admin, gestionnaire, comptable si contrat financier | `/contracts/$contractId` | Date déplacée ou contrat clôturé | Implémentable |
| Document | `documents.date_expiration`, hors `archived_at` | Oui ; 3 documents actifs sans date d'expiration | WARNING / CRITICAL ; admin, gestionnaire | fiche liée si connue, sinon `/documents` | Expiration supprimée/déplacée ou document archivé | Implémentable |
| Assurance moto | `motorcycles.assurance_expiration` | Oui, 2 valeurs actuellement nulles | WARNING / CRITICAL ; admin, gestionnaire | `/motorcycles/$motorcycleId` | Date renouvelée ou moto archivée | Implémentable |
| Visite technique moto | `motorcycles.visite_expiration` | Oui, 2 valeurs actuellement nulles | WARNING / CRITICAL ; admin, gestionnaire | `/motorcycles/$motorcycleId` | Date renouvelée ou moto archivée | Implémentable |
| Entretien moto par date | `motorcycle_maintenances.next_date` | Oui ; aucune prochaine date actuellement | WARNING / CRITICAL ; admin, gestionnaire | `/motorcycles/$motorcycleId?tab=entretiens` | Prochaine date déplacée ou entretien clos/remplacé | Implémentable |
| Entretien moto par kilométrage | `motorcycle_maintenances.next_kilometrage` + `motorcycles.kilometrage` | Oui | WARNING à l'atteinte, CRITICAL après dépassement ; admin, gestionnaire | `/motorcycles/$motorcycleId?tab=entretiens` | Kilométrage cible déplacé ou entretien enregistré | Implémentable |
| Entretien véhicule | `maintenances` | Seulement l'historique (`date`, `kilometrage`) ; aucune date/km d'échéance | — | `/vehicles/$vehicleId?tab=entretiens` | — | Non implémenté : données d'échéance absentes |
| Assurance / visite véhicule | `vehicles` | Aucun champ d'assurance ou de visite dans le schéma distant | — | `/vehicles/$vehicleId` | — | Non implémenté : aucune colonne inventée |
| Wallet négatif | `wallets.balance` | Oui ; aucun wallet négatif actuellement | CRITICAL ; super_admin, admin, gestionnaire, comptable | `/wallets` | Solde redevenu supérieur ou égal à zéro | Implémentable |
| Wallet sous seuil | `wallets` | Aucun seuil par wallet | — | `/wallets` | — | Différé : seuil métier absent |
| Stock faible | `inventory_items.stock_actuel`, `seuil_alerte` | Oui ; 1 article possède un seuil | WARNING sous seuil, CRITICAL à zéro ou moins ; admin, gestionnaire | `/stocks` | Réapprovisionnement au-dessus du seuil | Implémentable |
| Salaire attendu / impayé | `employees.salaire_base`, `salary_payments.period_start`, `paid_at`, `status` | Paiements réels présents comme modèle, mais aucune périodicité ni échéance salariale | — | `/employees/$employeeId` | — | Différé : ne pas déduire une dette d'un salaire théorique |
| Affectation incohérente | `driver_vehicle_assignments`, `driver_motorcycle_assignments`, anciens `vehicles.driver_id` / `motorcycles.driver_id` | Oui depuis le lot 6 | WARNING ; admin, gestionnaire | `/vehicles/$vehicleId` ou `/motorcycles/$motorcycleId` | Affectation clôturée/corrigée | Implémentable |

Les seuils retenus pour les échéances sont 30, 15 et 7 jours, puis le jour de
l'échéance et après expiration. Une même notification déterministe monte de
`INFO` (30 jours) à `WARNING` (15 puis 7 jours), puis `CRITICAL` au jour J et
après expiration ; aucun doublon n'est créé entre deux seuils. Ils seront
constants dans ce lot : il n'existe pas encore de table de configuration métier
des alertes. Ils pourront être rendus configurables dans un lot Paramètres
ultérieur sans modifier les relations ni les clés de déduplication.

## Relations, routes et composants réutilisables

- Les relations du lot 6 sont explicites : `driver_vehicle_assignments`,
  `driver_motorcycle_assignments`, les liaisons de contrats et de documents.
- `drivers.employee_id → employees.id`, les affectations et les liens documents
  permettent de retrouver l'entité source sans recopier de nom ou de téléphone.
- Les fiches `/drivers/$driverId`, `/employees/$employeeId`,
  `/vehicles/$vehicleId`, `/motorcycles/$motorcycleId`, `/farms/$farmId` et
  `/contracts/$contractId` existent. La bibliothèque Documents reste une liste
  sans fiche détail : son alerte ouvre `/documents`.
- Les composants `Badge`, `Card`, `Button`, `Input`, `Select`, `Tabs`, le format
  FCFA et `AppSidebar` sont réutilisables. Aucune notification UI existante ne
  peut être réemployée car la page est statique.

## Relations polymorphes et modèle cible

Les colonnes historiques `entity_type` / `entity_id` des contrats, documents et
maintenances restent présentes. Elles ne seront pas utilisées comme relation
unique des notifications. Le modèle cible conserve `notifications.user_id` pour
éviter un renommage destructif, et ajoute les métadonnées de cycle de vie :
`severity`, `status`, `due_date`, `entity_route`, `read_at`, `resolved_at`,
`snoozed_until` et `deduplication_key`.

Les liens explicites prévus sont :

- `notification_driver_links`
- `notification_employee_links`
- `notification_contract_links`
- `notification_document_links`
- `notification_vehicle_links`
- `notification_motorcycle_links`
- `notification_vehicle_maintenance_links`
- `notification_motorcycle_maintenance_links`
- `notification_wallet_links`
- `notification_inventory_links`

Chaque lien aura deux clés étrangères, une contrainte `UNIQUE` et un index. Il
n'y aura pas de nouvelle table polymorphe générique.

## Déduplication et cycle de vie proposés

La clé métier sera déterministe, inclura la source, l'événement, la date ou le
seuil, et l'utilisateur destinataire. Exemples :

```text
DRIVER_LICENSE_EXPIRY:{driverId}:{expiryDate}:USER:{userId}
DOCUMENT_EXPIRY:{documentId}:{expiryDate}:USER:{userId}
LOW_STOCK:{inventoryItemId}:{threshold}:USER:{userId}
NEGATIVE_WALLET:{walletId}:USER:{userId}
```

Une contrainte unique partielle portera sur les alertes actives (`UNREAD`,
`READ`, `SNOOZED`). Une régénération mettra à jour l'alerte existante plutôt que
d'en créer une nouvelle. Une date ou un seuil modifié crée une situation
distincte ; l'ancienne est résolue automatiquement. Les alertes dont la source
ne remplit plus la condition sont passées à `RESOLVED` par le moteur SQL.

## Rôles et RLS constatés

Les rôles réels sont `super_admin`, `admin`, `gestionnaire`, `comptable`,
`chauffeur`, `employe` et `lecture_seule`. Dans les données actuelles, un
`super_admin` et un utilisateur `lecture_seule` sont affectés.

La RLS actuelle des notifications autorise un utilisateur à lire ses alertes et
toutes les alertes `user_id IS NULL` (broadcast). Elle autorise les rôles admin
à tout écrire. Ce modèle n'est pas adapté aux alertes financières ou salariales
car un broadcast les exposerait à tous les rôles.

Le nouveau modèle créera donc une notification par utilisateur autorisé, sans
broadcast pour les alertes financières/salariales. La lecture sera limitée au
destinataire ou aux administrateurs. Les fonctions de génération seront
exécutables par `super_admin`, `admin` et `gestionnaire`; les alertes financières
seront attribuées seulement à `super_admin`, `admin`, `gestionnaire` et
`comptable`. Les alertes de salaire restent différées jusqu'à la définition d'une
échéance métier, donc aucune donnée salariale ne sera diffusée par ce lot.

Remarque : plusieurs tables sources ont aujourd'hui des politiques de lecture
`USING (true)`, notamment `salary_payments`, `wallets` et les opérations
financières. La RLS des nouvelles notifications sera stricte, mais la protection
globale de ces tables est un risque historique à traiter dans un lot Permissions
dédié ; ce lot ne doit pas modifier de manière incidente leurs accès existants.

## Déclenchement de production

`pg_cron` et `pg_net` ne sont pas installés sur la base liée. Le moteur sera une
fonction PostgreSQL idempotente, exposée par RPC et appelée explicitement dans le
centre de notifications et le tableau de bord par un rôle habilité. Une tâche
planifiée Supabase/Edge Function pourra appeler cette RPC plus tard lorsque
l'infrastructure de planification aura été validée. Aucun service e-mail, SMS ou
push n'est ajouté dans ce lot.

## Risques et données manquantes

1. Les dates d'assurance/visite moto, les échéances documents et les prochaines
   maintenances sont majoritairement nulles : le moteur est prêt mais ne pourra
   produire d'alerte qu'après saisie.
2. La table `vehicles` n'a pas de données réglementaires ; aucune alerte véhicule
   de ce type ne sera fabriquée artificiellement.
3. Les documents n'ont pas encore de fiche détail par identifiant ; leur lien
   mène à la bibliothèque Documents.
4. Il n'existe pas de calendrier salarial ni de seuil wallet configurable ; ces
   alertes ne sont pas déductibles de façon fiable.
5. Les alertes d'affectation devront tolérer les anciennes colonnes `driver_id`
   pendant la période de dépréciation du lot 6.
