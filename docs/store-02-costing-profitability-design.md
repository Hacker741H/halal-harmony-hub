# STORE-02 — CUMP, coût des ventes et résultat magasin

## Architecture retenue

STORE-02 ajoute une couche comptable métier au modèle Commerce existant, sans créer de wallet ni de journal financier parallèle.

- `commerce_inventory_cost_states` porte l'état CUMP courant par magasin et article.
- `commerce_inventory_cost_events` journalise chaque ouverture, achat et sortie valorisée.
- `commercial_sale_line_costs` porte le snapshot 1:1 immuable du coût et de la marge d'une ligne article. Cette table séparée évite d'exposer le CUMP via la politique `sales.read` de `commercial_sale_lines`.
- Les réceptions utilisent toujours `receive_commerce_inventory_item` et le moteur stock/Finance existant. Un trigger applique le CUMP lorsque le mouvement `PURCHASE` reçoit son magasin.
- Les ventes online et offline utilisent toujours `create_commerce_cash_sale`. Un trigger sur le lien ligne/mouvement fige le CUMP dans la même transaction.
- `commerce_store_expenses` décrit la dépense métier ; `finance_commerce_store_expense_links` la relie à l'unique `finance_operation` produite par le moteur existant.
- Les KPI sont calculés à la demande par deux RPC protégées. Aucun bénéfice n'est stocké.

## Formules

À la réception :

```text
nouvelle valeur = valeur CUMP existante + quantité reçue × coût d'achat réel
nouvelle quantité = quantité valorisée existante + quantité reçue
nouveau CUMP = nouvelle valeur / nouvelle quantité
```

À la vente article :

```text
coût historique ligne = quantité vendue × CUMP courant
marge historique ligne = total vendu - coût historique ligne
```

Le snapshot n'est jamais recalculé après une réception ultérieure. Une ligne service ne reçoit aucun coût de stock ; sa marge est donc sa recette tant qu'aucun coût réel distinct ne lui est rattaché.

## Reprise du stock existant

La migration ne reconstruit aucun coût passé. Chaque couple magasin/article déjà en stock doit être initialisé par `initialize_commerce_inventory_opening_cost(location, item, opening_quantity, unit_cost, reason)` avec une quantité vérifiée, un coût approuvé et une justification auditée. La RPC refuse toute quantité d'ouverture différente du stock local réel. Tant que cette ouverture manque :

- la valorisation globale renvoie `isComplete=false`, `costValue=null` et `potentialMargin=null` ;
- une vente ou un nouvel approvisionnement de cet article est refusé, afin de ne pas produire un faux coût.

Cette initialisation est une condition de déploiement, pas un backfill automatique. Le trigger bloquant des ventes n'est créé qu'après une garde vérifiant que tous les stocks positifs sont valorisés dans la même transaction ; sinon toute la migration est annulée et le POS conserve son fonctionnement antérieur.

Pour la première activation, le stock `MAGASIN_TETIDOU / USB-C` est repris par décision manuelle STORE-02D à 4 unités × 350 FCFA, soit 1 400 FCFA. Le mouvement `PURCHASE VALID 082f70b3-370c-4d2f-ad6c-bc746385d6bf` est conservé comme référence disponible, mais l'audit précise que la sortie historique d'une unité n'est pas traçable et que l'ouverture n'est pas une reconstitution historique certifiée. Cette reprise ne crée aucun mouvement de stock, aucune opération Finance et aucun mouvement wallet.

Dans Commerce, `business_location_inventory_items.quantity` est la source opérationnelle du POS par magasin. `inventory_items.stock_actuel` reste un agrégat global legacy mis à jour en parallèle ; son écart historique ne sert ni à autoriser la vente POS ni à valoriser STORE-02 et n'est pas corrigé silencieusement par cette migration.

## Résultat magasin

`get_commerce_store_profitability` ne retient que les ventes `CONFIRMED` et les dépenses `CONFIRMED` dont l'opération Finance liée n'est pas annulée.

```text
CA total = CA articles + CA services
CMV = somme des snapshots de coût des lignes article
marge brute = CA total - CMV
résultat net = marge brute - dépenses d'exploitation confirmées
```

Une vente annulée est exclue par son statut. Un reçu offline en attente/conflit n'a aucune vente serveur et reste donc exclu ; après synchronisation réussie, l'idempotence existante garantit une comptabilisation unique.

## Sécurité

Les nouvelles permissions `store.financial.read`, `store.stock_valuation.read` et `store.expenses.*` sont accordées à `super_admin`, `admin`, `gestionnaire` et `comptable`, jamais à `caissier`. Les tables de coûts et la liaison Finance ne sont pas lisibles directement par `authenticated`. Les RPC vérifient à la fois la permission et `commerce_location_access_allowed`.

## Livraison et validation

- Migration locale préparée : `20260813120000_add_store_costing_and_profitability.sql`.
- Test transactionnel : `scripts/test-store-costing-profitability.sql`, scénarios A à G, avec `ROLLBACK`.
- La migration n'a pas été appliquée à Supabase.
- L'exécution locale intégrée reste à effectuer : Docker Desktop/PostgreSQL local n'était pas disponible pendant la préparation.
