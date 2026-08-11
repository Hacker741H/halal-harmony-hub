# POS-UX-04 — Conception de la caisse professionnelle

## Statut et périmètre

Ce document décrit la refonte visuelle et ergonomique proposée pour la caisse Commerce. Il ne modifie ni les règles métier, ni les RPC, ni les wallets, ni les permissions, ni les mouvements de stock. Il sert de référence avant toute implémentation.

L’objectif est de faire évoluer l’écran de vente actuel vers un poste de caisse dense, rapide et lisible sur ordinateur, inspiré de l’efficacité de Sage et UniCenta, tout en conservant les composants et l’identité HALAL ERP.

## Ce qui existe déjà et doit être préservé

- Une caisse n’est accessible qu’à un utilisateur autorisé et affecté à un point de vente.
- Le client est déjà facultatif : une vente comptoir peut être enregistrée sans client nominatif.
- Le wallet n’est pas choisi par le navigateur : la RPC résout le wallet `CASH_DRAWER` principal du magasin.
- Une vente validée met à jour, dans la même transaction existante, le stock, la vente, la facture, le paiement, le journal financier et le solde du wallet.
- Le brouillon local est associé au poste, au magasin et à l’utilisateur. Il est restauré après rechargement et son état est protégé lorsqu’un encaissement est incertain.
- La caisse calcule déjà le montant reçu en espèces et la monnaie à rendre.
- Le paiement Jèko est affiché mais son encaissement transactionnel n’est pas encore activé dans la caisse ; le flux actuel le bloque explicitement afin de ne pas créer de ticket incomplet.

## Données réellement disponibles à l’écran de caisse

| Donnée | Disponible maintenant | Source actuelle | Usage proposé |
| --- | --- | --- | --- |
| Référence article | Oui, via `sku` | `inventory_items.sku` | Recherche et colonne Référence |
| Désignation | Oui | `inventory_items.nom` | Recherche et colonne Désignation |
| Unité | Oui | `inventory_items.unite` | Colonne Unité |
| Stock du magasin | Oui | `business_location_inventory_items.quantity` | Colonne Stock et contrôle de disponibilité |
| Prix de vente magasin | Oui | `business_location_inventory_items.sale_price` | Colonne Prix unitaire et ticket |
| Catégorie | Présente dans l’inventaire global mais non retournée à la caisse | `inventory_items.categorie` | À ne pas afficher tant que la RPC de caisse ne l’expose pas de façon autorisée |
| Code-barres distinct | Non | Aucun champ identifié | Un scanner peut saisir le `sku` existant ; un véritable code-barres demandera une décision de modèle ultérieure |
| Prix d’achat | Non dans les données exposées à la caisse | Saisi lors des réceptions, mais absent du workspace/cataloque POS | Ne pas afficher ni déduire un coût en caisse |
| Remise par ligne | Non | Le brouillon et les lignes de vente ne comportent pas de remise | Ne pas ajouter de contrôle actif sans règle métier et permissions dédiées |
| Taxes | Taux actuel de caisse fixé à zéro | Facture de caisse existante | Afficher uniquement le total à encaisser ; ne pas inventer HT/TVA/TTC |

## Permissions et confidentialité

Le caissier dispose des permissions de lecture et vente de caisse, mais pas de réception ou de gestion de stock. Le prix d’achat ne doit donc jamais être affiché dans son catalogue.

Les fonctions de réception et de catalogue de réapprovisionnement sont réservées à `commerce.stock.receive` et, dans l’interface, à `stocks.manage`. Elles ne constituent pas une permission explicite et réutilisable de lecture du coût d’achat.

La proposition POS-UX-04 conserve donc la règle suivante :

- La caisse ne montre que le prix de vente, la disponibilité et la référence.
- Un futur affichage du coût d’achat nécessitera une permission dédiée, une RPC sécurisée qui ne retourne la donnée qu’aux rôles autorisés, et une décision métier distincte. Ce point est hors périmètre de la refonte UX.

## Wireframe textuel proposé — ordinateur

La fenêtre de caisse utilise la hauteur disponible. La page elle-même ne défile pas en usage desktop normal ; seuls le tableau du ticket et le catalogue défilent lorsque leur contenu dépasse l’espace disponible.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ TICKET POS-… · Magasin / point de vente · Caissier · Client comptoir · Date / heure          │
│ Réf. ticket / vente                                                    TOTAL À ENCAISSER       │
│                                                                         12 500 FCFA             │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ [ Référence / nom / SKU / scanner ................................ ] [Qté] [Ajouter] [Articles]│
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Référence       Désignation              PU          Qté       Montant     Actions            │
│ CHG-USB-C       Chargeur USB-C           500 FCFA    − 2 +     1 000 FCFA  retirer             │
│ ...                                                                                        ↕    │
│                                                                                                  │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Client comptoir [Ajouter un client] · Paiement [Espèces] [Jèko*] [Carte*] [Autre*]            │
│ Wallet de caisse : MAGASIN TETIDOU (automatique, non modifiable par le caissier)              │
│ Montant reçu [____________]  Monnaie à rendre : 500 FCFA          [ENCAISSER 12 500 FCFA]      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

`*` Un moyen est affichable uniquement s’il correspond à un flux réellement supporté. Dans l’état actuel, Jèko ne doit pas permettre de finaliser un ticket tant que son encaissement POS transactionnel n’est pas connecté. Wave direct ne doit pas être présenté comme disponible : si une transaction passe par Jèko, son libellé doit être Jèko, pas Wave.

### Zone 1 — Bandeau ticket compact

- Pas de hero, de cartes marketing ou de catalogue en tuiles.
- Affiche le point de vente, le caissier connecté, le client éventuellement choisi, la date/heure locale et la référence technique du brouillon/ticket.
- Le total est toujours visible, en grand, mais sans masquer le travail de saisie.
- Aucun total de taxe ne sera ajouté : la caisse actuelle ne calcule pas de taxe distincte.

### Zone 2 — Saisie express

- Champ principal autofocus : recherche par nom ou `sku`.
- Il accepte naturellement les scanners qui se comportent comme un clavier et transmettent une référence existante suivie d’Entrée.
- Le champ quantité reste compact et vaut `1` par défaut.
- Entrée ajoute le résultat unique ou validé ; le focus retourne aussitôt au champ de référence.
- Le bouton `Articles` ouvre le catalogue détaillé, sans transformer l’écran principal en grille e-commerce.

### Zone 3 — Ticket central

- Table dense avec en-tête fixe.
- Colonnes : Référence, Désignation, Prix unitaire de vente, Quantité, Montant, Actions.
- La ligne sélectionnée est visuellement identifiable, sans reposer uniquement sur la couleur.
- Les boutons `−` et `+` conservent les contrôles actuels de disponibilité.
- La suppression d’une ligne n’annule pas une vente déjà validée : elle ne concerne que le brouillon avant encaissement.
- L’édition libre du prix n’est pas recommandée dans cette phase : le comportement actuel le permet, mais aucune permission distincte de remise ou de modification de prix n’existe. La décision doit être validée avant de conserver ou de restreindre ce contrôle.

### Zone 4 — Barre de règlement fixe

- Barre horizontale compacte en bas de l’espace desktop ; elle ne défile pas.
- Vente comptoir par défaut, avec l’action secondaire `Ajouter un client` pour un ticket nominatif.
- Le wallet de caisse est affiché comme destination automatique. Il est informatif et non sélectionnable par le caissier, conformément à la protection serveur existante.
- Pour les espèces : montant reçu, monnaie calculée, bouton principal `Encaisser`.
- Un ticket ne peut pas être finalisé si le stock a changé, si le wallet de caisse est absent ou si le montant espèces est insuffisant ; ces contrôles existent déjà et restent visibles.

## Catalogue « Articles / Stock »

Le catalogue est proposé comme un grand `Dialog` sur ordinateur et comme un `Drawer` sur tablette/mobile. Il reste une interface de consultation et d’ajout au ticket, pas une seconde caisse.

```text
┌────────────────────────────── Articles disponibles — MAGASIN X ──────────────────────────────┐
│ [Rechercher référence, désignation ou SKU] [Catégorie : indisponible dans le flux actuel] [×] │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Référence        Désignation                     Prix de vente       Stock      Unité          │
│ CHG-USB-C        Chargeur USB-C                  500 FCFA            4          pièce          │
│ ...                                                                                       ↕    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Recherche instantanée côté interface parmi les articles déjà chargés pour le magasin.
- Clavier : flèches haut/bas pour sélectionner, Entrée pour ajouter, Échap pour fermer.
- Double-clic ou clic sur une ligne ajoute l’article puis rend le focus à la saisie express.
- Catégorie et code-barres ne doivent pas être simulés : ils ne seront proposés dans cette fenêtre que lorsqu’ils seront réellement fournis par un flux autorisé.
- Le prix d’achat n’est jamais affiché dans ce catalogue pour une session caisse.

## Raccourcis clavier proposés

| Raccourci | Proposition | État au regard du modèle actuel |
| --- | --- | --- |
| `F2` | Ouvrir/focus saisie d’article | Réalisable en UX |
| `F3` | Ajouter un service | Non activable : aucune ligne de service ni règle comptable dédiée n’existe |
| `F4` | Ouvrir l’ajout facultatif de client | Réalisable en UX |
| `F6` | Focus zone paiement | Réalisable en UX |
| `F8` | Mettre le ticket en attente | À reporter à POS-03 : un seul brouillon local est actuellement pris en charge |
| `F9` | Reprendre un ticket | À reporter à POS-03 : aucune liste de tickets suspendus n’existe encore |
| `F10` | Encaisser | Réalisable en UX, en appelant exactement le flux existant |
| `Échap` | Fermer le catalogue/dialogue ou annuler l’action en cours | Réalisable en UX |

## Service sans stock

Une ligne de service ne doit pas être ajoutée par simple interface : le moteur actuel exige une ligne liée à un article de stock, décrémente son stock et produit son mouvement lié.

Pour proposer plus tard un service sans stock de manière sûre, il faudra décider et implémenter séparément :

1. le modèle d’une ligne commerciale sans `inventory_item_id` ;
2. les règles de facturation et de journalisation associées ;
3. les permissions de création/modification du prix ;
4. la règle qui garantit l’absence de mouvement de stock ;
5. les rapports et annulations associés.

Cette capacité est hors périmètre de POS-UX-04.

## Compatibilité POS-03 et continuité de session

La refonte ne doit pas remplacer `useCommercePosSession`, ni changer sa clé locale, son schéma ou ses protections d’encaissement. À maintenir :

- restauration du brouillon après rechargement ;
- confirmation avant abandon ou changement de magasin avec panier non vide ;
- blocage de l’encaissement lorsque la réponse précédente est incertaine ;
- réconciliation obligatoire avant une nouvelle tentative ;
- contrôle du stock live avant validation.

POS-03 n’est pas encore un système offline-first complet : il n’y a ni file de synchronisation IndexedDB, ni tickets suspendus multiples, ni synchronisation différée d’encaissements. Cette refonte ne doit pas laisser croire le contraire.

## Responsive et accessibilité

### Desktop

- Poste de travail dense, sans scroll de page pendant l’encaissement.
- Seules les listes de lignes ticket et de catalogue ont un défilement interne.
- La barre de règlement reste fixée à la base de l’espace de travail.

### Tablette

- Table ticket horizontalement compacte, catalogue dans un drawer.
- Barre de règlement conservée en bas ; les libellés secondaires peuvent être condensés.

### Mobile

- L’écran peut adopter une séquence plus simple : recherche et ticket, puis drawer de règlement.
- Le même brouillon, les mêmes contrôles de stock et le même wallet automatique sont conservés.

### Accessibilité

- Tous les boutons iconiques reçoivent un nom accessible.
- L’état sélectionné, l’erreur de stock et le bouton indisponible reposent sur un texte, un état ARIA et une couleur contrastée.
- Les raccourcis ne doivent pas intercepter la saisie dans un champ de texte lorsque cela gêne la frappe.
- Le focus reste visible après chaque ajout et après chaque fermeture de dialogue.

## Composants réutilisables à privilégier

- `Button`, `Input`, `Select`, `Dialog`, `Drawer`, `DataTable`, `ScrollArea`, `Skeleton`, `AlertDialog` et `Card` existants.
- `ClientSelect` existant pour le client facultatif.
- `useCommercePosSession` et les fonctions de stock-conflit existantes.
- Les composants spécifiques proposés, s’ils sont créés après validation, doivent rester limités au dossier Commerce : `PosTicketHeader`, `PosQuickEntry`, `PosTicketTable`, `PosCatalogueDialog` et `PosSettlementBar`.

## Fichiers susceptibles d’être modifiés après validation

| Fichier | Rôle prévu |
| --- | --- |
| `src/components/commerce/commerce-pos-workspace.tsx` | Réorganisation visuelle de la caisse sans modifier les appels métier existants |
| `src/components/commerce/pos-*.tsx` éventuels | Extraction de sous-composants strictement visuels si la taille du composant principal le justifie |
| `src/hooks/use-commerce-pos-session.ts` | Aucun changement prévu ; seulement vérification de compatibilité |
| `src/lib/commerce-pos.functions.ts` | Aucun changement prévu |

Ne sont pas prévus : migrations, RPC, changements de permissions, logique Finance/Wallet, règles de stock, routes ou intégration Jèko.

## Limites et décisions à confirmer avant la phase d’implémentation

1. Conserver ou restreindre l’édition libre du prix de vente dans le panier : elle existe aujourd’hui, mais aucun contrôle de remise n’est modélisé.
2. Le vrai code-barres nécessite-t-il un nouveau champ, ou le `sku` peut-il servir de référence scannée ?
3. Les services sans stock doivent-ils faire l’objet d’un lot fonctionnel et financier distinct ?
4. Les tickets suspendus multiples seront-ils priorisés dans POS-03 avant de rendre actifs `F8` et `F9` ?
5. Les moyens de paiement à afficher doivent-ils se limiter à Espèces jusqu’à ce que Jèko soit réellement déclenchable depuis le point de vente ?

## Critères d’acceptation de la future implémentation UX

- Le caissier ouvre un poste compact sans hero ni catalogue e-commerce.
- Une référence existante peut être ajoutée au ticket au clavier et le focus revient à la saisie.
- Le total, le paiement espèces, la monnaie et l’action d’encaissement restent visibles sans faire défiler la page sur desktop.
- Le wallet affiché est le wallet de caisse automatique déjà résolu côté serveur.
- La vente comptoir ne demande pas de client ; un client peut être ajouté volontairement.
- Aucun prix d’achat, taxe, catégorie, code-barres, remise ou service fictif n’est affiché comme s’il était pris en charge.
- Le panier existant survit au rechargement et ne perd aucune protection POS-02/POS-03 existante.
