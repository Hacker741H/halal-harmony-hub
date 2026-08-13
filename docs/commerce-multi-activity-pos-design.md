# CM-01 — Commerce multi-activité et caisse magasin

Date : 10 août 2026
Statut : conception prête à être découpée en lots. Ce document n’applique aucune migration et ne modifie aucune donnée.

## 1. Décision d’architecture

HALAL ERP reste **une seule plateforme** et un seul journal financier (`finance_operations`). Il ne faut pas créer une application Transport, une application Agriculture et une application Magasin séparées.

Les activités sont isolées par leur contexte métier :

| Niveau | Exemples | Utilité |
| --- | --- | --- |
| Activité | Transport, Commerce, Agriculture, Autres | Séparer les résultats et les droits de lecture. |
| Point d’exploitation | Magasin accessoires & sacs, dépôt transport, ferme | Situer une vente, un stock ou une caisse. |
| Wallet | Caisse magasin, Wave Commerce, Jèko, banque principale | Représenter l’endroit réel où se trouve l’argent. |
| Utilisateur | Caissier, responsable magasin, stock, finance | Tracer qui a effectué chaque action. |

Un wallet peut rester partagé entre plusieurs activités lorsque c’est réellement le même compte bancaire ou mobile money. Il ne faut donc pas lui attribuer arbitrairement une seule activité : chaque écriture garde son origine et les rapports filtrent cette origine.

## 2. Ce qui existe déjà et sera réutilisé

Le magasin ne repart pas de zéro :

- `inventory_items` est le référentiel des articles ; il peut contenir les accessoires téléphones, sacs et leurs seuils.
- `stock_movements` et les RPC de stock contrôlent les entrées, sorties, achats, ajustements et annulations.
- `commercial_sales`, `commercial_sale_lines`, `commercial_invoices` et `commercial_invoice_payments` gèrent déjà la vente, la facture, le paiement partiel, le surpaiement bloqué et les annulations traçables.
- `transport_clients` est déjà le référentiel client commun malgré son nom historique ; aucun second fichier Clients ne doit être créé.
- `finance_operations` reste le seul journal de trésorerie ; un paiement commercial confirmé y crée une unique recette liée.
- Les wallets, affectations terrain et HALAL Field permettent déjà une caisse mobile ou une caisse attribuée à un collaborateur.
- Jèko peut déjà créer un encaissement de facture commerciale sans exposer de clé dans l’interface.

## 3. Écarts constatés avant d’ouvrir le magasin

La fondation commerciale actuelle est adaptée à une vente préparée puis facturée. Pour une caisse magasin rapide, quatre manques doivent être traités sans contourner les mécanismes existants :

1. une vente n’est pas encore portée par un **point de vente ERP** explicite ;
2. le formulaire actuel peut créer des lignes libres : il ne sélectionne pas encore systématiquement un article et ne renseigne donc pas toujours `inventory_item_id` ;
3. le stock actuel est global : il n’existe pas encore de solde par magasin ou par réserve ;
4. il n’existe pas encore de **session de caisse** permettant de rapprocher le fond de caisse, les ventes, les dépenses autorisées, le versement de fin de journée et l’écart éventuel.

Ces écarts expliquent pourquoi il ne faut pas simplement transformer l’écran « Ventes » actuel en écran de caisse : cela risquerait de créer des sorties de stock ou des recettes en double.

## 4. Parcours opérationnel cible

### 4.1 Achat fournisseur et entrée de stock

```text
Commande / réception fournisseur
        ↓
Entrée physique dans le stock du magasin ou de la réserve
        ↓
Facture ou dette fournisseur (si applicable)
        ↓
Paiement confirmé depuis un wallet
        ↓
Dépense unique dans finance_operations
```

Une réception gratuite ou un ajustement de quantité n’est pas automatiquement une dépense. Un achat fournisseur est une dépense seulement lorsqu’un décaissement réel est confirmé.

### 4.2 Vente comptant au comptoir

```text
Article(s) scanné(s) ou sélectionné(s)
        ↓
Ticket de vente lié au magasin et au caissier
        ↓
Sortie physique de stock unique
        ↓
Paiement confirmé (espèces, Wave, Jèko…)
        ↓
Recette unique dans finance_operations et crédit du wallet choisi
```

Une vente enregistrée n’est pas forcément encaissée. Pour une vente à crédit, le cycle existant est conservé : vente → facture → paiement(s) confirmé(s). Une vente comptant peut combiner ces étapes dans une interface plus rapide, mais les RPC métier continuent à protéger chaque étape.

### 4.3 Fin de journée du caissier

```text
Ouverture de caisse
        ↓
Ventes et dépenses autorisées de la session
        ↓
Comptage réel par le caissier
        ↓
Écart expliqué si nécessaire
        ↓
Versement de la caisse vers Wallet principal / Wave
        ↓
Transfert interne, jamais une nouvelle recette
```

Le versement ne constitue jamais un bénéfice et ne doit pas être compté deux fois : la recette existe déjà dans le wallet de caisse ; le versement est seulement un transfert vers le wallet de destination.

## 5. Indicateurs à afficher sans confusion

| Indicateur | Formule / source | Ne signifie pas |
| --- | --- | --- |
| Chiffre d’affaires encaissé | Paiements commerciaux confirmés sur la période | Le bénéfice. |
| Créances clients | Facturé − encaissé | L’argent disponible. |
| Coût des marchandises vendues | Coût des articles réellement sortis, selon une méthode de coût validée | Toutes les dépenses du magasin. |
| Marge brute | Ventes nettes − coût des marchandises vendues | Le résultat final. |
| Dépenses du magasin | Dépenses explicitement rattachées au magasin | Le coût des marchandises vendues, sauf règle décidée. |
| Résultat de gestion | Marge brute − dépenses du magasin explicitement rattachées | Un bilan comptable légal. |
| Solde de caisse | Wallet de caisse et opérations réellement liées | Le total de toutes les ventes du groupe. |

Le coût des marchandises vendues exige un choix métier avant implémentation : coût moyen pondéré (recommandé pour démarrer) ou FIFO. Aucun prix d’achat ne doit être deviné à partir du prix de vente.

## 6. Modèle à introduire progressivement

### CM-02 — Activités et points d’exploitation

Ajouter un référentiel explicite, sans dupliquer les entités existantes :

- `business_units` : `TRANSPORT`, `COMMERCE`, `AGRICULTURE`, `OTHER` ;
- `business_locations` : magasins, dépôts et sites opérationnels, reliés à une activité ;
- relations explicites pour les wallets autorisés par site et les collaborateurs affectés au site ;
- `commercial_sales.business_unit_id` et `commercial_sales.location_id` pour les nouvelles ventes de magasin.

Les Courses et les Fermes existantes ne seront pas rétro-migrées dans ce premier lot. Leurs rapports continuent à utiliser leurs liens actuels, puis une stratégie de rapprochement sera définie séparément.

### CM-03 — Stocks par emplacement et achats fournisseurs

- l’article maître reste `inventory_items` ;
- les quantités par magasin/réserve deviennent des mouvements et des soldes calculés par emplacement ;
- les transferts entre réserve et magasin restent physiques, sans recette ni dépense ;
- une entrée fournisseur conserve le fournisseur, le coût unitaire réel, le document éventuel et le lien financier lorsqu’elle est payée ;
- aucun retrait du stock global historique n’est effectué sans backfill contrôlé.

### CM-04 — Caisse magasin / poste caissier

- session d’ouverture et de clôture ;
- ticket de vente rapide à partir des articles réellement en stock ;
- caisse ou wallet déterminé par l’affectation du caissier ;
- ventes comptant, crédit client et encaissement Jèko distingués ;
- transfert de remise de caisse contrôlé ;
- annulation/retour avec sortie inverse et contre-écriture lorsque nécessaire.

### CM-05 — Pilotage Commerce

- ventes, marge, dépenses, créances, stock faible et écarts de caisse ;
- filtres activité, magasin, caissier, wallet et période ;
- export réservé aux rôles autorisés ;
- drill-down vers le ticket, l’article, le paiement et l’écriture financière source.

### CM-06 — Poste installé pour les caissiers

HALAL Field / PWA est le bon support initial : installation depuis Chrome/Edge, raccourci bureau, session limitée au magasin affecté et interface caisse simplifiée. Il ne faut pas créer une application native distincte tant que la PWA répond aux besoins.

Le mode hors ligne devra rester prudent : brouillons locaux possibles, mais aucune vente confirmée, aucune sortie de stock et aucune opération financière ne sont validées sans connexion serveur.

## 7. Rôles proposés

| Rôle | Autorisé | Interdit par défaut |
| --- | --- | --- |
| Caissier | Vendre dans son magasin, consulter son stock disponible, ouvrir/fermer sa caisse, demander une remise de caisse | Modifier les prix, voir les coûts, annuler un paiement confirmé, gérer les wallets globaux. |
| Responsable magasin | Valider ajustements encadrés, retours, clôtures et écarts de son magasin | Gérer les comptes bancaires et les paramètres globaux. |
| Stocks | Réceptions, transferts, inventaires et seuils | Accéder aux salaires ou à la trésorerie globale. |
| Finance | Confirmer les paiements, dépenses, transferts et rapprochements | Modifier les quantités de stock sans mouvement tracé. |
| Administrateur | Dérogations, affectations, paramètres et audits | Aucune action non auditée. |

Les permissions exactes seront ajoutées dans une migration dédiée. Le filtrage dans l’interface ne suffira pas : les RPC et la RLS devront limiter les magasins, caisses et données financières accessibles au caissier connecté.

## 8. Décisions métier à valider avant CM-02

1. Nom du premier point de vente : par défaut proposé **« Magasin accessoires & sacs »**.
2. Le magasin possède-t-il une réserve distincte, ou tout le stock est-il vendu depuis le même emplacement ?
3. Les caissiers peuvent-ils consentir une remise ou modifier un prix ? Recommandation : non, sauf autorisation enregistrée.
4. Les ventes à crédit sont-elles autorisées au comptoir ? Recommandation : oui, uniquement avec un client sélectionné et une limite de crédit future.
5. Méthode de coût retenue pour la marge : coût moyen pondéré recommandé ; FIFO seulement si la rotation et la traçabilité fournisseur le justifient.
6. Le caissier remet-il ses espèces chaque jour, par semaine, ou selon un seuil ?
7. Le wallet « caisse magasin » est-il distinct du wallet Wave/Jèko, ou les encaissements sont-ils réglés directement vers Wave/Jèko ?

## 9. Garanties non négociables

- jamais de modification directe de `wallets.balance` ;
- une confirmation de paiement crée au plus une écriture financière liée ;
- un versement de caisse est un `TRANSFER`, pas une `REVENUE` ;
- une sortie de stock ne crée pas automatiquement une recette ;
- aucun montant de marge ou de bénéfice n’est stocké comme valeur saisissable ;
- toute annulation conserve l’historique et utilise une correction/contre-écriture lorsque l’argent a déjà circulé ;
- pas de second référentiel client, article, finance ou authentification ;
- aucune donnée de Transport, Agriculture ou Commerce ne devient visible à un caissier hors de son périmètre.

## 10. Recommandation de démarrage

Commencer par **CM-02 : Activités et points d’exploitation**, puis créer le premier emplacement « Magasin accessoires & sacs ». Cette étape rendra les futures ventes, les wallets affectés et les rapports lisibles par activité sans déstabiliser les Courses, l’Agriculture ou la Finance existantes.

Avant toute migration : audit SQL du stock et des wallets réels, test de la règle de coût choisie, puis création d’une migration additive et d’un script de réconciliation avec `ROLLBACK`.
