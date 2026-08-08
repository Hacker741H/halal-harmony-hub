# CC-01 — Conception technique du cycle commercial commun

Date : 4 août 2026
Statut : conception prête à implémenter localement ; aucune migration distante appliquée par ce document.

## 1. But et frontière du premier lot

CC-01 apporte le socle commun nécessaire aux ventes **agricoles** et aux ventes de **marchandises** : une vente, ses lignes, sa facture et ses encaissements. Il ne remplace pas les tables spécialisées des Courses : `transport_missions`, `transport_invoices` et `transport_invoice_payments` restent la source de vérité pour le transport.

Le journal `finance_operations` reste la seule source de vérité des flux réellement encaissés. Une facture ou une vente à crédit ne modifie jamais un wallet.

## 2. Décisions techniques retenues

| Sujet | Décision |
| --- | --- |
| Client | Réutiliser `transport_clients` comme référentiel unique, malgré son nom historique. |
| Vente à crédit | La vente et la facture créent une créance ; seul le paiement confirmé crée une `finance_operation` de type `REVENUE`. |
| Paiements | Plusieurs paiements partiels sont admis. Un paiement qui dépasse le solde facturé est refusé. |
| TVA | Taux nul par défaut. Le taux ne peut être renseigné que lorsque `company_settings.vat_enabled` est actif. |
| Stock | Une ligne de vente de marchandise peut générer une sortie physique `OUT` à la confirmation/livraison, jamais un mouvement `SALE` qui encaisserait immédiatement. |
| Récolte | Une ligne peut référencer une récolte et une exploitation. CC-01 ne réserve ni ne décrémente une quantité de récolte : ce contrôle dépend du futur lot CC-03. |
| Annulation | Aucun paiement confirmé ni opération financière n’est supprimé. Une annulation crée une contre-écriture liée et garde l’audit. |
| Documents | Une relation explicite `document_commercial_sale_links` permet d’attacher facture, bon ou reçu à une vente sans `entity_type/entity_id` comme relation métier. |

## 3. Tables proposées

### `commercial_sales`

| Colonne | Type | Rôle |
| --- | --- | --- |
| `id` | `uuid` | clé primaire |
| `sale_number` | `text unique` | référence lisible, générée côté base |
| `status` | `text` | `DRAFT`, `CONFIRMED`, `CANCELLED`, `ARCHIVED` |
| `client_id` | `uuid` FK `transport_clients` | acheteur ; obligatoire pour ce premier cycle à crédit |
| `farm_id` | `uuid` FK `farms`, nullable | origine agricole éventuelle |
| `sale_date` | `date` | date de vente |
| `confirmed_at`, `cancelled_at`, `archived_at` | `timestamptz` | traçabilité de cycle |
| `notes`, `reference` | `text` | contexte ou référence externe |
| `created_by`, `updated_by` | `uuid` FK `auth.users` | audit acteur |
| `created_at`, `updated_at` | `timestamptz` | horodatage |

Une vente annulée reste consultable et ne peut pas être modifiée. Une vente archivée reste consultable et garde tous ses liens.

### `commercial_sale_lines`

| Colonne | Type | Rôle |
| --- | --- | --- |
| `id` | `uuid` | clé primaire |
| `sale_id` | `uuid` FK `commercial_sales` | vente parente |
| `description` | `text` | libellé métier obligatoire |
| `quantity` | `numeric(14,3)` | quantité strictement positive |
| `unit` | `text` | unité affichée (`kg`, `unité`, etc.) |
| `unit_price` | `numeric(14,2)` | prix unitaire non négatif |
| `line_total` | `numeric(14,2)` | montant figé, contrôlé comme `quantity × unit_price` |
| `inventory_item_id` | `uuid` FK `inventory_items`, nullable | article vendu |
| `harvest_id` | `uuid` FK `harvests`, nullable | récolte vendue |
| `farm_id` | `uuid` FK `farms`, nullable | exploitation de la ligne si nécessaire |

Une ligne peut être une prestation sans article ni récolte. Elle ne peut pas pointer simultanément vers un article de stock et une récolte dans CC-01 : les ventes mixtes utilisent plusieurs lignes.

### `commercial_invoices`

| Colonne | Type | Rôle |
| --- | --- | --- |
| `id` | `uuid` | clé primaire |
| `invoice_number` | `text unique` | numéro généré côté base |
| `sale_id` | `uuid` FK `commercial_sales` | vente facturée |
| `client_id` | `uuid` FK `transport_clients` | client de la facture, cohérent avec la vente |
| `status` | `text` | `DRAFT`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `CANCELLED` |
| `issue_date`, `due_date` | `date` | émission et échéance |
| `subtotal_amount`, `tax_rate`, `tax_amount`, `total_amount` | `numeric` | montants générés à partir des lignes, jamais saisis comme un solde |
| `notes` | `text` | mention complémentaire |
| `issued_at`, `cancelled_at` | `timestamptz` | cycle de vie |

Une facture est préparée en brouillon, puis émise. Une vente ne possède qu’une facture active dans CC-01 ; l’annulation est possible tant qu’aucun paiement confirmé ne subsiste.

### `commercial_invoice_payments`

| Colonne | Type | Rôle |
| --- | --- | --- |
| `id` | `uuid` | clé primaire |
| `invoice_id` | `uuid` FK `commercial_invoices` | facture encaissée |
| `sale_id` | `uuid` FK `commercial_sales` | accès direct à la vente |
| `wallet_id` | `uuid` FK `wallets` | wallet crédité lors de la confirmation |
| `amount` | `numeric(14,2)` | montant strictement positif |
| `payment_date` | `date` | date réelle du flux |
| `status` | `text` | `PLANNED`, `RECEIVED`, `CONFIRMED`, `CANCELLED` |
| `payment_kind` | `text` | `DEPOSIT`, `PAYMENT`, `SETTLEMENT`, `REFUND` |
| `reference`, `notes` | `text` | preuve et contexte |
| `confirmed_at`, `cancelled_at` | `timestamptz` | cycle de vie |

Le seul passage à `CONFIRMED` appelle la routine financière. Il verrouille la facture, contrôle le total déjà confirmé et empêche le surpaiement.

## 4. Relations explicites et prévention des doublons

| Table de liaison | Colonnes clés | Garantie |
| --- | --- | --- |
| `finance_commercial_invoice_payment_links` | `operation_id`, `payment_id`, `link_type` | une écriture `PAYMENT` et une éventuelle `REVERSAL` au plus par paiement |
| `commercial_sale_stock_movement_links` | `sale_line_id`, `stock_movement_id` | une sortie physique par ligne d’article |
| `document_commercial_sale_links` | `document_id`, `sale_id` | documents rattachés explicitement à une vente |

Les trois tables portent des clés étrangères et des contraintes d’unicité. Aucune description ou référence texte n’est utilisée comme preuve de liaison financière.

## 5. Contraintes, index et séquences

- séquences dédiées pour les numéros `VTE-AAAA-XXXXXX` et `FAC-AAAA-XXXXXX` ;
- index sur les statuts et dates de vente, émission et échéance ;
- index client/date pour l’échéancier et les fiches 360° ;
- index sur `wallet_id` et `payment_date` pour la réconciliation de trésorerie ;
- index partiel sur les factures ouvertes (`ISSUED`, `PARTIALLY_PAID`) ;
- contrainte `amount > 0` pour tout paiement ;
- contrainte de cohérence des liens `sale_id` / `invoice_id` validée dans les RPC transactionnelles ;
- aucune suppression `CASCADE` depuis une vente vers une facture, un paiement ou une écriture financière.

## 6. RPC transactionnelles prévues

| RPC | Permission | Règle principale |
| --- | --- | --- |
| `create_commercial_sale(jsonb)` | `sales.create` | crée une vente brouillon et ses lignes atomiquement |
| `update_commercial_sale(uuid, jsonb)` | `sales.update` | possible uniquement en brouillon |
| `confirm_commercial_sale(uuid)` | `sales.update` | valide les lignes et crée les sorties de stock `OUT` explicitement liées lorsque nécessaire |
| `cancel_commercial_sale(uuid, text)` | `sales.cancel` | refuse si une facture émise ou un paiement confirmé existe ; annule les sorties physiques autorisées avec audit |
| `create_commercial_invoice(uuid, jsonb)` | `sales.invoice` | calcule les montants depuis les lignes et applique la TVA configurée |
| `issue_commercial_invoice(uuid)` | `sales.invoice` | passe de brouillon à émise |
| `create_commercial_invoice_payment(uuid, jsonb)` | `sales.payments` | enregistre un paiement prévu ou reçu sans toucher au wallet |
| `confirm_commercial_invoice_payment(uuid)` | `sales.payments` + `finance.create` | crée une seule recette dans `finance_operations`, lie l’opération et recalcule le wallet |
| `cancel_commercial_invoice_payment(uuid, text)` | `sales.payments` + `finance.cancel` | crée une contre-écriture si le paiement avait été confirmé |
| `get_commercial_sale_financial_summary(uuid)` | `sales.finance.read` | retourne facturé, encaissé, restant dû et état de règlement calculés |

Chaque fonction sera `SECURITY DEFINER`, avec `search_path = public, auth, pg_temp`, permissions contrôlées via `permission_require`, droits `anon` révoqués et exécution accordée à `authenticated` seulement.

## 7. RLS et confidentialité

- les tables sont en lecture seule directe pour les utilisateurs authentifiés possédant `sales.read` ;
- les indicateurs financiers, factures, paiements et liens financiers nécessitent `sales.finance.read` ;
- aucune mutation directe n’est accordée à `authenticated` : les changements passent exclusivement par les RPC ;
- les documents suivent les permissions Documents existantes, en plus de la permission de lecture de la vente ;
- les rôles suivants sont visés : `admin` (cycle complet), `comptable` (factures, paiements et finances), `exploitations` (création et consultation de ventes agricoles), `stocks` (création et consultation de ventes de marchandises), `gestionnaire` (création et suivi opérationnel) ; les droits exacts seront insérés explicitement et documentés par migration.

## 8. Réconciliation financière

Pour une facture donnée :

```text
reste à encaisser = total facturé − somme des paiements CONFIRMED non annulés
```

Pour une vente :

```text
encaissé = somme des paiements CONFIRMED de ses factures actives
```

Chaque paiement confirmé a exactement une recette liée dans `finance_operations`. Chaque annulation d’un paiement confirmé a exactement une contre-écriture `EXPENSE` liée. Les rapports ne calculent jamais une recette à partir d’une facture seule.

## 9. Plan de migration et de mise en œuvre

1. Ajouter les tables, séquences, index, contraintes, permissions, RLS, liens et RPC dans une migration additive CC-01.
2. Ajouter un test SQL transactionnel avec `ROLLBACK` : création, émission, paiement partiel, règlement, surpaiement refusé, double confirmation refusée, contre-écriture, RLS.
3. Régénérer les types Supabase et ajouter des Server Functions typées.
4. Construire les écrans CC-02 seulement après validation SQL : ventes, facture, encaissement et échéancier.
5. Rattacher les entrées agricoles en CC-03 et les articles de stock en CC-04, sans migration rétroactive destructrice.

## 10. Limites assumées de CC-01

- les factures de Courses restent dans leurs tables spécialisées ;
- l’historique des anciennes ventes de stock encaissées immédiatement ne sera pas recopié ;
- la gestion de quantités agricoles vendables sera introduite seulement avec CC-03 ;
- la TVA est techniquement supportée mais inactive par défaut ;
- les avoirs commerciaux détaillés feront l’objet d’un sous-lot ultérieur. CC-01 couvre l’annulation traçable d’un encaissement par contre-écriture, pas la facturation d’avoir complète.
