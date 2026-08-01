# MT-02 — Design technique proposé : Missions de transport

**Statut :** conception technique uniquement. Ce document ne crée ni migration, ni table, ni RPC, ni route, ni permission.
**Référence métier :** [MT-01 — Spécification fonctionnelle](transport-missions-functional-specification.md), incluant les décisions métier validées.
**Objectif :** préparer un modèle relationnel transactionnel et sécurisé qui ajoute les missions de transport sans créer de second journal financier ni dupliquer les référentiels ERP.

## 1. Décisions d’architecture

1. `finance_operations` reste l’unique journal de trésorerie. Une facture ou une dépense prévue n’y crée aucune ligne.
2. Une **dépense payée** produit exactement une opération `EXPENSE` ; un **paiement client confirmé** produit exactement une opération `REVENUE`.
3. Les liens financier ↔ mission sont explicites et à clés étrangères ; `finance_links.module + module_record_id` peut rester une compatibilité historique, mais n’est pas la source de vérité du nouveau domaine.
4. Le futur référentiel `transport_clients` devient la source de vérité des clients. Le champ libre `finance_operations.client` reste historique et ne doit pas être utilisé pour créer les missions, factures ou paiements de transport.
5. Les corrections ne détruisent pas les données financières : avoir, remboursement client et remboursement fournisseur sont des objets liés et auditables.
6. Tous les changements avec effet métier ou financier passent par des RPC transactionnelles protégées. Le navigateur ne modifie pas directement un solde de wallet, un statut confirmé ou un lien financier.
7. Les statuts futurs sont proposés comme colonnes `text` avec `CHECK`, plutôt que nouveaux enums PostgreSQL. Cette approche reste additive et cohérente avec les tables métier existantes qui utilisent déjà des statuts textuels.

## 2. État de l’ERP à réutiliser

| Élément existant | Usage dans MT-02 | Limite à respecter |
|---|---|---|
| `vehicles` | FK `vehicle_id`, statut et kilométrage de référence. | Ne pas recopier l’immatriculation, marque ou modèle dans la mission. |
| `drivers` et `employees` | FK `driver_id`; données personnelles via la relation existante. | Ne pas dupliquer nom, permis, téléphone ou salaire. |
| `driver_vehicle_assignments` | Vérification contextuelle de l’affectation. | Ne remplace pas la réservation de mission. |
| `wallets` | FK de paiement/d’encaissement et recalcul officiel. | `wallets.balance` n’est jamais mis à jour directement. |
| `finance_operations` | Une ligne de dépense ou de recette réellement réalisée. | Ne pas créer une opération à l’émission d’une facture. |
| `FinanceService` et RPC finance existantes | Point d’intégration du journal et du recalcul. | Ne pas recopier cette logique dans les formulaires Mission. |
| `business_finance_audit` | Historique des actions mission et finance. | Ne pas créer un journal d’audit concurrent. |
| `documents` et Storage privé | Pièces client, mission et facture, avec URLs signées. | Nouvelles relations explicites, sans polymorphisme générique. |
| `contracts` | Association commerciale optionnelle si validée. | Ne pas imposer une relation contrat à toute mission. |

Les tables historiques `revenues`, `expenses` et `payments` ne participent pas aux nouvelles écritures de transport.

---

## 3. Modèle SQL proposé

Les tables et contraintes suivantes sont un **contrat cible de migration future**. Les noms peuvent être ajustés lors de la revue SQL, mais les relations, garanties d’unicité et responsabilités doivent être conservées.

### 3.1 Référentiel Client — `transport_clients`

| Colonne | Type proposé | Règle |
|---|---|---|
| `id` | `uuid` | PK, générée. |
| `client_number` | `text` | Numéro Client métier unique, attribué par séquence ; obligatoire après création. |
| `kind` | `text` | `ORGANIZATION` ou `INDIVIDUAL`. |
| `display_name` | `text` | Nom affiché, obligatoire. |
| `legal_name` | `text` nullable | Raison sociale, si différente. |
| `country_code`, `city`, `address` | `text` nullable | Pays ISO, ville et adresse de facturation centralisés. |
| `telephone`, `email` | `text` nullable | Coordonnées principales. |
| `contact_name`, `contact_phone`, `contact_email` | `text` nullable | Contact opérationnel ou facturation, sans créer une seconde fiche Client. |
| `registration_identifier_type`, `registration_identifier_value` | `text` nullable | Type et valeur d’identifiant légal configurables par pays : par exemple `NINEA`, `RCCM` ou une valeur locale. |
| `notes` | `text` nullable | Notes internes non financières, soumises aux droits Client. |
| `status` | `text` | `ACTIVE` / `ARCHIVED`. |
| `created_at`, `updated_at`, `created_by`, `archived_at`, `archived_by` | timestamps / `uuid` | Audit de cycle de vie. |

Contraintes : `UNIQUE (client_number)` ; `CHECK (kind IN ('ORGANIZATION', 'INDIVIDUAL'))`; `CHECK (status IN ('ACTIVE', 'ARCHIVED'))`; format de `country_code` validé côté base ou RPC. Les identifiants légaux restent optionnels et leur type est validé contre une configuration pays, plutôt que codé en dur pour le Sénégal.

### 3.2 Indicateurs Client dérivés — vue/RPC sécurisée future

Les compteurs, montants et dernières dates Client ne sont pas des colonnes de `transport_clients`. Ils sont calculés depuis les relations sources, pour éviter tout solde ou total désynchronisé :

| Indicateur | Source et règle proposée |
|---|---|
| Total facturé | Somme des `transport_invoices.total_amount` non annulées du client. |
| Total encaissé | Somme des paiements confirmés, diminuée des remboursements clients confirmés liés. |
| Solde à recevoir | Factures non annulées − avoirs confirmés − paiements confirmés nets. |
| Nombre de missions | Nombre de missions non annulées du client ; les brouillons restent distinguables dans l’interface. |
| Rentabilité totale | Somme des résultats bruts des missions terminées ou clôturées : montant de transport hors taxes − dépenses payées. |
| Dernière mission | Dernière mission selon `COALESCE(actual_departure_at, planned_departure_at, created_at)`. |
| Dernier paiement | Dernier `confirmed_at` d’un paiement client confirmé. |

Une future RPC `get_transport_client_metrics` ou vue sécurisée équivalente calculera ces valeurs côté PostgreSQL avec les mêmes règles RLS que les rapports. Elle ne persiste aucun agrégat et n’est pas créée dans ce lot documentaire.

### 3.3 Taxes configurables — `transport_tax_profiles`

| Colonne | Type proposé | Règle |
|---|---|---|
| `id` | `uuid` | PK. |
| `code` | `text` | Unique, stable. |
| `label` | `text` | Obligatoire. |
| `rate_percent` | `numeric(7,4)` | Entre `0` et `100`. |
| `is_active` | `boolean` | Une taxe inactive ne peut pas être choisie pour une nouvelle facture. |
| `created_at`, `updated_at` | `timestamptz` | Traçabilité. |

Une facture ou mission peut avoir `tax_profile_id = NULL`. Les montants calculés sont enregistrés dans la facture pour garantir sa lecture historique si un taux est ensuite modifié.

### 3.4 Numérotation — `transport_number_sequences`

| Colonne | Type proposé | Règle |
|---|---|---|
| `id` | `uuid` | PK. |
| `sequence_kind` | `text` | `CLIENT`, `MISSION` ou `INVOICE`. |
| `calendar_year` | `integer` | Année du numéro. |
| `next_value` | `bigint` | Prochain numéro à attribuer, strictement positif. |
| `updated_at` | `timestamptz` | Contrôle opérationnel. |

Contrainte : `UNIQUE (sequence_kind, calendar_year)`. La numérotation est allouée par RPC sous verrou de ligne (`SELECT … FOR UPDATE`), jamais dans l’interface.

Format initial proposé, à valider légalement :

```text
Mission : MSN-{AAAA}-{000001}
Facture : FAC-{AAAA}-{000001}
Client : CLI-{AAAA}-{000001}
```

Un numéro Client et un numéro de mission sont attribués à la création du brouillon. Un numéro de facture est attribué seulement au passage **Brouillon → Émise**. Aucun numéro n’est réutilisé ; une facture annulée conserve son numéro.

### 3.5 Dérogations administrateur — `transport_mission_exceptions`

| Colonne | Type proposé | Règle |
|---|---|---|
| `id` | `uuid` | PK. |
| `mission_id` | `uuid` | FK obligatoire vers `transport_missions` ; une seule facture active par mission. |
| `exception_type` | `text` | `VEHICLE_OVERLAP`, `DRIVER_OVERLAP`, `CLOSE_WITH_OPEN_BALANCE`. |
| `justification` | `text` | Obligatoire, non vide. |
| `requested_by`, `approved_by` | `uuid` | FK `auth.users`; approbation réservée à l’administrateur. |
| `approved_at`, `used_at`, `revoked_at` | `timestamptz` nullable | Cycle de vie de la dérogation. |
| `status` | `text` | `APPROVED`, `USED`, `REVOKED`. |
| `created_at` | `timestamptz` | Traçabilité. |

Contraintes : statut et type contrôlés par `CHECK`; une justification non vide ; index `(mission_id, exception_type, status)`. La création, approbation, utilisation et révocation créent également une entrée dans `business_finance_audit`.

### 3.6 Mission — `transport_missions`

| Colonne | Type proposé | Règle |
|---|---|---|
| `id` | `uuid` | PK. |
| `mission_number` | `text` | Unique, non nul après création. |
| `status` | `text` | Voir section 4. |
| `client_id` | `uuid` | FK obligatoire vers `transport_clients`. |
| `vehicle_id` | `uuid` nullable en brouillon | FK vers `vehicles`; obligatoire en planification/exécution. |
| `driver_id` | `uuid` nullable en brouillon | FK vers `drivers`; obligatoire en planification/exécution. |
| `planned_departure_at`, `planned_arrival_at` | `timestamptz` | Fenêtre de planification obligatoire hors brouillon. |
| `actual_departure_at`, `actual_arrival_at` | `timestamptz` nullable | Dates réelles. |
| `departure_location`, `destination_location` | `text` | Obligatoires hors brouillon. |
| `cargo_description` | `text` | Marchandise ou prestation obligatoire hors brouillon. |
| `cargo_quantity`, `cargo_unit` | `numeric` / `text` nullable | À activer selon besoin métier confirmé. |
| `quoted_amount` | `numeric(14,2)` | Montant commercial de service prévu, hors taxes lorsque la fiscalité est appliquée, `>= 0`. |
| `currency_code` | `text` | Devise à aligner sur le paramètre entreprise ; règle de devise multiple à confirmer. |
| `start_odometer`, `end_odometer` | `numeric(14,2)` nullable | Kilométrages réels, en unités cohérentes avec `vehicles.kilometrage`. |
| `overlap_exception_id` | `uuid` nullable | FK vers `transport_mission_exceptions`, seulement pour une dérogation approuvée. |
| `close_exception_id` | `uuid` nullable | FK vers `transport_mission_exceptions`, seulement pour clôture exceptionnelle. |
| `reference`, `notes`, `cancellation_reason` | `text` nullable | Références et motifs. |
| `created_by`, `created_at`, `updated_at`, `closed_at`, `cancelled_at` | audit | Auteur et cycle de vie. |

Contraintes à appliquer :

```sql
CHECK (status IN ('DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED'));
CHECK (quoted_amount >= 0);
CHECK (planned_arrival_at IS NULL OR planned_departure_at IS NULL OR planned_arrival_at > planned_departure_at);
CHECK (actual_arrival_at IS NULL OR actual_departure_at IS NULL OR actual_arrival_at >= actual_departure_at);
CHECK (end_odometer IS NULL OR start_odometer IS NULL OR end_odometer >= start_odometer);
UNIQUE (mission_number);
```

Une contrainte ou une RPC de transition impose que `client_id`, `vehicle_id`, `driver_id`, la fenêtre planifiée, le trajet et la marchandise soient renseignés avant le statut `PLANNED`.

### 3.7 Budget prévisionnel — `transport_mission_budget_lines`

Le budget est séparé des dépenses afin qu’une estimation ne devienne jamais un décaissement ou une opération financière.

| Colonne | Type proposé | Règle |
|---|---|---|
| `id` | `uuid` | PK. |
| `mission_id` | `uuid` | FK obligatoire vers `transport_missions`. |
| `category` | `text` | Même code métier que les dépenses réelles. |
| `planned_amount` | `numeric(14,2)` | Montant estimé strictement positif. |
| `notes` | `text` nullable | Hypothèse ou justification. |
| `created_by`, `created_at`, `updated_at` | audit | Trace des révisions. |

Contraintes : `UNIQUE (mission_id, category)` afin d’avoir une base de comparaison déterministe par catégorie ; `CHECK (planned_amount > 0)` ; FK `ON DELETE RESTRICT`. Le total n’est pas stocké : `SUM(planned_amount)` est calculé. Les lignes sont librement modifiables en brouillon/planification ; après `IN_PROGRESS`, une révision doit être portée par une RPC avec justification et événement dans `business_finance_audit`, afin de préserver le budget de référence.

### 3.8 Dépenses — `transport_mission_expenses`

| Colonne | Type proposé | Règle |
|---|---|---|
| `id` | `uuid` | PK. |
| `mission_id` | `uuid` | FK obligatoire vers `transport_missions`. |
| `wallet_id` | `uuid` | FK obligatoire vers `wallets`; wallet prévu puis payé. |
| `status` | `text` | `PLANNED`, `COMMITTED`, `PAID`, `CANCELLED`. |
| `category` | `text` | Initialement : `FUEL`, `TOLL`, `MEAL`, `LODGING`, `REPAIR`, `EXCEPTIONAL_MAINTENANCE`, `ROAD_FEE`, `OTHER`; référentiel configurable futur possible. |
| `amount` | `numeric(14,2)` | Strictement positif. |
| `expense_date`, `paid_at` | date / timestamp nullable | Date métier et date effective. |
| `supplier`, `reference`, `description` | `text` nullable | Contexte et justificatif. |
| `created_by`, `confirmed_by`, `confirmed_at`, `cancelled_by`, `cancelled_at` | audit | Rôles et dates. |

Contraintes : FK non supprimables par cascade sur mission ou wallet ; `CHECK (amount > 0)` ; `CHECK` des catégories/statuts. Une dépense est considérée validée à la clôture lorsqu’elle est `PAID` ou `CANCELLED`.

### 3.9 Factures — `transport_invoices`

| Colonne | Type proposé | Règle |
|---|---|---|
| `id` | `uuid` | PK. |
| `invoice_number` | `text` nullable en brouillon | Unique et obligatoire à l’émission. |
| `mission_id` | `uuid` | FK obligatoire vers `transport_missions` ; une seule facture active par mission. |
| `client_id` | `uuid` | FK obligatoire vers `transport_clients`; contrôlé contre le client de mission à l’émission. |
| `status` | `text` | `DRAFT`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `CANCELLED`. |
| `subtotal_amount` | `numeric(14,2)` | Montant hors taxe `>= 0`. |
| `tax_profile_id` | `uuid` nullable | FK vers `transport_tax_profiles`; facultative. |
| `tax_amount`, `total_amount` | `numeric(14,2)` | Montants calculés et figés à l’émission ; `total_amount >= 0`. |
| `due_date`, `issued_at`, `cancelled_at` | dates/timestamps nullable | Cycle de vie. |
| `client_snapshot` | `jsonb` nullable | Instantané légal minimal, seulement à l’émission. |
| `reference`, `pdf_document_id` | texte / `uuid` nullable | Référence client et FK future vers `documents`. |
| `created_by`, `issued_by`, `cancelled_by` | `uuid` nullable | Audit. |

Contraintes : `UNIQUE (invoice_number) WHERE invoice_number IS NOT NULL`; `UNIQUE (mission_id) WHERE status <> 'CANCELLED'`; les montants ne peuvent être négatifs ; `total_amount = subtotal_amount + tax_amount` contrôlé via trigger/RPC pour éviter les arrondis incohérents. La contrainte partielle garantit une facture active par mission tout en conservant une facture annulée pour l’audit.

### 3.10 Paiements — `transport_invoice_payments`

| Colonne | Type proposé | Règle |
|---|---|---|
| `id` | `uuid` | PK. |
| `invoice_id` | `uuid` | FK obligatoire vers `transport_invoices`. |
| `wallet_id` | `uuid` | FK obligatoire vers `wallets`, wallet de réception. |
| `status` | `text` | `PLANNED`, `RECEIVED`, `CONFIRMED`, `CANCELLED`. |
| `amount` | `numeric(14,2)` | Strictement positif. |
| `due_date`, `received_at`, `confirmed_at`, `cancelled_at` | dates/timestamps nullable | Cycle de vie. |
| `payment_method`, `payment_reference`, `notes` | `text` nullable | Preuve et contexte. |
| `created_by`, `confirmed_by`, `cancelled_by` | `uuid` nullable | Audit. |

Un acompte est une ligne de paiement avec un montant inférieur au total de facture. Plusieurs lignes confirmées sont autorisées. Une RPC bloque tout total net confirmé supérieur au solde exigible.

### 3.11 Avoirs, remboursements et corrections — `transport_mission_adjustments`

Cette table évite à la fois la suppression historique et une relation polymorphe générique. Chaque cible possède sa propre FK explicite.

| Colonne | Type proposé | Règle |
|---|---|---|
| `id` | `uuid` | PK. |
| `mission_id` | `uuid` | FK obligatoire vers `transport_missions`. |
| `invoice_id` | `uuid` nullable | FK pour un avoir de facture. |
| `payment_id` | `uuid` nullable | FK pour un remboursement client. |
| `expense_id` | `uuid` nullable | FK pour un remboursement fournisseur / correction de dépense. |
| `adjustment_type` | `text` | `CREDIT_NOTE`, `PAYMENT_REFUND`, `EXPENSE_REFUND`. |
| `status` | `text` | `DRAFT`, `CONFIRMED`, `CANCELLED`. |
| `amount` | `numeric(14,2)` | Strictement positif. |
| `wallet_id` | `uuid` nullable | Obligatoire lorsque l’ajustement déplace de la trésorerie. |
| `reason`, `reference` | `text` | Motif obligatoire à la confirmation. |
| `created_by`, `confirmed_by`, `confirmed_at` | audit | Trace obligatoire. |

Contraintes :

```sql
CHECK (num_nonnulls(invoice_id, payment_id, expense_id) = 1);
CHECK (
  (adjustment_type = 'CREDIT_NOTE' AND invoice_id IS NOT NULL)
  OR (adjustment_type = 'PAYMENT_REFUND' AND payment_id IS NOT NULL)
  OR (adjustment_type = 'EXPENSE_REFUND' AND expense_id IS NOT NULL)
);
CHECK (amount > 0);
```

Un avoir réduit le solde de facture sans créer de mouvement de wallet par lui-même. Un remboursement client crée une dépense financière liée ; un remboursement fournisseur crée une recette financière liée. Les conventions de signe et les cas fiscaux restent à confirmer avant implémentation.

---

## 4. Statuts et calculs dérivés

### Statuts contrôlés

```text
Mission  : DRAFT | PLANNED | IN_PROGRESS | COMPLETED | CLOSED | CANCELLED
Facture  : DRAFT | ISSUED | PARTIALLY_PAID | PAID | CANCELLED
Paiement : PLANNED | RECEIVED | CONFIRMED | CANCELLED
Dépense  : PLANNED | COMMITTED | PAID | CANCELLED
Ajustement : DRAFT | CONFIRMED | CANCELLED
```

Les statuts **Facture** ne sont pas librement modifiables après émission : la RPC recalcule le statut depuis les paiements confirmés nets et les avoirs confirmés.

```text
solde facture = total_amount
              - avoirs confirmés
              - paiements confirmés nets

paiements confirmés nets = paiements confirmés - remboursements clients confirmés
```

Les arrondis monétaires seront réalisés côté PostgreSQL avec la précision de `numeric(14,2)`, jamais avec des flottants JavaScript.

Les agrégats de pilotage sont également calculés et jamais écrits dans `transport_missions` :

```text
budget prévisionnel       = SUM(transport_mission_budget_lines.planned_amount)
dépenses réelles          = SUM(transport_mission_expenses.amount WHERE status = 'PAID')
écart budget/réel         = dépenses réelles - budget prévisionnel
résultat brut de mission  = quoted_amount hors taxes - dépenses réelles
résultat de trésorerie    = paiements confirmés nets - dépenses réelles
```

L’écart budget/réel est `NULL` si la mission ne comporte aucune ligne de budget ; il ne doit pas être présenté comme un écart nul. Les taxes de facture ne sont pas intégrées au résultat brut : elles sont séparées du montant de service pour éviter de présenter une taxe collectée comme de la rentabilité.

---

## 5. Clés étrangères et relations financières explicites

### Relations métier principales

```text
transport_missions.client_id  → transport_clients.id
transport_missions.vehicle_id → vehicles.id
transport_missions.driver_id  → drivers.id

transport_mission_expenses.mission_id → transport_missions.id
transport_mission_expenses.wallet_id  → wallets.id

transport_invoices.mission_id → transport_missions.id
transport_invoices.client_id  → transport_clients.id
transport_invoices.tax_profile_id → transport_tax_profiles.id

transport_invoice_payments.invoice_id → transport_invoices.id
transport_invoice_payments.wallet_id  → wallets.id

transport_mission_budget_lines.mission_id → transport_missions.id
```

Les FK de référentiels essentiels utilisent `ON DELETE RESTRICT`. Une mission, facture, dépense ou paiement ayant servi à la traçabilité ne doit pas disparaître parce qu’un référentiel est supprimé.

### Liens finance proposés

```sql
finance_transport_mission_expense_links (
  mission_expense_id uuid not null unique references transport_mission_expenses(id) on delete restrict,
  operation_id uuid not null unique references finance_operations(id) on delete restrict,
  created_at timestamptz not null default now()
)

finance_transport_payment_links (
  payment_id uuid not null unique references transport_invoice_payments(id) on delete restrict,
  operation_id uuid not null unique references finance_operations(id) on delete restrict,
  created_at timestamptz not null default now()
)

finance_transport_adjustment_links (
  adjustment_id uuid not null unique references transport_mission_adjustments(id) on delete restrict,
  operation_id uuid not null unique references finance_operations(id) on delete restrict,
  created_at timestamptz not null default now()
)
```

La dernière table ne comporte aucune ligne pour un avoir sans effet de wallet. Les trois relations sont la preuve d’idempotence du domaine : une dépense payée, un encaissement confirmé ou un ajustement monétaire n’a qu’une opération financière source.

### Documents explicites futurs

```text
document_transport_client_links(document_id, client_id)    UNIQUE(document_id, client_id)
document_transport_mission_links(document_id, mission_id)  UNIQUE(document_id, mission_id)
document_transport_invoice_links(document_id, invoice_id)  UNIQUE(document_id, invoice_id)
```

Elles réutilisent `documents`, les RPC documentaires, le Storage privé et les URLs signées temporaires. Elles ne modifient pas le modèle documentaire pendant MT-02.

---

## 6. Contraintes d’unicité, index et performance

### Unicité

| Objet | Contrainte |
|---|---|
| Client | `client_number` unique, attribué par séquence. |
| Mission | `mission_number` unique. |
| Facture | `invoice_number` unique lorsqu’émise et une seule facture non annulée par mission. |
| Budget | Une ligne de budget par paire `(mission_id, category)`. |
| Séquence | `(sequence_kind, calendar_year)` unique. |
| Liens finance | Une source métier et une opération finance ne peuvent apparaître qu’une fois dans chaque table de liaison. |
| Dérogation active | Au plus une dérogation active d’un même type pour une mission via index partiel. |
| Documents | Une paire document/source est unique dans chaque liaison explicite. |

### Index proposés

```text
transport_missions(status, planned_departure_at desc)
transport_missions(client_id, status, planned_departure_at desc)
transport_missions(vehicle_id, status, planned_departure_at desc)
transport_missions(driver_id, status, planned_departure_at desc)
transport_invoices(mission_id, status)
transport_invoices(client_id, due_date) where status in ('ISSUED', 'PARTIALLY_PAID')
transport_invoice_payments(invoice_id, status, confirmed_at desc)
transport_mission_expenses(mission_id, status, expense_date desc)
transport_mission_expenses(wallet_id, status, paid_at desc)
transport_mission_budget_lines(mission_id, category)
transport_mission_adjustments(mission_id, status, confirmed_at desc)
finance_transport_mission_expense_links(operation_id, mission_expense_id)
finance_transport_payment_links(operation_id, payment_id)
finance_transport_adjustment_links(operation_id, adjustment_id)
```

Les index ne sont qu’une proposition de départ ; leur plan d’exécution doit être contrôlé sur des données représentatives avant l’ajout effectif.

---

## 7. Règles de chevauchement véhicule / chauffeur

### Règle standard

Une mission `PLANNED` ou `IN_PROGRESS` ne peut pas chevaucher, sur sa fenêtre opérationnelle, une autre mission active utilisant le même véhicule ou le même chauffeur.

Pour une mise en œuvre robuste, la future migration peut activer `btree_gist` et ajouter deux contraintes d’exclusion conditionnelles :

```sql
EXCLUDE USING gist (
  vehicle_id WITH =,
  tstzrange(planned_departure_at, planned_arrival_at, '[)') WITH &&
)
WHERE (status IN ('PLANNED', 'IN_PROGRESS') AND overlap_exception_id IS NULL);

EXCLUDE USING gist (
  driver_id WITH =,
  tstzrange(planned_departure_at, planned_arrival_at, '[)') WITH &&
)
WHERE (status IN ('PLANNED', 'IN_PROGRESS') AND overlap_exception_id IS NULL);
```

La valeur `overlap_exception_id` ne peut être écrite que par une RPC d’administrateur qui vérifie une dérogation approuvée avec justification. Les contraintes fournissent le blocage base de données ; la RPC complète la vérification métier de l’exception et l’audit.

Au départ réel, la RPC revalide la fenêtre contre les missions actives. Les modifications d’horaires ne doivent jamais contourner l’exclusion par une écriture directe.

---

## 8. Règles de clôture

La RPC de clôture doit verrouiller la mission et vérifier dans la même transaction :

1. mission au statut `COMPLETED` ;
2. aucune dépense `PLANNED` ou `COMMITTED` ;
3. toutes les dépenses sont `PAID` ou `CANCELLED` ;
4. le solde client calculé est nul ;
5. aucune confirmation ou correction financière incomplète ;
6. si le solde client n’est pas nul, une dérogation `CLOSE_WITH_OPEN_BALANCE` approuvée, non révoquée, justifiée et non utilisée est présente ;
7. écriture d’un événement dans `business_finance_audit` avant la validation finale.

La mission peut être `COMPLETED` avec une facture impayée. Cette situation bloque la clôture standard, mais pas l’état terminé. Une clôture dérogatoire ne modifie ni le solde de facture, ni le wallet : elle explicite seulement la décision de gestion.

---

## 9. RPC transactionnelles proposées

Toutes les fonctions suivantes devront : utiliser `auth.uid()`, vérifier une permission côté base, définir un `search_path` sûr, qualifier les tables, valider les paramètres, verrouiller les lignes nécessaires et écrire l’audit. Elles ne sont pas créées par MT-02.

| RPC proposée | Responsabilité | Permission minimale |
|---|---|---|
| `create_transport_mission` | Crée un brouillon et attribue le numéro Mission. | `missions.create` |
| `update_transport_mission` | Modifie un brouillon/planifié autorisé, sans contourner les statuts. | `missions.update` |
| `plan_transport_mission` | Valide les données, contrôle les chevauchements, passe à `PLANNED`. | `missions.dispatch` |
| `start_transport_mission` | Revalide disponibilité et enregistre le départ/odomètre initial. | `missions.dispatch` |
| `complete_transport_mission` | Enregistre retour/odomètre final et passe à `COMPLETED`. | `missions.dispatch` |
| `close_transport_mission` | Applique les règles de clôture et utilise une dérogation si nécessaire. | `missions.close` |
| `create_transport_mission_exception` | Demande/crée une dérogation avec justification. | permission administrateur dédiée |
| `approve_transport_mission_exception` | Approuve ou révoque une dérogation. | permission administrateur dédiée |
| `set_transport_mission_budget_line` | Crée ou modifie une ligne de budget ; exige un motif après départ. | `missions.update` / permission Finance selon matrice finale |
| `remove_transport_mission_budget_line` | Retire une estimation avant départ ou lance une révision auditée après départ. | `missions.update` / permission Finance selon matrice finale |
| `create_transport_mission_expense` | Crée/saisit une dépense `PLANNED` ou `COMMITTED`. | `missions.expenses.manage` |
| `confirm_transport_mission_expense` | Passe à `PAID`, crée l’`EXPENSE`, le lien et recalcule le wallet. | permission Finance dédiée |
| `cancel_transport_mission_expense` | Annule ou initie une correction, sans effacer l’historique. | permission administrateur dédiée |
| `create_transport_invoice_draft` | Crée le brouillon facture depuis la mission. | `missions.invoice` |
| `issue_transport_invoice` | Fige les montants, alloue le numéro, enregistre le snapshot client. | `missions.invoice` |
| `record_transport_invoice_payment` | Crée un paiement prévu ou reçu, sans mouvement de wallet. | `missions.payments` selon matrice |
| `confirm_transport_invoice_payment` | Crée la recette, lien finance, audit, recalcul wallet et statut facture. | permission Finance dédiée |
| `confirm_transport_mission_adjustment` | Confirme un avoir ou une correction monétaire traçable. | permission administrateur / Finance validée |
| `cancel_transport_mission` | Annule selon règles et lance les corrections nécessaires. | permission administrateur dédiée |

Les RPC de confirmation doivent réutiliser le service financier central et/ou des fonctions PostgreSQL déjà approuvées. Une séquence de requêtes indépendantes dans une Server Function TypeScript est interdite si elle peut produire un état partiel.

---

## 10. Stratégie anti-doublon et compensation

### Confirmation de dépense

1. Verrouiller la dépense (`FOR UPDATE`).
2. Vérifier qu’elle n’est pas déjà `PAID` avec lien financier.
3. Vérifier ou créer, dans la même transaction, l’opération `EXPENSE` et `finance_transport_mission_expense_links`.
4. Si le lien existe déjà, retourner l’opération existante au lieu d’en créer une seconde.
5. Recalculer le wallet par le mécanisme officiel puis écrire l’audit.
6. En cas d’erreur, la transaction annule dépense, opération, lien et audit ensemble.

### Confirmation de paiement

1. Verrouiller paiement et facture.
2. Calculer le solde exigible avec paiements nets et avoirs confirmés.
3. Refuser le surpaiement avant toute écriture.
4. Vérifier/créer l’opération `REVENUE` et `finance_transport_payment_links` dans la même transaction.
5. Recalculer wallet et statut facture à partir des données persistées, pas du navigateur.
6. Une relance retourne l’opération déjà liée, sans deuxième crédit de wallet.

### Corrections

- une correction financière possède son propre lien `finance_transport_adjustment_links` ;
- les montants initiaux restent lisibles ;
- un remboursement client est une sortie du wallet, donc une opération `EXPENSE` liée ;
- un remboursement fournisseur est une entrée du wallet, donc une opération `REVENUE` liée ;
- un avoir sans encaissement est une réduction de créance, sans opération de wallet ;
- aucune correction ne supprime une opération source ou une entrée `business_finance_audit`.

---

## 11. Permissions et politiques RLS proposées

### Permissions futures

Les codes fonctionnels de MT-01 sont conservés. Pour distinguer saisie et confirmation, la migration de permissions future devra ajouter au minimum :

```text
missions.read
missions.create
missions.update
missions.dispatch
missions.expenses.manage
missions.expenses.confirm
missions.invoice
missions.payments.record
missions.payments.confirm
missions.close
missions.override
missions.cancel
missions.correct
missions.finance.read
```

### Matrice validée

| Rôle | Accès |
|---|---|
| Opérations | Lecture opérationnelle, création/mise à jour/planification/exécution, saisie des dépenses. Pas de confirmation financière, émission de facture ni confirmation de paiement. |
| Finance | Lecture financière autorisée, confirmation de dépenses, émission facture, enregistrement/confirmation paiement, clôture standard. |
| Administrateur | Gestion des dérogations, annulations et corrections, avec justification et audit ; accès nécessaire aux contrôles. |
| Lecture seule | Lecture autorisée seulement ; aucune mutation, confirmation, dérogation ou export financier sensible. |

### Principes RLS

- activer RLS sur chaque nouvelle table ;
- ne jamais utiliser `USING (true)` ou `WITH CHECK (true)` sur les données métier sensibles ;
- vérifier les permissions avec les fonctions centrales existantes basées sur `auth.uid()` ;
- réserver `INSERT/UPDATE/DELETE` directs aux RPC sécurisées lorsque la transition a un effet financier ou de statut ;
- garder `finance_operations` et les liens financiers sous les protections Finance existantes ; un accès Mission ne donne pas automatiquement accès aux soldes wallet ni au journal complet ;
- exposer les agrégats de rentabilité aux rôles autorisés via RPC ou vues sécurisées, et non en lisant tous les mouvements dans le navigateur ;
- enregistrer refus importants, dérogations, confirmations et corrections dans l’audit existant ;
- n’accorder aucun `EXECUTE` à `anon`.

La RLS ne filtre pas des colonnes ligne par ligne : les données financières détaillées devront donc être séparées dans les tables finance ou servies par RPC sécurisée, afin que le rôle Opérations puisse saisir une dépense sans obtenir les soldes ou l’historique complet du wallet.

---

## 12. Plan de migration futur — sans exécution dans MT-02

1. **Pré-audit :** inventorier les valeurs textuelles de client déjà présentes dans les recettes historiques, sans les convertir automatiquement en clients maîtres.
2. **Sauvegarde :** prendre un snapshot des tables et objets potentiellement concernés, en particulier `wallets`, `finance_operations`, `finance_links`, `documents` et les rôles/permissions.
3. **CRM-01 :** créer d’abord le référentiel Clients, sa séquence, ses relations documentaires explicites et ses RLS ; aucun import automatique des noms libres historiques.
4. **Référentiels additifs :** créer profils fiscaux et dérogations, avec RLS et audit.
5. **Domaine Mission :** créer Mission, Budget prévisionnel, Dépense, Facture, Paiement, Ajustement, FK, contraintes, index et tables de liaison explicites, sans modifier les tables historiques.
6. **Sécurité :** ajouter permissions, fonctions sécurisées et politiques RLS avant l’interface.
7. **Transactions :** déployer les RPC atomiques et les tests SQL d’idempotence avant tout formulaire.
8. **Validation :** exécuter réconciliation wallet/journal, tests multi-rôles et tests de concurrence ; ne déployer l’interface qu’après résultat propre.
9. **Rollback :** une migration additive peut être désactivée fonctionnellement en retirant les permissions/routage, sans effacer les données créées. Toute suppression future nécessite un plan dédié et une sauvegarde.

Il n’y a pas de backfill obligatoire : le domaine Mission est nouveau. Toute reprise de recettes/dépenses historiques dans des missions doit être un projet distinct, avec règle de mapping validée et traçabilité de chaque ligne.

---

## 13. Tests SQL et applicatifs prévus

### SQL transactionnel

1. création d’un client, mission brouillon, planification puis exécution ;
2. refus de planification sans client, véhicule, chauffeur ou fenêtre valide ;
3. refus de chevauchement véhicule ;
4. refus de chevauchement chauffeur ;
5. réussite uniquement avec dérogation administrateur motivée et auditée ;
6. création d’une dépense par Opérations et refus de confirmation sans permission Finance ;
7. confirmation idempotente d’une dépense : une seule `EXPENSE`, un seul lien et wallet réconcilié ;
8. budget sans wallet ni `finance_operations`, puis comparaison catégorie/total avec les dépenses `PAID` ;
9. facture émise : aucun changement de wallet ;
10. seconde facture active de la même mission refusée, facture annulée conservée ;
11. acompte et paiements partiels : statut `PARTIALLY_PAID` correct ;
12. second appel de confirmation du même paiement : aucune deuxième `REVENUE` ;
13. surpaiement refusé sans mouvement de wallet ;
14. avoir sans wallet et remboursement avec opération compensatoire liée ;
15. clôture refusée avec dépense `PLANNED`/`COMMITTED` ;
16. clôture refusée avec solde client non nul ;
17. clôture dérogatoire administrateur avec justification et audit ;
18. calcul coût/km absent si un relevé est nul ou incohérent, correct si les deux relevés sont valides ;
19. accès `anon` refusé, Lecture seule sans mutation, Opérations sans confirmation, Finance autorisé, Administrateur autorisé à déroger ;
20. rollback complet si l’écriture finance, le lien ou le recalcul wallet échoue.

Les tests SQL doivent être exécutés dans une transaction avec `ROLLBACK` lorsque cela est possible, et ne pas dépendre de données de production non isolées.

### Tests applicatifs

1. création de brouillon et affichage des données référentielles sans duplication ;
2. sélection véhicule/chauffeur avec état de conflit compréhensible ;
3. saisie Opérations puis confirmation Finance d’une dépense ;
4. facture avec taxe absente et facture avec profil fiscal actif ;
5. budget avant départ, affichage de l’écart réel sans créer une écriture finance ;
6. encaissements en plusieurs fois, affichage du solde et blocage du surpaiement ;
7. liens de drill-down Mission ↔ Véhicule ↔ Chauffeur ↔ Client ↔ Finance ↔ Document ;
8. états vide, erreur et chargement sans afficher de montant trompeur ;
9. test multi-rôles réel sur routes, RPC, rapports et exports ;
10. test de rafraîchissement direct et reprise après échec réseau ;
11. vérification de l’absence de fuite de solde wallet ou de journal financier vers Opérations/Lecture seule.

---

## 14. Points encore bloquants avant implémentation

1. format légal définitif des numéros de mission et facture ;
2. régime fiscal exact, devise(s), arrondi et contenu réglementaire du PDF ;
3. champs obligatoires de la fiche Client et gestion des doublons client ;
4. politique exacte des avances clients, remises et tout surpaiement exceptionnel ;
5. procédure comptable validée pour avoir, remboursement client et remboursement fournisseur ;
6. règles de dérogation : motifs normalisés, durée, séparation éventuelle demandeur/approbateur et conservation ;
7. timezone métier pour les fenêtres de chevauchement et heures de départ/retour ;
8. choix des justificatifs obligatoires par type de dépense ;
9. choix de visibilité financière détaillée pour Opérations et Lecture seule ;
10. règle de révision du budget après départ, rôle autorisé et besoin de conserver les versions ;
11. validation de l’intégration avec contrats commerciaux et des alertes de mission, hors MT-02.

Ces points ne doivent pas être contournés par des valeurs par défaut implicites. Ils doivent être décidés avant la migration et avant l’ouverture des écritures financières du module.
