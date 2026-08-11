# Architecture cible de caisse hors connexion

## État actuel

Le poste de caisse conserve déjà le brouillon en cours et les tickets suspendus dans le stockage local du navigateur, isolés par point de vente et par caissier. Cette persistance protège une vente contre un rechargement ou un changement de taille d'écran, mais elle ne transforme pas encore une vente en vente hors connexion.

L'encaissement confirmé reste aujourd'hui en ligne : la RPC `create_commerce_cash_sale` crée, dans une transaction serveur unique, la vente, la facture, le paiement, l'opération de `finance_operations`, le lien financier et le recalcul du wallet. Cette règle reste indispensable.

## Objectif du futur mode offline-first

Sans réseau, un caissier doit pouvoir consulter un catalogue local, préparer des articles ou services, suspendre/reprendre un ticket et enregistrer une vente en espèces. Dès le retour du réseau, les opérations sont synchronisées automatiquement, une seule fois, sans déclaration manuelle.

Les paiements électroniques (Jèko, Wave, carte) restent désactivés hors ligne : leur confirmation doit provenir du prestataire. Le mode hors ligne ne doit jamais afficher une fausse réussite de paiement électronique.

## Stockage local durable

La cible est IndexedDB, et non `localStorage`, avec quatre ensembles distincts :

- `catalogue_snapshot` : articles autorisés au point de vente, prix de vente, stock connu, date et version de synchronisation ;
- `tickets` : brouillons et tickets suspendus ;
- `outbox` : opérations à transmettre au serveur ;
- `sync_runs` : diagnostic local minimal de la dernière synchronisation.

Chaque ticket et chaque opération d'outbox possède un UUID créé côté client avant toute tentative réseau. Cet UUID devient la clé d'idempotence envoyée au moteur POS existant. Aucun montant de wallet, aucune écriture financière et aucun solde ne sont calculés ou écrits localement comme source de vérité.

## États d'une opération d'outbox

`PENDING` → `SYNCING` → `SYNCED` ou `ERROR`.

Une opération `ERROR` conserve le message utile et peut être réessayée automatiquement avec un délai progressif. Une réponse inconnue après envoi n'autorise jamais la caisse à créer un nouveau ticket : elle redemande le même UUID au serveur. Le serveur retourne alors le reçu existant ou applique une seule transaction, grâce à l'idempotence déjà présente du POS.

## Synchronisation

Le client écoute les événements `online` et `offline`, puis lance une synchronisation au démarrage, au retour du réseau et à intervalles limités. Une seule synchronisation est autorisée par poste à la fois.

1. Télécharger le catalogue et son horodatage pour le point de vente.
2. Trier l'outbox dans l'ordre de création.
3. Envoyer une vente espèces avec son UUID d'origine.
4. Laisser la RPC existante valider stock, permission, vente, facture, paiement, `finance_operations` et wallet dans sa transaction.
5. Marquer l'opération locale `SYNCED` seulement après réception du reçu serveur.
6. Rafraîchir le catalogue et les stocks locaux.

Une clôture de caisse réalisée hors ligne est seulement **provisoire**. Elle est placée dans l'outbox et devient définitive uniquement après validation serveur.

## Réconciliation du stock

Le stock affiché hors ligne est un instantané, pas une réservation mondiale. Deux caisses hors ligne peuvent vendre simultanément le même article ; aucune interface ne doit prétendre garantir le stock temps réel dans ce cas.

Au retour du réseau, le serveur reste l'arbitre :

- si le stock est suffisant, la vente est confirmée une fois ;
- s'il ne l'est plus, l'opération passe à `ERROR` sans mouvement financier ni déduction de stock ;
- un responsable corrige ou arbitre l'écart selon une procédure de stock existante ;
- le caissier voit une explication claire, sans pouvoir forcer une écriture financière.

Les services ne créent jamais de conflit de stock : ils suivent néanmoins la même transaction de vente, facture, paiement et finance au moment de la synchronisation.

## Sécurité et audit

Les données IndexedDB sont un cache de travail sur un terminal identifié, jamais une preuve comptable. Le serveur vérifie toujours l'utilisateur, son affectation au point de vente, ses permissions, le wallet de caisse et les quantités réellement disponibles. Les clés API et secrets ne sont jamais stockés dans le navigateur.

La comptabilité reste exclusivement produite par le moteur serveur : aucun code offline ne peut insérer directement dans `finance_operations`, `wallets`, les paiements ou les mouvements de stock.

## Mise en œuvre future par étapes

1. Ajouter le cache IndexedDB versionné et le téléchargement de catalogue.
2. Ajouter l'outbox espèces avec UUID et reprise après coupure.
3. Ajouter l'écran de synchronisation et les erreurs de réconciliation.
4. Ajouter les clôtures provisoires puis leur confirmation serveur.
5. Tester les conflits de deux caisses et les scénarios de réponse réseau inconnue.

Le déploiement devra commencer sur un magasin pilote, avec une procédure de retour au mode en ligne et un contrôle quotidien des écarts de caisse.
