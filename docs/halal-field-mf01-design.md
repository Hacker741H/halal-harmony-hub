# MF-01 — HALAL Field : déclarations terrain contrôlées

## Objectif

HALAL Field est l'expérience mobile installable destinée aux agents terrain :
chauffeurs, agents agricoles, commerciaux et magasiniers. Elle utilise les mêmes
utilisateurs, wallets, documents et journal `finance_operations` que le cockpit
web ; aucune base ni comptabilité parallèle n'est créée.

## Décision de trésorerie

Une somme encaissée par un agent n'est pas considérée comme déposée dans un
wallet d'entreprise tant qu'elle n'a pas été confirmée. Chaque agent reçoit un
ou plusieurs **wallets terrain** affectés par Finance : espèces chauffeur,
mobile money commercial, caisse point de vente, par exemple.

Après validation :

| Déclaration | Écriture centrale | Impact wallet |
| --- | --- | --- |
| Recette | `REVENUE` | crédit du wallet terrain |
| Dépense | `EXPENSE` | débit du wallet terrain |
| Versement | `TRANSFER` | débit du wallet terrain et crédit du wallet d'entreprise |

Cette règle rend chaque remise d'espèces traçable sans compter une recette deux
fois. Les soldes sont toujours recalculés par la fonction officielle des
wallets, jamais modifiés par le téléphone.

## Cycle de vie

1. L'agent crée une déclaration dans un rapport quotidien ou hebdomadaire.
2. Elle reste `DRAFT` puis est envoyée `SUBMITTED` avec son montant, son wallet,
   sa date et son justificatif éventuel.
3. Finance ou un responsable autorisé la `CONFIRMED` ou la `REJECTED`.
4. Seule la confirmation crée l'écriture financière centrale et son lien
   explicite. Une seconde confirmation est idempotente.
5. Une correction ne supprime pas l'historique : la déclaration est refusée ou
   annulée selon son état, et une écriture déjà confirmée est corrigée par la
   règle financière existante, jamais par une modification de solde.

## Relations explicites

Les déclarations peuvent être contextualisées, sans champs polymorphes, par des
clés étrangères explicites vers un client, une exploitation, un article de stock
ou un document. Cette première brique ne relie pas directement une déclaration
à une Course : les dépenses et paiements de Courses conservent leurs RPC et
liens financiers dédiés afin d'éviter toute double comptabilisation. Ce lien
pourra être ajouté dans un lot ultérieur, avec une règle de rapprochement métier
validée.

Les justificatifs réutilisent la bibliothèque Documents privée. Les liens
financiers sont conservés dans une table dédiée avec une contrainte d'unicité :
une déclaration terrain ne peut produire qu'une écriture `finance_operations`.

## Permissions visées

- `field.reports.read` : consulter ses rapports et déclarations.
- `field.reports.create` / `field.reports.submit` : préparer et envoyer ses
  propres déclarations.
- `field.reports.review` : consulter l'équipe affectée et refuser une
  déclaration.
- `field.reports.confirm` : confirmer une déclaration et produire l'écriture
  financière centrale.
- `field.wallets.read` : consulter uniquement les wallets terrain affectés.
- `field.wallets.assign` : affecter, depuis HALAL Field, un wallet source ou
  destinataire à un collaborateur. La liste des collaborateurs et des wallets
  est chargée côté serveur seulement après vérification de cette permission ;
  aucune clé d'administration ne transite dans le navigateur.

Les agents ne reçoivent ni `wallets.manage` ni `finance.create`. Les contrôles
sont appliqués dans les RPC PostgreSQL et les politiques RLS, pas seulement par
l'interface.

## Rapport quotidien et hebdomadaire

Un rapport regroupe les déclarations sur une période, mais ses totaux sont
calculés depuis les déclarations. Il expose : recettes, dépenses, versements,
montants en attente de contrôle, montant confirmé et écarts éventuels. Aucun
total financier n'est recopié comme source de vérité.

## Mobile et PWA — extension MF-02

HALAL Field est désormais installable comme PWA. Le service worker ne met en
cache que l'enveloppe de l'application et les ressources statiques déjà
consultées : il ne met jamais en cache ni n'intercepte les requêtes Supabase ou
les mutations métier.

Lorsqu'un agent est hors connexion, il peut enregistrer localement une
**déclaration brouillon** pour un rapport déjà ouvert. Ce brouillon reste dans
le stockage local du téléphone ; il ne crée aucune opération financière, ne
modifie aucun wallet et ne peut pas être soumis ou confirmé hors ligne. Le
retour réseau affiche une synchronisation manuelle. Chaque brouillon porte une
clé UUID client unique et la base refuse de créer deux déclarations pour la
même clé et le même auteur : une reprise après coupure est donc idempotente.

Les appareils terrain restent à protéger par le verrouillage système de
l'utilisateur. Un brouillon local n'est pas un archivage de données ni une
sauvegarde centralisée.

## Hors périmètre MF-01

- géolocalisation et suivi GPS ;
- création de rapport lorsqu'aucune session et aucun rapport existant ne sont
  déjà disponibles localement ;
- synchronisation automatique silencieuse ou confirmation financière hors
  ligne ;
- création automatique de wallets individuels ;
- rapprochement bancaire ;
- intégrations SMS, WhatsApp et paiements externes ;
- modification des flux déjà spécifiques aux factures de Courses, aux ventes
  agricoles et aux ventes de stock.

Ces flux pourront fournir leurs propres déclarations terrain quand leur source
métier sera explicitement reliée, sans contourner leurs RPC existantes.
