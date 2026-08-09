# Connecteur de paiement Jèko

## Périmètre

Cette intégration est une couche technique isolée. Elle ne crée aucune écriture dans `finance_operations` directement. Un encaissement Jèko confirmé devient un paiement de facture de Course, puis le moteur de paiement de Course existant crée l’écriture financière liée et recalcule le wallet.

Les virements Jèko sont préparés au niveau du provider, mais ne sont volontairement pas reliés à une interface ou à un flux ERP dans cette version.

## Architecture

```text
Serveur ERP → JekoProvider → API Jèko
                               ↓
                     webhook signé Jèko
                               ↓
                 Edge Function jeko-webhook
                               ↓
                  payment_events (idempotence)
                               ↓
          process_jeko_payment_event (service_role)
                               ↓
   moteur existant de paiement de Course → finance_operations → wallet
```

Les fichiers applicatifs sont sous `src/lib/payments/` :

- `payment.types.ts` : contrat indépendant de tout prestataire ;
- `payment-provider.ts` : point d’export de l’abstraction ;
- `jeko.provider.ts` : appels HTTP Jèko centralisés ;
- `payment.events.ts` : validation du payload et HMAC SHA-256 ;
- `jeko-course-payments.functions.ts` : Server Functions qui créent le lien de paiement et configurent le magasin Jèko vers un wallet ERP ;
- `supabase/functions/jeko-webhook/index.ts` : réception du webhook.

Le `PaymentProvider` expose `createPayment`, `getPayment`, `createTransfer`, `verifyWebhook` et `cancelPayment`. Jèko ne documente pas une annulation de demande de paiement : `cancelPayment` retourne donc l’erreur typée `PAYMENT_OPERATION_NOT_SUPPORTED` et n’appelle aucun endpoint fictif.

## Variables serveur

Définir ces variables uniquement dans l’environnement serveur TanStack Start et dans les secrets des Edge Functions Supabase :

| Variable | Usage | Secret |
| --- | --- | --- |
| `JEKO_API_KEY` | En-tête `X-API-KEY` de l’API Jèko | Oui |
| `JEKO_API_KEY_ID` | En-tête `X-API-KEY-ID` requis par Jèko | Configuration confidentielle, serveur uniquement |
| `JEKO_WEBHOOK_SECRET` | Calcul HMAC-SHA256 du webhook | Oui |
| `JEKO_BASE_URL` | Base API, normalement `https://api.jeko.africa` | Non |

`JEKO_WEBHOOK_SECRET` est requis dans les secrets de l’Edge Function Supabase. Les trois variables nécessaires aux appels sortants (`JEKO_API_KEY`, `JEKO_API_KEY_ID`, `JEKO_BASE_URL`) doivent aussi être définies dans les variables **serveur** du déploiement TanStack Start/Vercel. Elles ne doivent jamais avoir de préfixe `VITE_`, apparaître dans un log ou être commitées.

## Encaissement depuis une facture de Course

Sur une facture `Émise` ou `Partiellement payée`, un utilisateur possédant `missions.payments` peut sélectionner **Payer avec Jèko**. Le flux est le suivant :

1. Un administrateur associe une fois un magasin Jèko au wallet ERP de destination. Cette action demande `settings.manage` et est auditée.
2. Le serveur vérifie la facture, le reste à encaisser, le magasin, le wallet et la devise XOF.
3. Il crée la demande Jèko avec la référence exacte de la facture, puis l’enregistre immédiatement via `register_jeko_payment_request`.
4. L’utilisateur ouvre le lien Jèko. Aucun wallet ne bouge à cette étape.
5. Le webhook signé confirme le paiement : le bridge existant crée et confirme exactement un paiement ERP, puis le moteur financier existant crée l’opération et crédite le wallet lié.

Le paiement manuel demeure disponible. Ne pas enregistrer un paiement manuel en parallèle d’une demande Jèko encore en attente pour la même facture.

## Sécurité du webhook

1. Le webhook accepte seulement `POST`.
2. Il lit le corps brut avant tout parsing JSON.
3. Il vérifie `Jeko-Signature` par HMAC SHA-256 avec `JEKO_WEBHOOK_SECRET`, en comparaison à durée constante.
4. Une signature invalide renvoie `401` et le payload n’est pas persisté.
5. Le payload valide est contrôlé strictement avant insertion.
6. La transaction Jèko est unique via `(provider, transaction_id)` dans `payment_events`.

Jèko documente actuellement `transactionType: payment` ou `transfer`; certaines pages API présentent `PaymentRequest`. Le connecteur reconnaît les deux formes pour les paiements, mais ne crédite une facture que pour un paiement au statut `success`.

## Wallet et montant : liaison préalable obligatoire

Un webhook Jèko ne contient pas l’identifiant d’un wallet ERP. Pour éviter qu’un payload sélectionne arbitrairement un wallet, l’intégration utilise deux tables techniques :

- `payment_provider_wallet_mappings` lie un magasin Jèko (`provider_store_id`) à un wallet ERP autorisé ;
- `payment_provider_payment_requests` lie une demande Jèko créée côté serveur à une facture, un wallet, un montant fournisseur attendu et le montant ERP à comptabiliser.

Avant d’initier une demande Jèko, le serveur doit appeler `register_jeko_payment_request(jsonb)` après la réponse Jèko. Cette RPC est réservée à `service_role`. Elle impose : facture émise, référence égale au numéro de facture, mapping magasin/wallet actif, devise XOF et absence de surpaiement.

Le bridge refuse un webhook si la demande n’est pas enregistrée, si la référence, le montant fournisseur ou la devise divergent, ou si le wallet lié n’existe plus. Aucun wallet, montant ou identifiant de facture ne vient directement du navigateur ou du payload pour décider l’écriture ERP.

`amountCents` est le nom utilisé par l’API Jèko à la création. Jèko doit être configuré et vérifié en sandbox pour confirmer l’unité attendue par le compte marchand. Le mapping conserve séparément `expected_provider_amount` et `erp_amount` afin de ne jamais faire de conversion implicite dans le webhook.

## Idempotence et reprise

`payment_events.status` suit le cycle :

- `RECEIVED` : webhook signé, enregistré, non comptabilisé ;
- `PROCESSING` : traitement transactionnel en cours ;
- `PROCESSED` : paiement traité ou transfert explicitement ignoré par le flux de factures ;
- `FAILED` : le traitement métier a échoué, sans écriture financière partielle.

L’événement n’est marqué `PROCESSED` qu’après création du paiement de Course, confirmation, création du lien financier et recalcul du wallet. Le verrou `FOR UPDATE` sur l’événement et la contrainte unique empêchent deux webhooks concurrents de produire deux crédits. Un replay d’un événement `PROCESSED` retourne `200` sans effet.

En cas d’échec métier, l’exception est capturée dans la RPC : la sous-transaction annule toute écriture partielle, `payment_events` passe à `FAILED`, et l’Edge Function répond `500` pour une erreur temporaire ou `422` pour une incohérence définitive. Les retries Jèko restent donc possibles pour les indisponibilités et l’événement conserve son diagnostic pour la réconciliation.

La documentation Jèko indique jusqu’à trois retries (environ 1, 5 puis 15 minutes) pour un `5xx`, un `429` ou une absence de réponse dans les 30 secondes. Les erreurs de signature (`401`), de payload (`400`) et les incohérences métier définitives (`422`) ne sont pas rejouées par Jèko. L’Edge Function reste volontairement courte : elle valide, persiste et appelle une seule RPC transactionnelle ; l’objectif opérationnel est de répondre bien avant la limite Jèko de 30 secondes (la documentation recommande 5 secondes lorsque possible).

## RPC-pont et permissions

`process_jeko_payment_event(uuid)` et `register_jeko_payment_request(jsonb)` sont :

- `SECURITY DEFINER` avec `search_path = public, auth, pg_temp` ;
- exécutables uniquement par `service_role` ;
- explicitement révoquées à `PUBLIC`, `anon` et `authenticated` ;
- protégées par un contrôle `auth.role() = 'service_role'`.

Les utilisateurs normaux ne peuvent ni lire ni écrire `payment_events`, les mappings ou les demandes de prestataire. RLS est activée sur ces trois tables, sans politique client. Le secret `service_role` reste uniquement dans l’Edge Function.

La passerelle ne fait aucun `INSERT` ou `UPDATE` direct sur `finance_operations`. Elle appelle les helpers internes issus des RPC existantes de paiement de Course. Ces helpers préservent les contrôles de facture émise, de surpaiement, de lien financier unique, l’audit et l’appel à `_internal_course_upsert_finance`, qui reste le seul mécanisme de création de l’opération financière de Course.

## Logs

Les logs utilisent seulement : provider, identifiant de transaction, identifiant d’événement, identifiants ERP résultants, code d’échec et durée. Ils ne contiennent ni clé API, ni secret webhook, ni en-tête d’autorisation, ni payload complet.

## Déploiement

1. Vérifier la migration localement puis l’appliquer via la procédure Supabase contrôlée.
2. Ajouter `JEKO_WEBHOOK_SECRET` dans Supabase Edge Functions, puis `JEKO_API_KEY`, `JEKO_API_KEY_ID` et `JEKO_BASE_URL` dans les variables serveur de l’application déployée.
3. Déployer `jeko-webhook` avec JWT public désactivé : la protection est la signature HMAC, non un JWT navigateur.
4. Configurer dans le cockpit Jèko l’URL : `https://<project-ref>.functions.supabase.co/jeko-webhook`.
5. Depuis une facture de Course émise, utiliser **Payer avec Jèko** pour créer le mapping magasin Jèko → wallet ERP si aucun mapping n’existe encore. Cette action est réservée aux administrateurs.
6. Tester d’abord avec une facture de sandbox, régler la demande, puis réconcilier une opération `finance_operations` unique avec le crédit exact du wallet.

## Rotation et rollback

- Pour une rotation, enregistrer le nouveau secret dans Supabase, mettre à jour Jèko, puis retirer l’ancien dès que les webhooks signés avec le nouveau secret sont confirmés.
- Révoquer immédiatement toute clé API susceptible d’avoir été exposée.
- Le rollback applicatif consiste à désactiver le webhook côté Jèko et à ne plus enregistrer de nouvelles demandes. Ne pas supprimer `payment_events`, les paiements, les liens financiers ni les écritures : ils sont nécessaires à l’audit.
- Une migration corrective future doit désactiver le bridge sans effacer les événements historiques.

## Références Jèko

- [Authentification API](https://developer.jeko.africa/fr/integration/getting-started/authentication)
- [Webhooks et signature](https://developer.jeko.africa/fr/integration/webhooks/integration)
- [Comportement, délais et retries des webhooks](https://developer.jeko.africa/fr/integration/webhooks/behavior-of-webhook)
- [Créer une demande de paiement](https://developer.jeko.africa/api-reference/demandes-de-paiement/cr%C3%A9er-une-demande-de-paiement)
- [Créer un virement](https://developer.jeko.africa/api-reference/virements/cr%C3%A9er-un-virement)
