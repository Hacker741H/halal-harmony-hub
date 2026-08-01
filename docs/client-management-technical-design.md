# CRM-01 — Design technique proposé : Référentiel Clients

**Statut :** conception technique uniquement. Ce document ne crée ni migration, ni table, ni RPC, ni route, ni permission.
**Références :** [spécification fonctionnelle Clients](client-management-functional-specification.md), [MT-01](transport-missions-functional-specification.md) et [MT-02](transport-missions-technical-design.md).
**Principe directeur :** le référentiel Client est la seule source de vérité commerciale. Les agrégats financiers sont calculés depuis les sources transactionnelles ; ils ne sont jamais stockés sur la fiche Client.

## 1. Décisions d’architecture

1. Le modèle cible introduit `transport_clients` comme référentiel unique. Un nom texte dans une table financière historique ne constitue pas un Client.
2. Les missions et factures pointent vers `transport_clients.id`. Les paiements atteignent le Client par leur facture et ne dupliquent pas son identité.
3. `finance_operations` reste le journal financier unique. Une création ou une modification de Client n’écrit aucune opération financière et ne modifie aucun wallet.
4. Les documents Client utilisent `documents` et une table de liaison explicite ; aucun nouveau polymorphisme `entity_type/entity_id` n’est introduit.
5. Les montants facturés, encaissés, dus et la rentabilité sont calculés côté PostgreSQL via vues ou RPC sécurisées. Ils ne sont pas maintenus par triggers de compteur ni saisie manuelle.
6. Les identifiants légaux (par exemple NINEA ou RCCM) sont configurables par pays : leur type et leur obligation ne sont pas codés en dur pour une seule juridiction.
7. Les suppressions historiques sont évitées : un Client relié est archivé. Les objets de facturation et de paiement sont corrigés par opérations liées et auditables.

## 2. Tables proposées

### 2.1 Client — `transport_clients`

| Colonne | Type proposé | Règle |
|---|---|---|
| `id` | `uuid` | PK générée. |
| `client_number` | `text` | Numéro Client unique, alloué côté RPC/séquence. |
| `kind` | `text` | `ORGANIZATION` ou `INDIVIDUAL`. |
| `display_name` | `text` | Nom commercial ou nom complet, non vide. |
| `legal_name` | `text` nullable | Raison sociale, si différente. |
| `country_code` | `text` nullable | Pays ISO de facturation. |
| `city`, `address` | `text` nullable | Coordonnées de facturation. |
| `telephone`, `email` | `text` nullable | Coordonnées principales. |
| `contact_name`, `contact_phone`, `contact_email` | `text` nullable | Contact de mission ou facturation. |
| `registration_identifier_type` | `text` nullable | Type d’identifiant selon pays : par exemple `NINEA`, `RCCM`, `TAX_ID`, `OTHER`. |
| `registration_identifier_value` | `text` nullable | Valeur de l’identifiant légal. |
| `notes` | `text` nullable | Notes internes non financières. |
| `status` | `text` | `ACTIVE` ou `ARCHIVED`. |
| `created_by`, `created_at`, `updated_at`, `archived_at`, `archived_by` | `uuid` / `timestamptz` | Audit de cycle de vie. |

Contraintes proposées :

```sql
UNIQUE (client_number);
CHECK (kind IN ('ORGANIZATION', 'INDIVIDUAL'));
CHECK (status IN ('ACTIVE', 'ARCHIVED'));
CHECK (btrim(display_name) <> '');
CHECK (
  registration_identifier_type IS NOT NULL
  OR registration_identifier_value IS NULL
);
```

La validation des pays et du couple type/valeur d’identifiant doit être portée par une RPC ou une configuration métier future. Une contrainte d’unicité sur un identifiant légal ne doit être ajoutée qu’après décision sur les valeurs absentes, les groupes de sociétés et les formats nationaux.

### 2.2 Configuration d’identifiants légaux — proposition minimale

Si le besoin multi-pays est confirmé, une table dédiée et non générique est préférable à des conditions dispersées :

```text
transport_client_identifier_rules
  id
  country_code
  identifier_type
  label
  is_required_for_organization
  is_required_for_individual
  validation_pattern nullable
  is_active
```

Cette table ne stocke aucune donnée Client. Elle rend les règles NINEA/RCCM configurables sans imposer ces identifiants à un autre pays. Son introduction reste conditionnelle à la validation métier et n’est pas exécutée par CRM-01.

### 2.3 Numérotation — réutilisation de `transport_number_sequences`

Le modèle Missions propose déjà une table de séquences. Elle doit gérer `sequence_kind = 'CLIENT'` avec une contrainte unique `(sequence_kind, calendar_year)` et une attribution sous verrou de ligne.

Format initial à valider :

```text
CLI-{AAAA}-{000001}
```

Le numéro est attribué au moment de la création de la fiche, ne dépend pas du navigateur et n’est jamais réutilisé, même après archivage.

### 2.4 Documents Client — `document_transport_client_links`

| Colonne | Type proposé | Règle |
|---|---|---|
| `document_id` | `uuid` | FK vers `documents.id`, non nul. |
| `client_id` | `uuid` | FK vers `transport_clients.id`, non nul. |
| `created_at`, `created_by` | `timestamptz` / `uuid` | Audit de liaison. |

Contraintes : `UNIQUE (document_id, client_id)` ; FKs `ON DELETE RESTRICT`. La table réutilise le cycle de vie Storage/RLS du module Documents. Un document peut avoir plusieurs liens uniquement lorsque le métier l’autorise explicitement ; sa suppression documentaire contrôlée doit protéger les références existantes.

## 3. Relations et intégrité référentielle

```text
transport_missions.client_id        → transport_clients.id
transport_invoices.client_id        → transport_clients.id
document_transport_client_links.client_id → transport_clients.id
document_transport_client_links.document_id → documents.id
```

Règles proposées :

- toutes les FKs métier sont `ON DELETE RESTRICT` ;
- l’émission d’une facture vérifie que `invoice.client_id = mission.client_id` dans la même transaction ;
- une mission ne peut être planifiée avec un Client `ARCHIVED` ; les missions historiques le restent ;
- une facture émise garde un `client_snapshot` minimal pour la valeur légale du document, sans créer une seconde fiche Client ;
- le champ historique `finance_operations.client` n’est jamais utilisé comme FK implicite ni resynchronisé automatiquement ;
- la suppression directe est refusée dès qu’il existe une relation ; l’archivage remplace la suppression normale.

## 4. Calculs et moteur financier

Les indicateurs Client sont proposés comme une vue sécurisée ou une RPC de lecture filtrée, par exemple `get_transport_client_metrics(p_client_id uuid, p_from date, p_to date)`. Cette fonction n’est pas créée par ce lot.

| Mesure | Calcul source |
|---|---|
| Facturé | `SUM(transport_invoices.total_amount)` pour les factures non annulées. |
| Encaissé net | Paiements `CONFIRMED` moins remboursements client confirmés, réconciliables avec les liens finance de paiement. |
| À recevoir | Facturé − avoirs confirmés − encaissé net. |
| Dépenses mission | `SUM(transport_mission_expenses.amount)` pour les dépenses `PAID` des missions Client. |
| Résultat brut Client | Montant de transport hors taxes des missions `COMPLETED`/`CLOSED` − dépenses de mission payées. |
| Résultat de trésorerie Client | Encaissements nets − dépenses de mission payées. |
| Budget/réel | Somme des budgets mission et dépenses `PAID`; absence de budget = valeur non calculée, pas zéro. |

Les taxes ne sont pas intégrées au résultat brut. Les transferts internes de wallet sont neutres. Les annulations et corrections suivent les liens explicites de Missions ; une vue ne doit pas déduire le sens d’un mouvement à partir d’une description libre.

## 5. Index proposés

```text
transport_clients(status, display_name)
transport_clients(lower(display_name))
transport_clients(country_code, status)
transport_clients(registration_identifier_type, registration_identifier_value)
transport_missions(client_id, status, planned_departure_at desc)
transport_invoices(client_id, status, due_date)
transport_invoice_payments(invoice_id, status, confirmed_at desc)
document_transport_client_links(client_id, document_id)
```

L’index de recherche insensible à la casse doit être choisi après validation de l’extension disponible et du besoin de recherche plein texte. Les plans réels doivent être mesurés avant tout index supplémentaire.

## 6. RPC transactionnelles proposées

Les mutations ne doivent pas être réalisées par des requêtes directes du navigateur. Chaque future RPC définit un `search_path` sûr, utilise `auth.uid()`, valide les paramètres, vérifie les permissions côté base et écrit l’audit existant.

| RPC proposée | Responsabilité | Permission proposée |
|---|---|---|
| `create_transport_client` | Valide les données, alloue le numéro et crée le Client. | `clients.create` |
| `update_transport_client` | Met à jour les données maître d’un Client actif. | `clients.update` |
| `archive_transport_client` | Vérifie les contraintes puis archive le Client. | `clients.archive` |
| `restore_transport_client` | Restaure un Client si les règles métier le permettent. | `clients.archive` |
| `link_transport_client_document` | Crée une liaison explicite après contrôle documentaire. | `clients.documents.manage` |
| `unlink_transport_client_document` | Retire uniquement la liaison autorisée, sans effacer le fichier. | `clients.documents.manage` |
| `get_transport_client_metrics` | Retourne les agrégats calculés autorisés. | `clients.finance.read` / `clients.reports.read` |

Les actions de finance (confirmation d’une dépense, paiement, avoir, remboursement) restent dans les RPC Mission/Finance. Les RPC Client ne doivent jamais prendre un wallet ou un montant comme paramètre d’écriture.

## 7. RLS et permissions proposées

### Permissions

```text
clients.read
clients.create
clients.update
clients.archive
clients.documents.manage
clients.finance.read
clients.reports.read
```

### Principes de politique

- RLS active sur `transport_clients` et `document_transport_client_links` ;
- lecture de la fiche Client seulement avec `clients.read` ;
- création/mise à jour/archivage uniquement par RPC vérifiant la permission associée ;
- lecture d’indicateurs financiers via vue/RPC sécurisée seulement avec `clients.finance.read` ou `clients.reports.read` autorisée ;
- le rôle Opérations peut consulter et sélectionner des Clients autorisés, mais ne confirme ni paiements ni dépenses ;
- Finance accède aux créances, factures et paiements nécessaires, sans obtenir automatiquement les documents RH existants ;
- Lecture seule n’obtient aucune mutation ni export financier sensible ;
- aucun droit `anon`, aucune politique `USING (true)`, aucun `EXECUTE` anonyme ;
- les documents restent privés et sont téléchargés par URL signée temporaire après vérification de la permission sur le Client et le document.

## 8. Audit et corrections

`business_finance_audit` est le mécanisme existant à réutiliser. Les événements minimums sont : création, modification, archivage, restauration, changement d’identifiant légal, liaison/rupture de document et accès administratif sensible.

Une facture émise, un paiement confirmé ou une dépense validée ne sont jamais supprimés à cause d’une correction Client. Si l’identité de facturation doit être rectifiée après émission, l’instantané de la facture originale est conservé et la correction est traitée par le mécanisme légal/commercial validé, avec audit.

## 9. Plan de migration futur

1. inventorier les champs libres de client dans les tables historiques sans créer de fiches automatiquement ;
2. prendre un snapshot des tables, documents et permissions concernés ;
3. créer le référentiel Client, la séquence, les relations documentaires, index et RLS de manière additive ;
4. ajouter les permissions et RPC sécurisées ;
5. créer les vues/RPC de lecture des métriques ;
6. tester multi-rôles, archivage, recherche et absence de double comptabilisation ;
7. seulement ensuite intégrer les sélecteurs Client dans les nouvelles Missions ;
8. traiter une éventuelle reprise historique comme un projet distinct avec revue manuelle, journal de mapping et rollback.

## 10. Tests prévus

### SQL

1. création de Client individuel et organisation ;
2. génération unique et concurrente du numéro Client ;
3. refus d’un type ou statut invalide ;
4. archivage refusé ou contrôlé lorsque les règles le demandent ;
5. mission planifiée refusée avec Client archivé ;
6. facture refusée si son `client_id` diffère de celui de la Mission ;
7. liaison de document explicite, doublon refusé et accès `anon` refusé ;
8. recalcul des totaux avec facture annulée, paiement partiel, remboursement et avoir ;
9. budget sans écriture finance ni changement de wallet ;
10. RLS réelle : Lecture seule sans mutation, Opérations sans confirmation financière, Finance autorisé selon permission ;
11. audit des mutations et refus d’accès sensible ;
12. transaction annulée si une validation ou l’audit échoue.

### Applicatifs

1. recherche Client avec données longues et états vide/erreur ;
2. sélection Client depuis une Mission sans recopier coordonnées ;
3. navigation Client ↔ Mission ↔ Facture ↔ Paiement ;
4. lecture d’indicateurs cohérente avec Finance pour les mêmes filtres ;
5. téléchargement d’un document Client avec URL signée uniquement ;
6. test réel avec rôles Opérations, Finance, Administrateur et Lecture seule.

## 11. Points bloquants avant implémentation

1. pays et règles légales effectives pour NINEA, RCCM, fiscalité, conservation et numérotation ;
2. champs strictement obligatoires pour un Client actif ;
3. stratégie validée de détection/fusion de doublons ;
4. besoin réel de plusieurs contacts par Client ;
5. règles exactes de TVA, devise, remises, avoirs et remboursement ;
6. permissions de lecture des coordonnées et des montants par rôle ;
7. règles de révision du budget après départ ;
8. politique d’archivage des Clients avec solde, facture impayée ou document légal.

Ces décisions doivent être validées avant de produire une migration. Aucun point ne doit être résolu par une valeur par défaut silencieuse.
