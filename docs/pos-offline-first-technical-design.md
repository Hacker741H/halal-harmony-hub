# POS-03 — Caisse 100 % offline-first et synchronisation contrôlée

## Statut du document

Ce document est une **conception technique et un audit**. Il ne modifie aucune table, migration, RPC, politique RLS, règle financière ou interface existante. Les schémas et RPC décrits comme « proposés » doivent faire l'objet de migrations additives et de revues de sécurité séparées avant toute implémentation.

L'objectif est de faire évoluer la caisse Commerce vers une caisse utilisable sans réseau pour les encaissements **en espèces**, tout en maintenant une source de vérité serveur unique, le journal financier existant et une traçabilité vérifiable à la reconnexion.

## 1. Audit de la caisse existante

### Ce qui existe aujourd'hui

La caisse Commerce actuelle est une caisse **online-first** :

- le caissier accède uniquement aux points de vente Commerce auxquels il est affecté ;
- le catalogue et le stock local sont lus avec `get_commerce_pos_workspace(location_id)` ;
- le panier est conservé localement par `src/hooks/use-commerce-pos-session.ts` et `src/lib/commerce-pos-session.ts` ;
- le brouillon est stocké dans `localStorage`, par point de vente et utilisateur, sous la clé `halal_erp_pos_draft:<locationId>:<userId>` ;
- une vente espèces validée appelle la Server Function `createCommerceCashSale`, qui appelle la RPC `create_commerce_cash_sale(jsonb)` ;
- cette RPC verrouille les lignes de stock concernées, crée la vente, la facture, le paiement confirmé, le mouvement de stock, les liens financiers et l'écriture dans `finance_operations`, puis recalcule le wallet dans une même transaction PostgreSQL ;
- le wallet de caisse primaire est résolu côté PostgreSQL depuis l'affectation du point de vente. Le navigateur ne peut pas choisir arbitrairement un wallet ;
- les paiements Jèko restent un flux en ligne : la caisse ne doit pas les simuler ni les considérer comme encaissés sans confirmation fournisseur.

### Éléments déjà utiles à préserver

| Garantie actuelle | Source | Conséquence pour POS-03 |
|---|---|---|
| Point de vente et wallet de caisse explicitement affectés | `business_locations`, `business_location_wallets` | Le terminal hors ligne doit être provisionné pour une seule affectation autorisée. |
| Autorisation de caisse vérifiée côté base | `permission_require('commerce.pos.sell')`, `commerce_location_access_allowed` | La synchronisation doit réutiliser cette vérification serveur. |
| Stock verrouillé lors de la vente | `FOR UPDATE` sur `business_location_inventory_items` | Le serveur demeure l'arbitre final du stock ; le stock hors ligne est seulement une copie opérationnelle. |
| Vente, facture, paiement, finance et stock cohérents | `create_commerce_cash_sale(jsonb)` | Aucun code client ne doit fabriquer une écriture financière directement. |
| Journal financier central | `finance_operations` et liens explicites | Une vente synchronisée doit créer exactement une recette existante et un crédit de wallet, jamais un second journal. |
| Brouillon persistant | `useCommercePosSession` | À remplacer progressivement par un modèle IndexedDB versionné, sans casser le panier déjà restaurable. |
| Protection contre le double clic/retry | référence `POS:<session-id>` ; index de la migration locale `20260811130000_add_commerce_pos_checkout_idempotency.sql` | Précondition de synchronisation : l'index doit être appliqué et contrôlé avant le pilotage offline. |

### Limites actuelles

1. `localStorage` ne conserve qu'un brouillon de panier ; il ne gère ni tickets validés hors ligne, ni sessions de caisse, ni file de synchronisation, ni cache catalogue fiable.
2. La création de vente nécessite immédiatement Supabase et la RPC serveur : aucune vente ne peut être finalisée sans réseau.
3. Il n'existe pas de numéro de terminal, de cache de droits hors ligne, de fermeture de caisse persistée, ni de procédure de reprise après conflit.
4. Le catalogue et le stock affichés viennent du serveur ; un caissier hors réseau n'a pas de base locale autorisée sur laquelle travailler.
5. Le contrôle du stock est juste au moment de la transaction serveur. Il faut donc une stratégie stricte contre le surstock vendu par plusieurs terminaux déconnectés.
6. Les lignes de ventes actuelles représentent des articles ou récoltes. Les services n'ont pas encore de modèle explicite de catalogue ni de ligne de ticket sans stock.

## 2. Tables, relations et RPC actuellement impliquées

### Référentiel opérationnel

| Ressource actuelle | Rôle dans le POS | Règle à préserver |
|---|---|---|
| `business_units` | Sépare Commerce des autres activités | Une caisse ne travaille que dans une unité Commerce active. |
| `business_locations` | Représente le magasin / point de vente | Le terminal est lié à une localisation active précise. |
| `business_location_assignments` | Affecte un caissier ou responsable à un point de vente | L'affectation courante reste requise côté serveur. |
| `business_location_wallets` | Lie les wallets autorisés au point de vente | Le wallet `CASH_DRAWER` primaire est défini par la base. |
| `business_location_inventory_items` | Quantité et prix de vente propres au magasin | Référence de stock serveur et cache de stock local. |
| `inventory_items` | Référentiel global des articles | Ne pas dupliquer le référentiel ; le cache local en est une projection. |
| `stock_movements` et `commercial_sale_stock_movement_links` | Trace la sortie physique liée à une ligne vendue | Toute vente synchronisée crée le mouvement via le moteur existant. |

### Vente et finance

| Ressource actuelle | Rôle dans le POS | Règle à préserver |
|---|---|---|
| `commercial_sales` | Ticket / vente commerciale | Une vente validée est confirmée, non supprimée. |
| `commercial_sale_lines` | Lignes d'article vendues | Chaque ligne vendue reste liée à son article et à son mouvement de stock. |
| `commercial_invoices` | Facture associée à la vente | La facture demeure liée à la vente et au client optionnel. |
| `commercial_invoice_payments` | Encaissement associé à la facture | Le paiement est la source métier de la recette. |
| `finance_commercial_invoice_payment_links` et `finance_links` | Relations explicites vers le journal | Les liens empêchent une recette financière parallèle. |
| `finance_operations` | Journal financier central | Il reste l'unique journal. Le client hors ligne n'y écrit jamais. |
| `wallets` | Solde calculé et destination d'encaissement | Aucun solde n'est modifié côté navigateur. |
| `commerce_cash_remittances` | Remise de caisse déclarée/confirmée | À rapprocher d'une future fermeture de session, sans réécrire son cycle actuel. |

### Paiements et connecteur Jèko

| Ressource actuelle | Usage | Limite offline |
|---|---|---|
| `payment_events` | Idempotence et audit des webhooks Jèko | Un événement mobile money doit provenir du fournisseur et du webhook vérifié. |
| `payment_provider_wallet_mappings` | Lie un magasin fournisseur au wallet ERP | Une affectation est configurée côté serveur, jamais saisie dans un ticket local. |
| `payment_provider_payment_requests` | Lie une demande Jèko à une facture et à son montant attendu | Une demande Jèko ne peut être créée ni confirmée sans connexion. |

### RPC et Server Functions en place

- Lecture POS : `get_commerce_pos_locations()`, `get_commerce_pos_workspace(uuid)`, `get_commerce_inventory_catalogue(uuid)`.
- Vente caisse : `create_commerce_cash_sale(jsonb)`, appelée par la Server Function `createCommerceCashSale` de `src/lib/commerce-pos.functions.ts`.
- Administration Commerce : `get_commerce_management_dashboard(uuid)`, `setup_commerce_location(jsonb)`, `update_commerce_location(jsonb)`, `assign_business_location_user(jsonb)`, `end_commerce_location_assignment(uuid)`.
- Stock Commerce : `configure_commerce_location_item(jsonb)` et `receive_commerce_inventory_item(jsonb)`.
- Paiements commerciaux existants : `create_commercial_invoice_payment(...)`, `confirm_commercial_invoice_payment(...)` et les helpers internes réservés au moteur / connecteur Jèko.

Les fonctions sensibles sont `SECURITY DEFINER`, déclarent un `search_path` sûr et sont retirées à `anon`. Les tables POS ne sont pas ouvertes en écriture directe à `authenticated`. POS-03 doit conserver ces garanties.

## 3. Décision d'architecture offline-first

Le modèle retenu est **local d'abord, serveur arbitre final** :

1. Le caissier enregistré et autorisé ouvre sa session en ligne et télécharge une projection limitée de son magasin.
2. Hors ligne, il vend uniquement les articles mis à disposition dans ce cache local, avec paiement espèces, et crée des tickets immuables dans IndexedDB.
3. La caisse diminue seulement une disponibilité locale indicative afin d'empêcher les doubles ventes dans le même terminal.
4. À la reconnexion, le moteur de synchronisation envoie les événements dans leur ordre ; la base vérifie à nouveau droits, session, magasin, wallet, prix et stock.
5. La base accepte un ticket une fois ou le refuse sans créer de finance ni modifier le stock.
6. Les écarts deviennent des conflits visibles, jamais des ajustements automatiques silencieux.

Le réseau ne doit donc pas être présenté comme optionnel pour les paiements électroniques, les remises inter-wallet ou la résolution d'écart. Il devient optionnel uniquement pour la **saisie contrôlée d'encaissements espèces**.

## 4. IndexedDB proposé

### Base locale

Nom proposé : `halal_erp_pos_offline`.

La base est versionnée. Toute évolution doit comporter une migration IndexedDB testée ; l'application doit pouvoir conserver les tickets non synchronisés lors d'une montée de version.

| Object store | Clé | Contenu minimal | Finalité |
|---|---|---|---|
| `terminal_profile` | `terminalId` | terminal, magasin, unité, version de configuration, date de provisionnement | Identité locale non financière du poste. |
| `offline_authorizations` | `authorizationId` | utilisateur, magasin, permissions offline limitées, expiration, signature/empreinte | Autorisation mise en cache après connexion validée. |
| `pos_catalog` | `[locationId, itemId]` | article, SKU, unité, prix autorisé, actif, version catalogue | Catalogue disponible au poste. |
| `pos_stock_snapshots` | `[locationId, itemId]` | quantité téléchargée, réserve locale, version, heure du snapshot | Disponibilité locale indicative. |
| `cash_sessions` | `sessionId` | caissier, terminal, magasin, wallet de caisse, ouverture, statut, totaux locaux | Session de caisse et fermeture hors ligne. |
| `pos_tickets` | `ticketId` | session, référence stable, statut local, total, paiement espèces, client facultatif, horodatage | Ticket hors ligne immuable après validation. |
| `pos_ticket_lines` | `lineId` | ticket, article ou service futur, quantité, prix figé, total | Lignes du ticket. |
| `cash_closures` | `closureId` | session, total attendu local, comptage déclaré, écart, statut | Clôture préparée et synchronisée. |
| `sync_events` | `eventId` | type, entité, séquence, payload minimal, statut, tentatives, dernier échec | File durable de synchronisation. |
| `sync_locks` | `scope` | détenteur, expiration, version | Évite deux synchronisations concurrentes du même navigateur/terminal. |
| `sync_diagnostics` | `id` | durée, code d'erreur sans secret, statut, date | Diagnostic local limité et purgé. |

Les données locales ne doivent contenir ni mot de passe, ni `service_role`, ni clé Jèko, ni JWT durable, ni solde global non nécessaire. Les pièces justificatives ne sont pas synchronisées en arrière-plan dans le premier périmètre offline.

## 5. Modèles locaux détaillés

### Terminal et autorisation offline

```ts
type OfflineTerminalProfile = {
  terminalId: string;
  locationId: string;
  businessUnitCode: "COMMERCE";
  deviceLabel: string;
  provisionedAt: string;
  configurationVersion: number;
};

type OfflineAuthorization = {
  authorizationId: string;
  terminalId: string;
  userId: string;
  locationId: string;
  permissions: Array<"commerce.pos.read" | "commerce.pos.sell" | "commerce.cash.close">;
  issuedAt: string;
  expiresAt: string;
  revocationVersion: number;
  signature: string;
};
```

Le `signature` ne donne aucun privilège à lui seul : il est émis côté serveur, lié à un terminal et une affectation, et son expiration locale est stricte. Une fois la connexion rétablie, l'autorisation et sa révocation sont revérifiées par le serveur.

### Session de caisse

```ts
type OfflineCashSession = {
  sessionId: string;
  terminalId: string;
  locationId: string;
  cashierUserId: string;
  cashDrawerWalletId: string;
  openedAt: string;
  openedOffline: boolean;
  status: "OPEN" | "CLOSING" | "CLOSED" | "SYNC_CONFLICT";
  localSequence: number;
  expectedCashAmount: number;
  syncedAt: string | null;
};
```

### Ticket local et ligne

```ts
type OfflinePosTicket = {
  ticketId: string;
  sessionId: string;
  terminalId: string;
  locationId: string;
  reference: string; // POSO:<terminalId>:<ticketId>
  clientId: string | null;
  paymentMethod: "CASH";
  status: "LOCAL_CONFIRMED" | "QUEUED" | "SYNCING" | "SYNCED" | "CONFLICT" | "REJECTED";
  totalAmount: number;
  createdAt: string;
  localSequence: number;
  serverSaleId: string | null;
  serverOperationId: string | null;
};

type OfflinePosTicketLine = {
  lineId: string;
  ticketId: string;
  lineKind: "ARTICLE"; // SERVICE sera proposé dans une phase ultérieure
  inventoryItemId: string;
  label: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  stockSnapshotVersion: string;
};
```

### Clôture locale

```ts
type OfflineCashClosure = {
  closureId: string;
  sessionId: string;
  terminalId: string;
  locationId: string;
  declaredAt: string;
  expectedCashAmount: number;
  countedCashAmount: number;
  varianceAmount: number;
  status: "DRAFT" | "QUEUED" | "SYNCED" | "REVIEW_REQUIRED" | "REJECTED";
  notes: string | null;
};
```

## 6. Sessions de caisse

### Ouverture

- La première ouverture doit être faite en ligne afin de provisionner le terminal, l'affectation du caissier, le magasin, le wallet `CASH_DRAWER` primaire et le catalogue autorisé.
- Une session offline ne peut être ouverte que si une autorisation non expirée correspond au caissier, au terminal et au magasin.
- Une session contient un numéro UUID stable et une séquence locale monotone. Un ticket ne peut appartenir qu'à une session ouverte.
- Le montant d'ouverture peut être déclaré localement ; il ne met jamais à jour le wallet. Son rapprochement relève de la clôture et de Finance.

### Fermeture

- Le caissier saisit le comptage réel d'espèces ; l'application calcule l'attendu à partir des tickets espèces locaux de la session.
- La fermeture fige la session localement : aucun nouveau ticket n'y est ajouté.
- La synchronisation soumet d'abord tous les tickets de la session, puis la clôture.
- Un écart n'écrit pas automatiquement une dépense ou une recette : il passe en `REVIEW_REQUIRED` et requiert le processus de remise / contrôle existant.
- La réouverture d'une session clôturée est interdite. Une nouvelle session est créée.

## 7. Cycle de vie des tickets offline

1. Le caissier choisit un article déjà provisionné, dont la disponibilité locale est suffisante.
2. L'application crée le ticket et les lignes dans une unique transaction IndexedDB.
3. La réserve locale de stock diminue dans la même transaction IndexedDB ; un événement `TICKET_CREATE` est ajouté à `sync_events`.
4. Le ticket est affiché comme « enregistré sur ce poste — en attente de synchronisation » ; il ne doit pas être présenté comme déjà crédité dans le wallet.
5. Lorsque le réseau revient, le ticket passe `SYNCING`, puis soit `SYNCED`, soit `CONFLICT`/`REJECTED`.
6. Seul l'état `SYNCED` reçoit les identifiants serveur de vente, facture, paiement et opération financière. Le reçu final peut alors indiquer que l'encaissement est comptabilisé.

Une annulation d'un ticket local non synchronisé est une annulation locale traçable qui rétablit sa réserve locale. Un ticket déjà synchronisé est soumis aux règles existantes d'annulation/contre-écriture ; il ne doit jamais être supprimé depuis IndexedDB pour masquer l'historique.

## 8. Algorithme de synchronisation

### Déclencheurs

- passage du navigateur en ligne ;
- ouverture de l'application ;
- action explicite « Synchroniser » ;
- temporisation courte lorsque l'application est visible ;
- reprise après une erreur réseau, avec backoff borné.

La synchronisation ne doit pas tourner de manière agressive en arrière-plan ni créer plusieurs processus concurrents. Elle respecte `navigator.onLine` comme signal indicatif et confirme le réseau par une requête contrôlée.

### Ordre de traitement

```text
provisionnement / autorisation valide
  → sessions ouvertes
  → tickets en ordre localSequence
  → clôtures dont tous les tickets sont synchronisés
  → mise à jour catalogue et snapshots
```

### Traitement d'un événement

1. Prendre un verrou local `sync_locks` pour le terminal.
2. Marquer l'événement `SYNCING` avec une tentative et un horodatage.
3. Envoyer l'identifiant stable de terminal, l'`eventId`, le ticket/session/closure et la référence métier, sans wallet choisi par le client.
4. Le serveur rejoue les validations de droits, terminal, affectation, magasin, session, stock, prix et statut.
5. Si l'événement a déjà été accepté, le serveur retourne son résultat antérieur sans recréer de vente.
6. Le client confirme `SYNCED` uniquement après réponse serveur complète ; il met à jour les références serveur et rafraîchit le snapshot de stock.
7. En cas d'erreur réseau, l'événement repasse `QUEUED` avec backoff. En cas d'erreur métier durable, il devient `CONFLICT` ou `REJECTED`, sans auto-retry aveugle.

Les tickets d'une même session sont traités séquentiellement. Plusieurs terminaux peuvent synchroniser simultanément : les validations et unicités serveur, non IndexedDB, protègent l'intégrité.

## 9. Idempotence et prévention du double encaissement

### Identifiants stables

- `terminalId` : attribué lors du provisionnement, jamais déduit uniquement du navigateur.
- `sessionId` : UUID créé à l'ouverture de caisse.
- `ticketId` : UUID créé localement avant tout encaissement.
- `eventId` : UUID créé pour chaque événement de synchronisation.
- `reference` : `POSO:<terminalId>:<ticketId>`.

Un retry, un redémarrage du navigateur ou une réponse HTTP perdue réutilise les mêmes identifiants. Il ne crée jamais une nouvelle référence.

### Protections serveur proposées

1. Conserver et appliquer l'unicité existante de référence POS par magasin (`commercial_sales_pos_session_reference_unique`) ; elle est actuellement présente dans une migration locale en attente, à confirmer distante avant le projet offline.
2. Ajouter une future table serveur d'événements offline avec une contrainte unique `(terminal_id, event_id)`.
3. Ajouter une contrainte unique sur la référence offline de vente par magasin, par exemple `(business_location_id, offline_ticket_id)` ou `reference` avec un préfixe stable.
4. La RPC de synchronisation retourne le même résultat pour un événement déjà `PROCESSED`.
5. La transaction qui accepte un ticket doit englober : contrôle du stock, création de vente, facture, paiement, mouvement de stock, lien financier, `finance_operations`, recalcul wallet et marquage `PROCESSED` de l'événement.

Il est interdit de considérer « timeout » comme une vente échouée. Le ticket reste à rapprocher, puis le même `eventId` est rejoué ; le serveur répond soit avec l'opération déjà créée, soit avec un refus explicite.

## 10. Gestion de stock offline et des conflits

### Modèle de disponibilité locale

Le terminal reçoit une photo de stock par article : `quantity_at_sync`, `reserved_local_quantity`, `snapshot_version`, `synced_at`. La caisse n'autorise pas localement une vente au-delà de `quantity_at_sync - reserved_local_quantity`.

Cette quantité n'est pas une vérité comptable. Elle sert uniquement à limiter les ventes sur **ce terminal** pendant une déconnexion.

### Validation finale et conflits

À la synchronisation, `create_commerce_cash_sale` ou sa future RPC enveloppe doit verrouiller le stock serveur et vérifier que la quantité est disponible. Si elle ne l'est plus :

- aucune vente, facture, paiement, opération financière ou sortie de stock n'est créée ;
- le ticket devient `CONFLICT` ;
- l'écran indique l'article, le stock prévu local, le stock serveur et la quantité demandée ;
- seul un utilisateur habilité traite le conflit : livraison complémentaire, correction d'inventaire selon le processus stock, ou annulation tracée du ticket local.

Il ne faut jamais :

- ajuster automatiquement le stock serveur pour faire passer une vente offline ;
- créer une recette sans sortie de stock validée ;
- fusionner deux tickets semblables ;
- soustraire deux fois le même stock lors d'un retry.

### Limite importante

Deux terminaux hors ligne peuvent tous deux voir le même stock disponible. La seule protection totale contre cette concurrence exige un stock alloué par terminal ou une limite d'encaissement hors ligne. Ce choix métier doit être validé avant un déploiement multi-caisses.

## 11. Articles, services et lignes de ticket

### Articles — périmètre initial offline

Le premier déploiement offline couvre uniquement les articles `inventory_items` affectés au magasin via `business_location_inventory_items`. Les prix, unités et disponibilités sont figés dans le ticket afin d'expliquer le reçu historique.

### Services — proposition pour phase ultérieure

Un service ne doit pas être représenté par un faux article stocké à zéro. La proposition est :

- créer un référentiel Commerce de services actif/inactif avec prix autorisé ;
- faire évoluer le modèle de ligne pour porter un `line_kind` (`ARTICLE` ou `SERVICE`) ;
- rendre la référence `inventory_item_id` obligatoire uniquement pour `ARTICLE` ;
- ne créer aucun `stock_movement` pour `SERVICE` ;
- conserver les mêmes cycles vente → facture → paiement → `finance_operations` ;
- soumettre les services offline au même mécanisme d'idempotence que les articles.

Cette évolution est une migration additive et un changement de RPC futur ; elle n'est pas incluse dans POS-03 étape 1.

## 12. Paiements Jèko : online-only

Les paiements Jèko restent strictement **online-only** :

- une demande Jèko doit être créée auprès du fournisseur pendant que la connexion est disponible ;
- un paiement n'est reconnu qu'après webhook Jèko signé, validé et traité par la passerelle existante ;
- le client hors ligne ne peut jamais valider lui-même un statut « payé par Jèko » ;
- aucun ticket offline Jèko ne doit créer de paiement `CONFIRMED`, de recette ou de crédit wallet à la reconnexion sans l'événement fournisseur idempotent correspondant.

Lorsqu'une transaction réseau commence mais que l'écran est interrompu, l'état local doit être `PAYMENT_RECONCILIATION_REQUIRED`, puis rapproché avec l'état fournisseur et les `payment_events` serveur. La synchronisation offline n'est pas un substitut au webhook.

## 13. Authentification offline et contrôle terminal

### Principe

Un utilisateur peut travailler hors ligne uniquement après avoir été authentifié en ligne et provisionné pour ce terminal. On ne met ni mot de passe ni token Supabase longue durée dans IndexedDB.

### Proposition de sécurité

- enregistrer le terminal en ligne avec un identifiant aléatoire, un libellé et une preuve de possession générée par WebCrypto ;
- télécharger une autorisation offline signée, limitée à une affectation, des permissions minimales et une durée courte configurable ;
- demander un code local du caissier pour déverrouiller l'application ; dériver la clé de chiffrement locale avec WebCrypto, jamais stocker le code ;
- chiffrer les données IndexedDB sensibles à l'aide d'une clé liée au terminal et au déverrouillage local ;
- empêcher le travail offline si l'autorisation est expirée, si le magasin change, ou si le terminal n'a jamais été provisionné ;
- à la reconnexion, contrôler à nouveau l'affectation, le rôle, la révocation et l'état du terminal avant toute synchronisation.

### Limites de sécurité à accepter explicitement

Une application web installée sur un ordinateur partagé n'offre pas la même protection qu'un terminal MDM natif. Il faudra a minima : chiffrement disque du poste, verrouillage de session, compte OS dédié, arrêt de la caisse à la déconnexion, effacement local lors d'une désaffectation et durée courte d'autorisation offline. Une révocation ne peut être connue du poste qu'à sa prochaine connexion.

## 14. PWA et Service Worker

### Rôle proposé

Le Service Worker permet de démarrer l'interface caisse sans réseau et de servir le code statique déjà installé. Il ne doit pas devenir un moteur financier.

- précharger seulement l'app shell de la caisse, ses icônes, polices et ressources versionnées ;
- versionner le cache et supprimer les anciennes versions uniquement une fois qu'aucune session critique ne dépend d'elles ;
- ne pas mettre en cache des réponses Supabase, des réponses de wallet, des JWT, des secrets, des webhooks ou des données de paiement ;
- afficher explicitement le statut en ligne/hors ligne et la date de dernier catalogue synchronisé ;
- prévoir une page de récupération si l'app shell n'a jamais été installée en ligne.

Le `Background Sync` du navigateur peut être utilisé comme accélérateur lorsque disponible, mais ne doit pas être la seule garantie : les synchronisations doivent aussi repartir à l'ouverture de la caisse et au retour en ligne.

## 15. Conflits, erreurs et résolution

| Situation | Comportement automatique | Résolution humaine requise |
|---|---|---|
| Même événement rejoué | Retourne le résultat déjà traité | Aucune. |
| Timeout après envoi | Ticket en rapprochement, retry avec le même `eventId` | Seulement si le serveur renvoie un conflit. |
| Stock insuffisant côté serveur | Ticket `CONFLICT`, aucune finance créée | Responsable stock corrige via le processus officiel ou annule le ticket. |
| Prix serveur changé | Rejeter ou mettre en contrôle selon règle tarifaire à définir | Responsable choisit le prix autorisé, sans altérer le ticket source. |
| Caissier ou magasin révoqué | Pas de nouvelle vente offline à l'expiration ; synchro refusée si droits retirés | Administrateur / responsable réaffecte ou annule tracé. |
| Wallet de caisse modifié | Réconciliation requise ; le ticket ne choisit jamais un autre wallet | Finance décide du rapprochement. |
| Session clôturée localement | Aucun nouveau ticket dans cette session | Ouvrir une nouvelle session. |
| Écart espèces | Aucun ajustement financier automatique | Contrôle Finance via remise / régularisation autorisée. |
| Jèko sans webhook confirmé | Ne pas créer de recette | Attendre le webhook et rapprocher le paiement. |

Tous les conflits sont consultables par caissier pour le suivi et par administrateur/finance pour la résolution. Les montants financiers détaillés restent soumis aux permissions existantes.

## 16. Migrations additives nécessaires — propositions seulement

Les noms et colonnes ci-dessous sont **proposés**, sans migration créée dans cette étape.

1. `pos_terminals` : terminal enregistré, statut (`ACTIVE`, `REVOKED`, `RETIRED`), magasin autorisé, empreinte publique, dernière connexion, version de révocation, audit. Contrainte d'unicité sur l'identité du terminal.
2. `pos_cash_sessions` : sessions de caisse serveur, terminal, caissier, point de vente, wallet de caisse résolu côté serveur, état (`OPEN`, `CLOSED`, `REVIEW_REQUIRED`, `CANCELLED`), totaux et références de clôture.
3. `pos_offline_sync_events` : `terminal_id`, `event_id`, type, payload contrôlé, statut (`RECEIVED`, `PROCESSING`, `PROCESSED`, `FAILED`, `CONFLICT`), résultat métier et métadonnées d'audit. Contrainte unique `(terminal_id, event_id)`.
4. Colonnes d'origine offline additives sur `commercial_sales` ou table de liaison dédiée : `pos_terminal_id`, `pos_cash_session_id`, `offline_ticket_id`. Contrainte unique appropriée par magasin/terminal/ticket.
5. `pos_cash_closures` ou extension contrôlée de `commerce_cash_remittances`, après étude du cycle exact de remise actuel. La préférence est une table de session dédiée avec une relation explicite vers une éventuelle remise, sans réinterpréter les remises historiques.
6. `commerce_services` et l'évolution additive des lignes de vente pour les services, uniquement dans une phase ultérieure.
7. Index ciblés : événements par `(status, created_at)`, tickets par session, sessions ouvertes par terminal, ventes par `(business_location_id, offline_ticket_id)`.

Toutes ces tables devront : RLS activée, écriture directe retirée à `authenticated`, politiques de lecture minimales, `SECURITY DEFINER` avec `search_path` sûr pour les RPC et privilèges retirés à `anon`.

## 17. RPC transactionnelles nécessaires — propositions seulement

| RPC proposée | Responsabilité | Garanties |
|---|---|---|
| `provision_pos_terminal(jsonb)` | Enregistre/autorise un terminal en ligne | Admin habilité, affectation magasin, audit, aucune donnée financière. |
| `get_pos_offline_bootstrap(uuid)` | Fournit autorisation limitée, catalogue, snapshot stock, caisse active | Vérifie caissier, terminal, magasin et permissions. |
| `open_pos_cash_session(jsonb)` | Ouvre une session serveur ou confirme sa création offline | Wallet résolu côté serveur, une session active par terminal selon règle validée. |
| `sync_pos_offline_events(jsonb)` | Reçoit un lot ordonné d'événements | Idempotence par événement, atomique au niveau de chaque ticket, aucun wallet fourni par le client. |
| `_internal_sync_pos_cash_ticket(...)` | Adapte un ticket validé au moteur actuel | Appelle ou réutilise strictement le flux de vente actuel ; aucune logique financière dupliquée. |
| `close_pos_cash_session(jsonb)` | Enregistre la clôture et son écart | Ne touche pas au wallet sans le flux Finance/remise explicitement validé. |
| `get_pos_sync_status(uuid)` | Permet le rapprochement d'un ticket/événement | Résultat limité au caissier concerné et aux rôles autorisés. |

La RPC de synchronisation ne doit accepter ni un `wallet_id` arbitraire, ni un montant de finance indépendant des lignes, ni un utilisateur cible. Elle derive le caissier de `auth.uid()`, le wallet de `business_location_wallets`, les montants des lignes et l'autorisation du terminal de la base.

## 18. Tests prévus

### Tests unitaires et IndexedDB

- création atomique ticket + lignes + événement + réserve locale ;
- restauration après fermeture/rechargement du navigateur ;
- annulation locale avant synchronisation et restauration exacte de la réserve ;
- persistance d'une file à plusieurs tickets ;
- changement de version IndexedDB sans perte de tickets non synchronisés ;
- expiration d'autorisation offline ;
- verrou empêchant deux synchronisations locales parallèles ;
- passage `PROCESSING` vers `RECONCILIATION_REQUIRED` après interruption ;
- absence de secret, JWT ou mot de passe dans les object stores.

### Tests SQL / RPC transactionnels

- terminal non autorisé, caissier non affecté et `anon` refusés ;
- même `(terminal_id, event_id)` soumis deux fois : une vente, un paiement, une opération et un crédit wallet exactement ;
- deux requêtes concurrentes du même événement ;
- reprise après timeout avec résultat déjà créé ;
- stock suffisant : vente, sortie de stock, facture, paiement et opération financière cohérents ;
- stock insuffisant : aucune écriture commerciale, stock ou financière ;
- wallet absent/non primaire/révoqué : refus sans effet de bord ;
- session fermée : refus de ticket ;
- clôture avant synchronisation de tous les tickets : refus contrôlé ;
- écart de caisse : état de revue, sans écriture financière automatique ;
- RLS et permissions multi-rôles ;
- cohérence entre somme des tickets synchronisés, paiements, `finance_operations` et balance wallet.

### Tests E2E de caisse

1. Provisionner un terminal en ligne avec un caissier affecté.
2. Télécharger le catalogue et couper le réseau.
3. Ouvrir une session, vendre un article espèces à 20 000 FCFA et fermer l'application.
4. Redémarrer, vérifier ticket, stock local et file encore présents.
5. Reconnecter, synchroniser et vérifier une seule vente, une seule facture, un seul paiement, une seule opération `finance_operations` et un crédit unique du wallet de caisse.
6. Faire deux ventes concurrentes depuis deux terminaux sur le dernier article et vérifier qu'une seule est acceptée ; l'autre doit être mise en conflit.
7. Fermer la session avec un montant compté différent, vérifier qu'aucun ajustement automatique n'est fait.
8. Essayer un paiement Jèko sans connexion et vérifier qu'aucune recette n'est créée.

## 19. Roadmap recommandée

### POS-03A — Préparation et décisions de sécurité

- valider la politique de terminaux, durée offline, nombre de caisses par magasin, gestion des écarts, prix modifiables ou non et seuil de stock offline ;
- vérifier que l'index d'idempotence POS local (`20260811130000`) est appliqué avant toute synchronisation offline ;
- aucune vente offline à ce stade.

### POS-03B — Fondations serveur sécurisées

- créer les migrations additives de terminal, session et événement serveur ;
- créer et tester les RPC de provisionnement, bootstrap et synchronisation ;
- aucune PWA ni cache offline avant les validations RLS/idempotence.

### POS-03C — Données locales et espèces hors ligne

- introduire IndexedDB versionné, catalogue/snapshot, session locale, tickets article espèces et file durable ;
- conserver le flux online actuel en solution de repli ;
- pas de services ni Jèko offline.

### POS-03D — Synchronisation, rapprochement et clôture

- synchronisation séquentielle et idempotente ;
- écran de statut, conflits, reprise et clôture de session ;
- tests de panne réseau, double envoi et stock concurrent.

### POS-03E — PWA et pilote contrôlé

- Service Worker limité à l'app shell ;
- pilote sur un seul magasin et un nombre réduit de terminaux ;
- suivi des conflits, des échecs et des reprises avant extension.

### POS-03F — Services et optimisation multi-caisses

- modèle de services explicite ;
- éventuelle allocation de stock par terminal si le besoin multi-caisses hors ligne est confirmé ;
- pas de changement sans réconciliation et tests de finance.

## 20. Risques et bloqueurs à résoudre avant l'implémentation

1. **Concurrence de stock multi-terminal** : sans allocation dédiée, une connexion intermittente ne peut empêcher totalement le sur-engagement sur plusieurs caisses.
2. **Politique de caisse physique** : il faut valider qui approuve un écart, si une remise est obligatoire chaque jour et comment elle s'articule avec `commerce_cash_remittances`.
3. **Identité terminal** : le navigateur seul ne constitue pas une identité matérielle forte. Le protocole d'enrôlement et de révocation doit être accepté par le métier et la sécurité.
4. **Durée sans réseau** : une durée maximale est nécessaire pour limiter les données obsolètes, les autorisations révoquées et les écarts de stock.
5. **Prix et promotions** : la règle doit préciser si un prix téléchargé reste valable hors ligne et si un caissier peut le modifier. La recommandation initiale est non.
6. **Services** : ils exigent un modèle de catalogue/lignes dédié ; ils ne doivent pas être improvisés dans le flux article.
7. **Jèko** : une validation mobile money reste dépendante du réseau, de la demande fournisseur et du webhook signé.
8. **Navigateur/ordinateur** : IndexedDB peut être effacé par l'utilisateur ou le navigateur. Le pilote doit imposer un poste dédié, sauvegarde/reconnexion régulière et procédures de reprise.
9. **Migration POS-02 en attente** : l'unicité de référence POS (`20260811130000_add_commerce_pos_checkout_idempotency.sql`) doit être contrôlée sur Supabase avant le lot serveur POS-03.

## Conclusion

La caisse actuelle possède déjà le socle transactionnel nécessaire à une synchronisation sûre : magasin et wallet explicitement liés, validation des permissions en base, stock verrouillé, vente/facture/paiement/journal liés et audit. Elle n'est cependant pas encore offline-first.

POS-03 doit ajouter une couche de terminal, sessions, tickets locaux et événements idempotents autour de ce moteur, sans le contourner. Le premier périmètre sûr est : **article + espèces + un magasin autorisé + synchronisation contrôlée**. Les services, paiements Jèko et multi-caisses déconnectées doivent venir ensuite, après validation des risques documentés ci-dessus.
