# Audit des automatisations métier et finance

Date : 2026-07-28
Périmètre : LOT 5

## Source de vérité constatée

`finance_operations` est le journal financier unique depuis le LOT 4. Les
opérations y portent notamment `wallet_id`, `destination_wallet_id`, `type`,
`amount`, `operation_date`, `status`, les références métier (`vehicle_id`,
`farm_id`, `motorcycle_id`, `driver_id`, `employee_id`, `contract_id`,
`harvest_id`, `maintenance_id`, `motorcycle_maintenance_id`,
`inventory_item_id`) et l'auteur `created_by`.

Le journal accepte `REVENUE`, `EXPENSE`, `DEPOSIT` et `TRANSFER`. Les RPC
financières du LOT 4 valident les wallets et recalculent les soldes. Les
anciennes tables `revenues`, `expenses` et `payments` restent des archives en
lecture seule et ne sont pas une source d'événements métier.

Les comptages distants au début de ce lot sont : 3 récoltes, 0 entretien de
moto, 0 entretien générique, 2 motos, 4 véhicules, 1 employé, 1 chauffeur, 1
article `inventory_items`, 0 ligne `stocks`, 13 opérations financières, 2
liens génériques et 5 wallets.

## État des tables métier

| Domaine | Table réellement utilisée | Action actuelle | Finance actuelle | Décision LOT 5 |
| --- | --- | --- | --- | --- |
| Récolte | `harvests` | Création, modification, suppression depuis la fiche exploitation | Aucune | Une récolte reste physique tant qu'aucun wallet d'encaissement n'est choisi. Un wallet explicite représente l'encaissement de la vente et génère une recette liée. |
| Vente agricole | aucune table dédiée | Non modélisée | Aucune | Ne pas inventer une vente séparée. Le modèle existant supportera l'encaissement explicite attaché à la récolte ; une future vente avec livraison/créance nécessitera son propre lot. |
| Entretien moto | `motorcycle_maintenances` | CRUD depuis la fiche moto et `/maintenance` | Aucune | `cost > 0` avec wallet obligatoire crée ou met à jour une dépense liée. Sans coût, aucun mouvement financier. |
| Entretien véhicule | `maintenances` avec `entity_type = 'vehicule'` | Lecture seulement sur la fiche véhicule ; aucune table `vehicle_maintenances` | Aucune | Conserver le modèle générique existant et créer les fonctions/formulaires nécessaires. `cout > 0` avec wallet crée une dépense liée. |
| Achat moto | `motorcycles` (`prix_achat`, `date_achat`) | CRUD depuis `/motorcycles` | Aucune | Ajouter le choix de wallet d'achat au modèle existant. Prix positif + wallet crée une dépense d'achat liée, sans dupliquer l'architecture véhicule. |
| Achat véhicule | `vehicles` (`purchase_price`, `purchase_wallet_id`) | CRUD, avec lien `finance_links` | Dépense et recalcul déjà présents, mais écriture métier et finance séparées côté application | Conserver `finance_links` pour les achats véhicule et déplacer les écritures couplées dans une RPC atomique. |
| Employé | `employees` (`salaire_base`) | CRUD | Aucune | `salaire_base` est un montant théorique. Aucun paiement ne sera créé lors de sa saisie. |
| Chauffeur | `drivers` relié à `employees.employee_id` | CRUD | Aucune | Même règle : un chauffeur n'est pas un événement de paiement. |
| Paiement de salaire | aucune table | Non modélisé | Aucune | Créer un événement explicite `salary_payments` et un lien financier, afin de stocker la période, le contrat éventuel et un paiement partiel sans confondre profil et paiement. |
| Stock actif | `inventory_items` | CRUD depuis `/stocks` | Aucune | Source de vérité du stock applicatif. |
| Ancien stock | `stocks` | Non référencé par les fonctions, routes ou composants | Aucune | Conserver sans migration ni suppression. Ce n'est pas la source utilisée par l'interface. |
| Mouvement de stock | aucune table (`stock_movements` absente) | Non modélisé | Aucune | Créer `stock_movements` pour les entrées, sorties, achats, ventes, ajustements, pertes et transferts. Seuls achat et vente avec wallet créent une écriture financière. |

## Contrats et relations déjà en place

- `harvests.farm_id -> farms.id` avec suppression en cascade.
- `motorcycle_maintenances.motorcycle_id -> motorcycles.id` avec suppression
  en cascade.
- `motorcycles.driver_id` et `vehicles.driver_id -> drivers.id` avec mise à
  `NULL` à la suppression.
- `drivers.employee_id -> employees.id` avec mise à `NULL` à la suppression.
- `finance_operations` référence déjà les principales entités métier. Ses
  références sont majoritairement `ON DELETE SET NULL`, ce qui préserve le
  journal lorsqu'une entité est supprimée.
- L'achat véhicule est relié par `finance_links` (`module = 'VEHICLE'`) ; la
  contrainte unique actuelle ne garantit pas encore l'unicité de la source
  métier seule.

## Politique RLS observée

Les tables principales disposent de politiques lecture authentifiée et écriture
par rôle (`super_admin`, `admin`, `gestionnaire`; la finance inclut
`comptable`). Les exceptions à corriger sont :

- `motorcycle_maintenances` possède en plus une ancienne politique
  `Allow authenticated insert`, trop permissive ; elle doit être supprimée.
- `stocks` n'a pas de politique documentée dans le schéma distant et n'est pas
  consommée par l'application.
- Les nouvelles tables de liaison et nouveaux événements doivent recevoir RLS,
  index et clés étrangères dès leur création.

## Règles métier retenues

### Récolte et vente

Les champs historiques de récolte (`quantite_kg`, `prix_kg`, `acheteur`) ne
prouvent pas, à eux seuls, un encaissement. Le choix explicite d'un
`sale_wallet_id` est donc le signal de vente encaissée. Il est optionnel :
l'absence de wallet laisse la récolte sans recette. Une modification du prix,
de la date, de l'acheteur, de l'exploitation ou du wallet met à jour la même
opération ; retirer le wallet annule l'opération au lieu de la supprimer.

### Entretiens

Un coût nul n'est pas financier. Un coût strictement positif impose un wallet
et crée une unique dépense `EXPENSE`, catégorisée entretien. La modification
réutilise la même opération et recalcule les wallets concernés. La suppression
de l'entretien annule l'opération liée dans la même transaction.

### Achats de véhicules et motos

Un prix d'achat strictement positif impose le wallet d'achat. L'écriture est
une dépense unique. La modification de prix ou de wallet met à jour la dépense
existante ; la suppression du véhicule ou de la moto est bloquée lorsqu'il
reste d'autres opérations historiques. L'annulation du prix annule l'opération
d'achat plutôt que d'effacer la trace.

### Salaires

Le salaire de base est une prévision. Une dépense est créée uniquement par un
paiement explicitement enregistré, comprenant une personne (`employee_id` ou
`driver_id`), période, wallet, montant, date et contrat éventuel. Une
contrainte empêche deux paiements complets pour la même personne et période ;
des paiements partiels restent explicitement indiqués.

### Stocks

Le stock physique et la finance sont séparés. `PURCHASE` avec wallet crée une
dépense ; `SALE` avec wallet crée une recette. `IN`, `OUT`, `ADJUSTMENT`,
`LOSS` et `TRANSFER` restent physiques et n'ont pas d'écriture financière dans
ce lot. Un wallet est interdit pour ces mouvements non financiers, afin
d'éviter une ambiguïté comptable.

## Risques de doublon identifiés

1. L'ancien achat véhicule recherche une dépense par catégorie si le lien est
   absent ; cette inférence textuelle est insuffisante. Les nouvelles RPC
   s'appuieront exclusivement sur des liens explicites uniques.
2. Les entretiens ne possèdent aujourd'hui ni wallet ni lien financier ; un
   second enregistrement peut donc créer deux dépenses sans protection tant
   que les tables de liaison ne sont pas installées.
3. Les prix d'achat de moto sont descriptifs et sans wallet ; aucune dépense
   ne peut aujourd'hui être rapprochée de manière certaine.
4. `stocks` et `inventory_items` sont deux modèles historiques distincts. Ils
   ne seront pas fusionnés dans ce lot.

## Implémentation ciblée après cet audit

Une migration additive introduira des liens explicites uniques, les événements
métier manquants (`salary_payments`, `stock_movements`), des RPC spécifiques et
un journal d'audit des automatisations. Les Server Functions n'appelleront ces
RPC qu'avec des données validées par Zod. Aucune migration d'anciennes données
ni suppression de données n'est nécessaire pour ce lot.

## Mise en œuvre du lot

Les migrations `20260728170000`, `20260728171000` et `20260728172000` ont été
appliquées. Elles ajoutent les liens explicites, les RPC transactionnelles et
un journal d'audit. Elles ont également corrigé la réconciliation des wallets
pour exclure les opérations `CANCELLED` — ces opérations restent visibles pour
l'audit mais ne modifient plus le solde.

Automatisations actives : récolte encaissée, entretien moto, entretien
véhicule, achat moto, achat véhicule, paiement de salaire explicite, achat de
stock et vente de stock. Chaque mise à jour réutilise l'opération liée ; une
annulation conserve l'opération avec le statut `CANCELLED`.

Les actions volontairement non financières sont : récolte sans wallet,
prévision de salaire, entrée gratuite, sortie interne, ajustement, perte et
transfert physique de stock. Le modèle courant ne possède ni lieu de stock ni
vente agricole à crédit ; ces deux besoins doivent faire l'objet d'un modèle
métier explicite avant automatisation comptable.
