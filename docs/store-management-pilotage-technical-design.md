# STORE-01 — Design technique du centre de pilotage magasin

Date : 12 août 2026
Statut : proposition technique à valider. Ce document ne crée ni migration, ni RPC, ni droit, ni composant.

## 1. Objectif et frontière

Le centre de pilotage magasin doit permettre à un responsable autorisé de comprendre un magasin en moins de cinq minutes : activité de vente, stock, encaissements, wallets, remises, clôtures, synchronisation offline et anomalies. Il est un **consommateur de données existantes**, jamais un second moteur comptable ou de vente.

Les principes structurants sont les suivants :

- une vente reste créée uniquement par le moteur Commerce/POS existant ;
- tout effet financier provient uniquement de `finance_operations` via les RPC métier existantes ;
- le cockpit ne modifie pas directement les wallets, le stock, les factures ou les paiements ;
- les bénéfices, marges, soldes et restes à encaisser sont calculés à la demande ;
- chaque agrégat doit pouvoir ouvrir ses transactions sources ;
- un montant absent ou non autorisé est rendu comme `null` avec une raison, jamais comme un faux zéro.

## 2. Architecture cible

```text
Sources opérationnelles existantes
  ventes / lignes / factures / paiements
  stock local / mouvements / achats
  wallets associés / remises
  reçus offline / clôtures de caisse
              │
              ▼
RPC de lecture sécurisées et paginées
  vérifient auth.uid(), permission et accès au magasin
  calculent les agrégats dans PostgreSQL
              │
              ▼
Server Functions typées
              │
              ▼
Cockpit manager Commerce
  KPI → drill-down → sources existantes
```

Cette architecture étend l'existant au lieu de créer une base de reporting. La RPC actuelle `get_commerce_management_dashboard(uuid)` doit être enrichie ou remplacée de manière compatible ; il ne faut pas créer un deuxième dashboard concurrent.

## 3. Contrat de données et conventions de période

### 3.1 Paramètres communs proposés

Chaque RPC de lecture doit recevoir un contrat homogène :

```ts
{
  businessLocationId: string;
  from: "YYYY-MM-DD";
  to: "YYYY-MM-DD";
  preset?: "TODAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR" | "CUSTOM";
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string[];
}
```

Les bornes et le fuseau métier devront s'appuyer sur la configuration ERP existante lorsqu'elle est disponible. Avant cela, la réponse doit préciser la convention utilisée :

- ventes : `commercial_sales.sale_date` ;
- encaissements : `commercial_invoice_payments.payment_date` ;
- achats de stock : `stock_movements.movement_date` ;
- remises : `commerce_cash_remittances.remittance_date` ;
- clôtures et offline : horodatage appareil et réception serveur, tous deux disponibles ; le cockpit doit libeller clairement celui qui sert au filtre.

### 3.2 Réponse de dashboard proposée

La réponse doit exposer des sections autonomes et optionnelles selon les droits, par exemple :

```ts
{
  location: { id, name, code },
  period: { from, to, timezone, convention },
  access: { financial: boolean, stockValuation: boolean },
  sales: { ticketCount, turnover, articlesTurnover, servicesTurnover, averageBasket },
  collections: { collected, outstanding },
  inventory: {
    itemCount, lowStockCount, outOfStockCount,
    potentialSaleValue, costValue: null, costValueStatus: "UNAVAILABLE"
  },
  cash: { mappedWallets, remittances, recentClosures },
  offline: { processedCount, conflictCount, pendingClientCount: null },
  profitability: {
    cogs: null, grossMargin: null, netManagementResult: null,
    status: "COST_METHOD_NOT_CONFIGURED"
  },
  warnings: [{ code, severity, message, route }]
}
```

`null` est intentionnel : il signifie qu'une donnée ne peut pas être calculée de manière fiable ou que l'utilisateur n'est pas autorisé à la voir. La vue ne la remplace jamais par `0`.

## 4. Définitions des indicateurs

| Indicateur | Formule cible | État actuel |
|---|---|---|
| CA des ventes | somme des lignes des ventes `CONFIRMED` | Disponible |
| CA articles / services | somme des lignes par `line_type` | Disponible |
| Encaissements | somme des paiements `CONFIRMED` de la période | Disponible |
| Reste à encaisser | factures actives − paiements confirmés ± corrections liées | Disponible via la logique facture existante, à réutiliser |
| Panier moyen | CA / nombre de tickets confirmés, si nombre > 0 | Disponible |
| Valeur de vente du stock | somme `quantité locale × prix de vente local` lorsque le prix est renseigné | Disponible |
| Coût de stock | somme des couches de coût encore disponibles | Non disponible : aucune couche actuellement |
| CMV / COGS | coût immuable des unités réellement vendues | Non disponible : aucun coût historisé par ligne de vente |
| Marge brute articles | CA articles − CMV articles | Non disponible |
| Marge de services | CA services − coûts directs de services | Non disponible : coût direct absent |
| Dépenses opérationnelles | somme des dépenses magasin explicitement liées et confirmées | Non disponible : relation magasin absente |
| Résultat net de gestion | marge brute articles + marge services − dépenses opérationnelles confirmées | Non disponible |
| Résultat prévisionnel | résultat réalisé − dépenses prévues non confirmées | Non disponible : prévisions absentes |
| Solde de caisse | solde du wallet `CASH_DRAWER` primaire | Disponible, mais ne mesure pas la marge |
| Remises | mouvements internes magasin → wallet destination | Table et lien financier existants |
| Écart de caisse | espèces comptées − espèces théoriques serveur | Disponible dans les clôtures |

### Règles de non-double comptage

- Les transferts internes et remises de caisse sont exclus de la recette, de la dépense et du résultat du magasin.
- Un achat de stock est un décaissement de trésorerie et une entrée d'inventaire. Il n'est pas retranché une seconde fois si le CMV est calculé à la vente.
- Le montant reçu du client est distinct de la monnaie rendue : seule la somme de la vente est une recette.
- Une clôture de caisse est un contrôle : l'écart ne crée automatiquement ni recette, ni dépense, ni `finance_operation`.
- Une vente offline synchronisée est reconnue par `offline_sale_id`, puis délègue au moteur de vente existant : elle ne doit donc apparaître qu'une fois dans tous les agrégats.

## 5. Modèle de coûts et de rentabilité : décision obligatoire

### 5.1 État actuel

Le système enregistre un prix unitaire sur chaque mouvement d'achat et un prix de vente local, mais aucune donnée ne précise quelles unités achetées sont sorties à la vente. Les ventes ne gardent pas non plus leur coût de revient.

Il est donc interdit de calculer le CMV, la marge ou le bénéfice à partir du dernier prix d'achat, d'une moyenne calculée au navigateur ou du prix actuel du stock.

### 5.2 Option recommandée : lots FIFO immuables

Après validation métier, la solution la plus auditable est de créer, dans une phase ultérieure, des couches de coût explicites :

| Table future proposée | Rôle | Contraintes clés |
|---|---|---|
| `commerce_inventory_cost_layers` | une réception de stock valorisée pour un article et un magasin | FK magasin, article, mouvement d'achat ; quantité initiale/restante ≥ 0 ; coût unitaire ≥ 0 ; unicité mouvement d'achat |
| `commercial_sale_line_cost_allocations` | consommation d'un ou plusieurs lots par ligne de vente article | FK ligne de vente, couche ; quantité > 0 ; unicité de combinaison ; total consommé ≤ quantité de ligne |

À la confirmation d'une vente article, le moteur de stock existant consommerait les lots dans l'ordre FIFO, enregistrerait les allocations et figerait le coût. Toute annulation utiliserait une contre-écriture/retour de lot traçable, jamais une suppression de l'historique.

Le coût moyen pondéré est une alternative acceptable seulement si le métier le choisit explicitement. Dans ce cas, il faut conserver un état de coût par article/magasin et un snapshot de coût sur la ligne de vente ; ce snapshot reste obligatoire pour l'audit historique.

### 5.3 Reprise de l'historique

Le coût historique ne doit pas être inventé. La migration future devra :

1. choisir une date d'entrée en vigueur ;
2. prendre un inventaire d'ouverture par magasin, approuvé par un responsable ;
3. créer des lots d'ouverture avec coût déclaré et justification ;
4. marquer les périodes antérieures comme `COST_UNAVAILABLE` plutôt que recalculer une marge supposée.

## 6. Dépenses magasin et prévisions : modèle futur minimal

`expenses` est une table historique générale, liée de façon polymorphe. Elle ne répond pas à l'exigence d'une relation explicite vers un magasin. Il est recommandé de ne pas l'étendre pour ce cas sans décision : cela prolongerait un lien polymorphe que le projet évite désormais.

### 6.1 Dépenses opérationnelles réelles

Une future table dédiée, par exemple `commerce_store_expenses`, pourra contenir :

```text
id
business_location_id            → business_locations
category                         (loyer, transport, emballage, réparation, internet, autre)
amount
expense_date
status                           (DRAFT, CONFIRMED, CANCELLED)
wallet_id                        → wallets, nullable jusqu'à confirmation si le métier le permet
reference
description
created_by / confirmed_by / confirmed_at
created_at / updated_at
```

Une table de liaison explicite `finance_commerce_store_expense_links` devra associer une dépense confirmée à son unique opération financière. La RPC de confirmation doit appeler le moteur financier existant, qui crée l'opération et recalcule le wallet. Elle ne doit jamais écrire directement dans `finance_operations`.

### 6.2 Dépenses prévues

Les prévisions ne doivent pas toucher les wallets ni le résultat réalisé. Une table séparée, par exemple `commerce_store_planned_expenses`, pourra contenir :

```text
id, business_location_id, category, expected_amount,
expected_date, status (PLANNED, CONFIRMED, CANCELLED),
reference, notes, created_by, confirmed_expense_id, timestamps
```

À confirmation, elle référence la dépense réelle : aucun doublon d'écriture financière n'est créé.

### 6.3 Services

Les services sont déjà compatibles avec le ticket mixte et n'affectent pas le stock. Pour mesurer leur marge, le futur modèle devra choisir entre :

- saisir un coût direct optionnel et auditable sur la ligne de vente ;
- rattacher une dépense confirmée à une prestation ;
- ou afficher uniquement le CA service tant qu'aucun coût n'est défini.

La troisième option est la seule véridique à ce stade.

## 7. RPC de lecture et mutations proposées pour les phases futures

Toutes les fonctions suivantes sont des **propositions**. Elles doivent être `SECURITY DEFINER` uniquement lorsque nécessaire, avec `SET search_path = public, auth, pg_temp`, validation stricte et permissions côté base.

### Lecture

| RPC future | But | Règles d'accès |
|---|---|---|
| `get_commerce_management_dashboard_v2(jsonb)` ou extension compatible de l'existante | KPI de magasin pour une période | vérifie utilisateur, accès au magasin et droits par section |
| `list_commerce_store_transactions(jsonb)` | ventes, paiements, achats, remises, opérations liées ; pagination et drill-down | finance seulement si permission dédiée |
| `list_commerce_store_cash_closures(jsonb)` | clôtures, montants théorique/compté, écarts et état | responsable/finance autorisé ; caissier limité à ses sessions si nécessaire |
| `list_commerce_store_offline_sync(jsonb)` | reçus synchronisés, conflits et erreurs contrôlées | responsable/administrateur autorisé ; aucune exposition directe de payload sensible |
| `get_commerce_store_stock_valuation(jsonb)` | valeur vente et, après activation, valeur coût / lots | lecture stock ; coût/marge réservés aux rôles financiers autorisés |

### Mutations après validation du modèle

| RPC future | Comportement attendu |
|---|---|
| `create_commerce_store_expense(jsonb)` | crée un brouillon de dépense magasin ; aucune opération financière |
| `confirm_commerce_store_expense(uuid)` | vérifie permission, wallet, statut et montant, puis délègue au moteur financier existant ; crée le lien explicite et l'audit |
| `cancel_commerce_store_expense(uuid, reason)` | contre-écriture métier si la dépense est confirmée ; pas de suppression |
| `create_or_update_commerce_store_planned_expense(jsonb)` | prévision sans finance ni wallet |
| `confirm_commerce_store_planned_expense(uuid, payload)` | lie la prévision à la dépense réelle confirmée, sans double écriture |

Les remises de caisse doivent réutiliser `commerce_cash_remittances` et `finance_commerce_cash_remittance_links`, non un second mécanisme de transfert.

## 8. Permissions et RLS proposées

Le catalogue central de permissions doit rester l'unique source. Les permissions existantes restent actives durant une migration progressive. Les codes suivants répondent au besoin métier et pourront être ajoutés seulement dans une future migration dédiée :

| Permission proposée | Effet |
|---|---|
| `store.dashboard.read` | accéder au cockpit non financier d'un magasin affecté |
| `store.financial.read` | voir CA, encaissements, wallets, achats, marges et résultats disponibles |
| `store.stock_valuation.read` | voir coûts, valorisation et marge dès que le modèle de coût existe |
| `store.expenses.read` / `store.expenses.create` / `store.expenses.confirm` | consulter, préparer, confirmer les dépenses magasin selon rôle |
| `store.cash_closures.read` | voir clôtures et écarts selon périmètre autorisé |
| `store.transactions.read` | consulter le journal magasin paginé et ses liens sources |

Règles de sécurité :

- l'appelant est toujours `auth.uid()` ; aucun `user_id`, magasin ou wallet déclaré par le navigateur n'est considéré comme une autorisation ;
- toute RPC vérifie `commerce_location_access_allowed(location_id)` ;
- les agrégats financiers ne sont retournés que si l'utilisateur a le droit financier ;
- les caissiers conservent la caisse et leurs contrôles de session, sans accès implicite au coût d'achat, à la marge, au résultat ou aux dépenses ;
- les relations financières et les tables offline restent non accessibles directement ; les RPC exposent uniquement les champs nécessaires ;
- `anon` ne reçoit jamais `EXECUTE` ; les grants `authenticated` sont limités aux fonctions qui font leurs vérifications internes.

## 9. Expérience utilisateur du cockpit futur

Le manager voit le magasin, pas une caisse déguisée. L'espace de vente comptoir reste réservé au caissier.

### En-tête

- magasin sélectionné, statut, période et date de dernière synchronisation ;
- navigation vers caisse, stocks, ventes, wallet, clôtures et conflits selon permission ;
- état clair en cas d'erreur, d'absence de données ou de droit financier manquant.

### Ordre des sections

1. Activité : ventes, encaissements, reste à encaisser, panier moyen, articles/services.
2. Stock : quantité, ruptures, seuils, valeur de vente potentielle ; coût/marge uniquement si réellement disponible.
3. Trésorerie : wallet(s) affecté(s), remises confirmées/en attente, sans qualifier le solde de bénéfice.
4. Contrôle de caisse : clôtures, écarts, sessions nécessitant revue.
5. Offline : synchronisations réussies, conflits à résoudre et dernière activité terminal.
6. Transactions : tableau paginé, filtrable et lié aux ventes, paiements, mouvements de stock, remises et opérations source.
7. Dépenses et prévisions : seulement après mise en place des liens explicites.

Chaque carte inclut une définition courte, le filtre temporel appliqué et un drill-down. Une carte impossible à calculer présente le motif (« méthode de coût non configurée »), pas un chiffre décoratif.

## 10. Performance, index et pagination

Les premiers index existent déjà sur les locations, les stocks locaux, les ventes et mouvements par magasin, les remises, les reçus offline et les clôtures. Les phases ultérieures devront vérifier les plans réels avec `EXPLAIN (ANALYZE, BUFFERS)` avant d'ajouter des index supplémentaires.

Indexes probablement nécessaires si les volumes le justifient :

```text
commercial_sales (business_location_id, status, sale_date DESC)
commercial_invoice_payments (sale_id, status, payment_date DESC)
commercial_sale_lines (sale_id, line_type)
stock_movements (business_location_id, movement_type, status, movement_date DESC)
commerce_pos_offline_receipts (business_location_id, status, received_at_server DESC)
commerce_pos_cash_session_closures (business_location_id, status, closed_at_device DESC)
```

Les agrégations et calculs de coût doivent rester côté PostgreSQL. Le navigateur ne charge ni toutes les opérations financières ni tous les mouvements de stock pour faire ses propres sommes. Les listes longues sont paginées par curseur ou par page, jamais intégralement rendues dans le cockpit.

## 11. Plan de migration et de livraison futur

| Phase | Contenu | Condition de passage |
|---|---|---|
| STORE-02A | extension en lecture du cockpit avec indicateurs déjà exacts, drill-down et états `UNAVAILABLE` | aucune règle de coût requise |
| STORE-02B | décision métier coût + dépense magasin + période | document de validation signé/accepté |
| STORE-03 | migrations additives de lots/coûts, liens dépenses magasin et prévisions ; reprise d'inventaire contrôlée | tests de non-double comptage et stratégie de backfill approuvée |
| STORE-04 | KPI marge/résultat, dépenses, prévisions, alertes magasin et rapports | réconciliation finance/stock réussie |
| STORE-05 | optimisation, exports sécurisés, recette multi-rôles et documentation d'exploitation | charge, RLS et UX validées |

Chaque migration future doit être additive, idempotente lorsque possible, accompagnée d'un plan de reprise et appliquée seulement après dry-run contrôlé. Aucun historique de vente ou de finance n'est supprimé.

## 12. Plan de tests futur

### Réconciliation métier

- vente article : une vente → une facture → un paiement → une opération financière → un crédit wallet → une sortie stock ;
- ticket article + service : le service augmente le CA, sans mouvement de stock ;
- encaissement partiel / total : CA, encaissé et reste à encaisser ne sont pas confondus ;
- remise de caisse : transfert source/destination, neutre pour recette/dépense/marge ;
- clôture avec écart : enregistre l'écart, sans mouvement artificial de finance ou wallet ;
- vente offline rejouée : un même `offline_sale_id` n'apparaît qu'une fois ;
- conflit offline : aucune vente, facture, paiement, opération financière ou sortie stock partielle ;
- achat de stock : décaissement visible comme achat, sans le soustraire une seconde fois après activation du CMV.

### Tests de coût après STORE-03

- réceptions à des coûts différents ;
- vente partielle et complète ;
- calcul FIFO ou coût moyen selon la décision validée ;
- annulation/retour par contre-écriture ;
- inventaire d'ouverture et période antérieure marquée indisponible ;
- somme des allocations de coût ≤ quantité et coût de chaque ligne immuable.

### Sécurité

- caissier affecté : accès POS et ses propres contrôles, sans marge, coût ni résultat ;
- responsable magasin : lecture du cockpit seulement pour les magasins affectés ;
- finance/administrateur : agrégats financiers et transactions autorisés selon permission ;
- utilisateur non affecté : refusé côté RPC ;
- `anon` : refusé ;
- un export/drill-down ne révèle aucune colonne masquée par permission.

## 13. Risques restants et décisions bloquantes

| Risque / question | Effet si non résolu | Décision attendue |
|---|---|---|
| FIFO ou coût moyen non choisi | marge et coût de stock impossibles à certifier | choisir la méthode et la date d'application |
| Pas d'inventaire d'ouverture | historique de coût non réconciliable | valider le relevé initial par magasin |
| Dépense magasin sans relation explicite | résultat net et dépenses par magasin trompeurs | confirmer le modèle proposé ou une alternative relationnelle existante |
| Coût des services inconnu | rentabilité des prestations indisponible | choisir coût direct, dépense liée ou CA seul |
| Écarts de caisse | risque de les traiter à tort comme une dépense | conserver l'écart comme contrôle jusqu'à décision Finance |
| Périodes offline | divergences de date appareil/serveur | valider la convention de reporting et le fuseau métier |

## 14. Décision recommandée

Commencer par STORE-02A : un centre de pilotage en lecture qui ne montre que les données exactes, puis afficher explicitement « non disponible — méthode de coût à configurer » pour le coût, la marge et le résultat net. Cette approche donne immédiatement de la visibilité au magasin sans présenter des chiffres inexacts, tout en préparant une fondation auditable pour la rentabilité complète.
