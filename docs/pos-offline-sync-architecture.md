# POS-04B — Synchronisation fiable des ventes hors connexion

## Portée

POS-04B traite uniquement les ventes **en espèces** déjà enregistrées localement par le poste de caisse. Une vente hors connexion ne crée ni facture, ni paiement, ni écriture financière avant sa réception par le serveur.

Jèko, Wave, les cartes et les autres moyens électroniques restent en ligne uniquement. Ils ne peuvent donc jamais être déclarés comme encaissés hors connexion.

## Flux unique

```text
Poste hors connexion
  → IndexedDB : ticket + outbox durable PENDING
  → retour du réseau
  → sync_commerce_pos_offline_sale
  → create_commerce_cash_sale (moteur existant)
  → vente + facture + paiement + finance_operations + wallet + stock + audit
```

`sync_commerce_pos_offline_sale` ne crée pas d'écriture financière directement. Après ses contrôles, elle délègue obligatoirement à `create_commerce_cash_sale`, le moteur de caisse déjà utilisé en ligne.

## Réception et idempotence

La migration ajoute `commerce_pos_offline_receipts`.

- `offline_sale_id` est unique et stable, créé sur le terminal lors de la vente.
- Un verrou transactionnel PostgreSQL sérialise les tentatives concurrentes pour le même ticket.
- Si la réponse réseau se perd après le traitement serveur, une nouvelle tentative renvoie le même reçu, la même vente, le même paiement et la même opération financière.
- Le navigateur conserve la preuve de synchronisation (`receiptId`, vente, facture, paiement et opération) au lieu de supprimer immédiatement son événement local.

Les statuts visibles côté poste sont : `PENDING`, `SYNCING`, `SYNCED`, `FAILED` et `CONFLICT`.

## Contrôles serveur

Avant toute délégation, la RPC vérifie :

- utilisateur authentifié et permission `commerce.pos.sell` ;
- accès du caissier au point de vente ;
- identifiants stables du terminal, de la session locale et du ticket ;
- paiement `CASH` uniquement ;
- nombre, type, quantité et prix des lignes ;
- total, montant reçu et monnaie rendue ;
- disponibilité actuelle des articles dans le magasin ;
- existence du wallet principal configuré, via le moteur POS existant.

La RPC est `SECURITY DEFINER` avec un `search_path` explicite. Elle est interdite à `anon`, les reçus ne sont pas accessibles directement aux utilisateurs applicatifs et aucun secret n'est enregistré dans IndexedDB.

Le terminal est aujourd'hui un identifiant persistant par navigateur, conservé pour l'audit. L'autorisation serveur repose sur le compte authentifié et son affectation au magasin. Une liste d'appareils administrativement approuvés n'existe pas encore ; elle constitue un futur durcissement, sans réduire les contrôles actuels de rôle et de magasin.

## Prix et stock

Le prix capturé au moment de l'encaissement est conservé : le serveur ne le remplace jamais silencieusement par un nouveau tarif. Lorsqu'un prix catalogue a changé, la divergence est écrite dans le reçu et dans l'audit de la synchronisation.

Si le stock serveur ne couvre plus une vente déjà saisie hors connexion, le ticket devient `CONFLICT` (`STOCK_CONFLICT`). Aucun wallet, paiement ni `finance_operations` n'est alors créé. Le ticket ne disparaît pas : il reste auditable et doit être résolu par un responsable selon une règle métier ultérieure (ajustement de stock, correction du ticket ou décision de vente exceptionnelle). Cette approche évite de créer silencieusement du stock négatif ou une recette non justifiée.

Après un reçu `SYNCED`, le poste réconcilie son cache de stock pour ne pas soustraire une seconde fois les articles au prochain rafraîchissement serveur.

## Synchronisation automatique

Le moteur démarre :

1. à l'ouverture de la caisse lorsque le navigateur est en ligne ;
2. à l'événement navigateur `online` ;
3. juste après une vente locale si le réseau est revenu ;
4. toutes les 30 secondes tant que des éléments sont en attente.

Un verrou en mémoire évite deux synchronisations parallèles sur le même poste. PostgreSQL reste la garantie définitive contre les doublons. Les erreurs temporaires utilisent un délai exponentiel plafonné à cinq minutes ; les erreurs de validation, de permission ou de référence sont marquées permanentes et ne sont pas relancées en boucle.

## Clôture de caisse

POS-04B ne remet jamais un wallet à zéro. Une clôture est une future remise de caisse : elle devra fermer une **session de caisse**, déclarer le montant physiquement compté et être confirmée par un rôle autorisé. Le wallet restera calculé exclusivement depuis les écritures financières. Cette fonction relève de POS-04C, après validation POS-04B.

## Validation

- `scripts/test-commerce-pos-offline.ts` vérifie le socle IndexedDB de POS-04A.
- `scripts/test-commerce-pos-offline-sync.ts` simule la reconnexion, la réponse perdue, le reçu idempotent et le conflit local.
- `scripts/test-commerce-pos-offline-sync.sql` vérifiera le flux transactionnel complet après application contrôlée de la migration sur Supabase.

Avant toute validation distante, appliquer uniquement :

```powershell
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase db query --linked --file scripts/test-commerce-pos-offline-sync.sql
```

La migration `20260811160000_add_commerce_pos_offline_sync.sql` n'est pas appliquée automatiquement par POS-04B.
