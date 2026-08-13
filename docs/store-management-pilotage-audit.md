# STORE-01 — Audit du centre de pilotage magasin

Date d'audit : 12 août 2026  
Périmètre : Commerce, stocks, POS, wallets, finance, ventes, paiements, clôtures de caisse et synchronisation offline.  
Nature : audit de l'existant uniquement. Aucune migration, RPC, permission, règle financière ou interface n'est créée dans STORE-01.

## 1. Conclusion exécutive

Le projet possède déjà un socle Commerce solide : un magasin est un `business_location`, les caissiers et responsables y sont affectés explicitement, les wallets autorisés sont liés au magasin, et la vente POS réutilise le même moteur transactionnel pour la vente, la facture, le paiement, le stock, `finance_operations` et le wallet.

Un premier cockpit existe déjà via `get_commerce_management_dashboard(uuid)`. Il est volontairement limité : ventes et encaissements jour/semaine/mois, wallet de caisse principal, état du stock et dernières ventes. Il ne couvre pas encore le pilotage complet demandé dans STORE-01.

Le blocage majeur n'est pas l'interface : **le modèle actuel ne définit aucune méthode de valorisation de stock ni de coût des ventes (CMV/COGS) immuable**. Les prix d'achat sont conservés dans les mouvements d'achat, mais aucune couche de coût ni aucun coût historisé par ligne de vente n'existe. Il serait donc incorrect d'afficher aujourd'hui une valeur de stock au coût, une marge brute réalisée, un bénéfice net ou un « produit le plus rentable » comme des chiffres fiables.

La bonne suite est donc :

1. construire un cockpit de lecture strictement fidèle aux données actuellement disponibles ;
2. faire valider une politique de valorisation (FIFO ou coût moyen pondéré) et le périmètre des dépenses magasin ;
3. seulement ensuite ajouter, par migrations additives, les coûts historiques et les relations explicites nécessaires à la marge et au résultat net.

## 2. Règles de sécurité et de vérité conservées

- `finance_operations` reste le seul journal financier. Aucun KPI ne modifie une écriture, un wallet ou un stock.
- Le solde d'un wallet est une donnée de trésorerie, pas un bénéfice. Il n'est jamais confondu avec la marge ou le résultat.
- Les transferts/remises internes ne constituent ni une recette ni une dépense de résultat.
- Les valeurs de bénéfice, marge, reste à encaisser et solde sont calculées côté PostgreSQL à la demande ; elles ne sont pas stockées comme des colonnes modifiables.
- Les ventes POS utilisent déjà un chemin transactionnel unique et idempotent. Le futur cockpit doit lire ses résultats, jamais les reproduire.
- Une absence de permission ou une erreur de requête doit rester distincte d'un montant réel égal à zéro.

## 3. Sources de données réellement disponibles

| Domaine | Sources actuelles | Relations explicites | Données exploitables maintenant | Limites constatées |
|---|---|---|---|---|
| Magasin / activité | `business_units`, `business_locations` | `business_locations.business_unit_id` ; le magasin Commerce est une location dont l'unité a le code `COMMERCE` | Nom, code, statut, magasin sélectionné | Pas de notion distincte à créer : `business_locations` est déjà la source de vérité des magasins. |
| Affectations | `business_location_assignments` | magasin → `auth.users`, rôle d'affectation (`CASHIER`, `STORE_MANAGER`, `STOCK_KEEPER`, `SALES_AGENT`, `OTHER`) | Caissier/responsable affecté, historique par dates | L'affectation ne constitue pas à elle seule une permission financière. |
| Wallets magasin | `business_location_wallets`, `wallets` | magasin → wallet avec finalité `CASH_DRAWER`, `COLLECTION` ou `OPERATING` ; une seule caisse primaire active par magasin | Wallet de caisse, wallets autorisés, solde courant de chaque wallet affecté | Le cockpit actuel ne retourne que le wallet `CASH_DRAWER` primaire. |
| Catalogue et stock local | `inventory_items`, `business_location_inventory_items` | magasin + article unique ; quantité locale, prix de vente local et seuil de réapprovisionnement | Quantité en rayon, rupture, stock faible, valeur potentielle de vente | Aucun coût unitaire courant ou historique n'est stocké au niveau du magasin. |
| Mouvements de stock | `stock_movements`, `commercial_sale_stock_movement_links`, `finance_stock_movement_links` | mouvement → article, wallet éventuel, magasin ; ligne de vente → mouvement de sortie ; mouvement → opération financière | Achats, ventes, ajustements, pertes, date, quantité, prix de mouvement | Le prix de mouvement ne définit pas une méthode de coût ni une couche consommée par une vente. |
| Ventes et tickets | `commercial_sales`, `commercial_sale_lines` | vente → magasin / unité / client ; ligne → vente ; ligne article → stock ou ligne `SERVICE` sans stock | Nombre de ventes confirmées, lignes, CA des lignes, articles/services vendus | Les lignes ne possèdent pas de coût de revient figé. Les services n'ont pas de catalogue ni de coût direct dans le modèle actuel. |
| Factures et encaissements | `commercial_invoices`, `commercial_invoice_payments`, `finance_commercial_invoice_payment_links` | facture → vente ; paiement → facture, vente, wallet ; paiement → opération financière | Facturé, encaissé, reste à encaisser, paiements confirmés, référence wallet | Le cockpit existant agrège les paiements confirmés, pas une comptabilité de résultat complète. |
| Ventes POS | `create_commerce_cash_sale(jsonb)` et ses lignes | la transaction crée une vente confirmée, une facture payée, un paiement confirmé, une opération financière et un mouvement de stock par article | Ventes comptoir, article + service, encaissement unique, idempotence par référence POS | Le moyen Jèko est visible dans l'interface mais le flux d'encaissement transactionnel Jèko n'est pas activé dans le POS. |
| Remises / transferts de caisse | `commerce_cash_remittances`, `finance_commerce_cash_remittance_links` | remise → magasin, wallet source, wallet destination ; lien explicite à l'opération financière | Montant déclaré/confirmé/annulé, sens source-destination | La table existe ; le cockpit devra afficher la remise comme un transfert, jamais comme une vente ni un coût. |
| Offline | `commerce_pos_offline_receipts` | reçu offline → terminal, session, magasin, caissier, vente/facture/paiement/opération serveur | État `PROCESSED` ou `CONFLICT`, montant, erreur, horodatage, traçabilité | Les reçus sont volontairement protégés en accès direct ; une RPC de lecture paginée sera nécessaire pour le cockpit. |
| Clôtures de caisse | `commerce_pos_cash_session_closures` | clôture → session, terminal, magasin, caissier | théorique, compté, écart, statut `SYNCED` ou `REVIEW_REQUIRED` | Une clôture ne crée ni recette, ni dépense, ni mouvement wallet. C'est un contrôle de caisse. |
| Dépenses ERP historiques | `expenses`, `finance_expense_links`, `finance_operations` | lien historique dépense → opération financière | Montant, date, catégorie et opérations historiques | `expenses` utilise encore `entity_type` + `entity_id` et ne porte pas de clé étrangère explicite vers un magasin. Il ne permet pas d'attribuer fiablement toutes les dépenses à un magasin. |

### Observations de modèle importantes

- `inventory_items` est le référentiel global des articles. Il contient le SKU, le nom, l'unité, le stock global et le seuil, mais **aucun prix d'achat ni prix de vente**.
- `business_location_inventory_items` est le référentiel local de disponibilité. Il contient `quantity`, `sale_price` et `reorder_level`, mais **aucun coût**.
- `stock_movements` possède `unit_price` pour les achats et ventes qui impliquent un wallet. Ce prix est un fait de mouvement, pas une méthode déclarée de valorisation de l'inventaire.
- Une ligne `commercial_sale_lines` est soit `ARTICLE`, soit `SERVICE`. Une ligne de service ne possède ni article, ni mouvement de stock. Son nom et son prix sont actuellement saisis à la vente ; elle ne contient pas de coût de prestation.
- Le client de comptoir est techniquement résolu par le moteur POS sans exiger que le caissier saisisse un client nominatif. Cela permet les ventes anonymes sans introduire un second modèle client.

## 4. Relations qui fondent le futur cockpit

```text
business_unit (COMMERCE)
  └─ business_location (magasin)
       ├─ business_location_assignments → caissier / responsable
       ├─ business_location_wallets → wallets (CASH_DRAWER, COLLECTION, OPERATING)
       ├─ business_location_inventory_items → inventory_items
       │    └─ stock_movements
       ├─ commercial_sales
       │    ├─ commercial_sale_lines (ARTICLE ou SERVICE)
       │    ├─ commercial_invoices
       │    │    └─ commercial_invoice_payments → wallet
       │    │         └─ finance_commercial_invoice_payment_links → finance_operations
       │    └─ commercial_sale_stock_movement_links → stock_movements
       ├─ commerce_cash_remittances → finance_commerce_cash_remittance_links → finance_operations
       ├─ commerce_pos_offline_receipts → vente / facture / paiement / finance_operations
       └─ commerce_pos_cash_session_closures
```

Ce graphe est suffisamment explicite pour les ventes, paiements, achats de stock, remises et contrôles de caisse. En revanche, il manque actuellement un lien relationnel fiable pour les **dépenses opérationnelles du magasin** (loyer, transport, emballage, réparation, internet, etc.).

## 5. Indicateurs calculables dès maintenant

Les indicateurs ci-dessous peuvent être exposés dans un cockpit de lecture sans inventer de donnée, à condition de filtrer par magasin, période, statut et permission côté serveur.

| Indicateur | Formule / source | Statuts à inclure | Niveau de confiance |
|---|---|---|---|
| Tickets / ventes confirmés | nombre de `commercial_sales` du magasin | `CONFIRMED` | Exact |
| Chiffre d'affaires des ventes | somme des `commercial_sale_lines.line_total` des ventes confirmées | vente `CONFIRMED` | Exact pour le prix facturé des lignes |
| Montant encaissé | somme des `commercial_invoice_payments.amount` | paiement `CONFIRMED`, vente `CONFIRMED` | Exact |
| Reste à encaisser | total de facture active − paiements confirmés − éventuels remboursements/corrections applicables | factures non `CANCELLED` | Exact si la formule existante de facture est réutilisée |
| Panier moyen | CA des ventes confirmées ÷ nombre de ventes confirmées, si le dénominateur est non nul | vente `CONFIRMED` | Exact |
| CA articles / CA services | somme des lignes par `line_type` | vente `CONFIRMED` | Exact |
| Quantité en rayon | somme `business_location_inventory_items.quantity` | magasin sélectionné | Exact |
| Articles en rupture / seuil | quantité `<= 0`, ou `0 < quantité <= reorder_level` | magasin sélectionné | Exact |
| Valeur de vente potentielle | somme `quantity × sale_price` lorsque `sale_price` est renseigné | magasin sélectionné | Exact, mais c'est une valeur au prix de vente potentiel, pas un coût |
| Wallet de caisse / wallets associés | solde enregistré des wallets affectés au magasin | mapping actif | Exact pour la trésorerie de ces wallets |
| Achats de stock | somme des mouvements `PURCHASE` valides liés au magasin ; lecture de leur lien financier lorsque autorisée | mouvement `VALID` | Exact comme coût d'approvisionnement sur la période ; ne pas confondre avec le coût des marchandises vendues |
| Remises / transferts | sommes par statut de `commerce_cash_remittances` | `DECLARED`, `CONFIRMED`, `CANCELLED` affichés distinctement | Exact comme flux interne, neutre pour le résultat |
| Écarts de caisse | `counted_cash − server_theoretical_cash` de chaque clôture | `SYNCED`, `REVIEW_REQUIRED` | Exact comme contrôle ; pas comme dépense automatique |
| Synchronisations offline | reçu, conflit, date, montant, message d'erreur contrôlé | `PROCESSED`, `CONFLICT` | Exact |

### Indicateurs à ne pas afficher comme réels aujourd'hui

| Indicateur demandé | Pourquoi il n'est pas fiable avec le modèle actuel |
|---|---|
| Valeur de stock au coût | Il n'existe pas de coût unitaire local persistant, de couche de réception ou de méthode de valorisation validée. |
| Coût des marchandises vendues (CMV/COGS) | Une vente ne conserve pas le coût des unités sorties. Un même article peut avoir plusieurs prix d'achat. |
| Marge brute réalisée par article, service ou période | Elle dépend du CMV et, pour les services, d'un coût de prestation actuellement absent. |
| Marge potentielle fiable | Seul `quantité × prix de vente` est calculable ; la soustraction d'un coût serait arbitraire. |
| Résultat net magasin | Les dépenses opérationnelles ne sont pas reliées explicitement au magasin. |
| Produit/service le plus rentable | Le chiffre d'affaires est disponible, pas le coût réel vendu. |
| Dépenses prévues / résultat prévisionnel | Aucun modèle de dépense prévisionnelle n'existe. |

## 6. Lecture de l'exemple de gestion demandé

L'exemple « stock acheté 450 000 FCFA, valeur de vente 600 000 FCFA, marge potentielle 150 000 FCFA » est valable uniquement si les 450 000 FCFA représentent le coût attribué de façon fiable au stock actuellement disponible. Le système actuel ne peut pas l'affirmer automatiquement après plusieurs achats et ventes.

De même, le résultat mensuel ci-dessous ne doit être affiché qu'après la mise en place du CMV et des dépenses magasin explicites :

```text
Marge brute articles          = CA articles − CMV articles
Marge de services             = CA services − coûts directs des services (si capturés)
Résultat de gestion réalisé   = marge brute articles + marge de services
                                − dépenses opérationnelles magasin confirmées
Résultat prévisionnel         = résultat de gestion réalisé
                                − dépenses magasin prévues non confirmées
```

Les achats de stock ne sont **pas** déduits une deuxième fois du résultat lorsque le CMV est déjà utilisé : l'achat constitue une entrée d'inventaire, tandis que le CMV correspond au coût des unités réellement vendues. Le wallet peut diminuer le jour de l'achat sans que le résultat du mois baisse du même montant.

## 7. État du cockpit Commerce existant

La RPC `get_commerce_management_dashboard(p_location_id)` fournit déjà :

- le magasin Commerce accessible ;
- les ventes confirmées et paiements confirmés du jour, de la semaine et du mois, si l'utilisateur possède `sales.finance.read` ;
- le wallet de caisse primaire, si l'accès financier est autorisé ;
- le nombre d'articles, les ruptures et les seuils bas ;
- les huit dernières ventes confirmées.

Elle vérifie l'authentification, l'accès au point de vente et un droit de pilotage (`locations.manage`, `commerce.stock.receive` ou `sales.finance.read`). Les montants financiers sont volontairement masqués sans `sales.finance.read`.

Cette RPC est une base saine mais elle ne supporte pas encore : période personnalisée, ventilation articles/services, valeur de stock, achats de stock, dépenses magasin, remises de caisse, clôtures, synchronisations offline, transactions paginées ou alertes par magasin.

## 8. Permissions et exposition des données

### Permissions déjà utilisées

| Permission actuelle | Usage observé |
|---|---|
| `commerce.pos.read` | accès au catalogue et à l'espace POS du magasin affecté |
| `commerce.pos.sell` | vente comptoir transactionnelle |
| `commerce.stock.read` / `commerce.stock.receive` | lecture locale du stock / réception et mise en rayon |
| `commerce.cash.read` / `commerce.cash.close` | lecture des flux caisse autorisés / déclaration de remise ou clôture |
| `sales.finance.read` | montants facturés, encaissés, dus et cockpit financier existant |
| `locations.read`, `locations.manage`, `locations.assign`, `locations.wallets.manage` | administration des magasins, affectations et wallets |

### Principe à respecter dans STORE-01

Le rôle de caissier conserve un espace d'encaissement séparé. Il ne doit pas obtenir automatiquement les prix d'achat, la valorisation de stock, la marge, le résultat net ou tous les wallets simplement parce qu'il est affecté à un magasin. Les futurs droits de type `store.*` devront réutiliser le catalogue central de permissions, sans créer un second système de rôles.

## 9. Qualité des données et risques

1. **Valorisation non définie.** Réutiliser le dernier prix d'achat, la moyenne naïve ou le prix de la dernière réception pour calculer une marge serait trompeur.
2. **Historique antérieur.** Les ventes et achats antérieurs à une future politique de coût ne peuvent pas être valorisés rétroactivement sans une décision et un inventaire d'ouverture approuvé.
3. **Dépenses magasin non relationnelles.** La table historique `expenses` est générique et polymorphe ; elle ne permet pas le filtrage magasin requis par les règles du projet.
4. **Trésorerie vs résultat.** Le solde wallet inclut des moments de paiement, des transferts, voire le solde d'ouverture ; il ne doit pas être utilisé comme bénéfice.
5. **Horodatages.** Les ventes utilisent principalement `sale_date` et les paiements `payment_date`, alors que les événements offline possèdent des dates appareil et serveur. Le futur contrat de période doit préciser quel événement est mesuré.
6. **Données partielles.** Une vue doit expliciter « non disponible » pour un coût ou une marge non calculable, et non présenter `0 FCFA`.
7. **Accès financier.** Les agrégats et exports doivent appliquer les mêmes contrôles serveur que les lignes sources ; un masquage React ne suffit pas.

## 10. Décisions métier à obtenir avant l'implémentation financière complète

1. Méthode de coût : FIFO par lot, coût moyen pondéré permanent, ou autre méthode explicitement validée.
2. Date de démarrage : à partir de quelle date une marge est-elle réputée fiable ? Comment valoriser l'inventaire initial de chaque magasin ?
3. Services : faut-il saisir un coût direct optionnel par service, ou afficher seulement le chiffre d'affaires services tant que ce coût n'est pas renseigné ?
4. Dépenses magasin : quelles catégories doivent être imputables (loyer, transport, emballage, salaire magasin, réparation, internet, autres) et qui les confirme ?
5. Dépenses prévues : une dépense planifiée doit-elle pouvoir être révisée/annulée, et qui peut l'approuver avant confirmation ?
6. Remises de caisse : la confirmation Finance correspond-elle toujours à un transfert interne vers un wallet destination, ou peut-elle rester un constat sans transfert ?
7. Période : faut-il appliquer le fuseau métier configuré de l'ERP et des périodes civiles locale/mois calendaire ?

## 11. Recommandation de suite

Passer à STORE-02 en deux sous-étapes cohérentes :

1. **Cockpit de lecture véridique** : étendre la RPC de pilotage existante et l'interface avec les données déjà calculables, des statuts « indisponible » et les liens vers les sources.
2. **Fondation de rentabilité** : après validation des décisions ci-dessus, créer les migrations additives pour les coûts de stock, les dépenses magasin et les prévisions. C'est seulement à ce stade que marge et résultat net peuvent devenir des indicateurs opérationnels fiables.

