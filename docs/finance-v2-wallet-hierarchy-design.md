# Finance V2 — hiérarchie Wallet (Phase B)

Suite à l'audit Phase A. Décisions prises pour l'implémentation ; voir le rapport Phase A (conversation) pour le détail des preuves.

## 1. Modèle retenu — parent virtuel, source unique

Pas de ligne `wallets` pour "Wallet MOTOS". Le module est une **dimension** sur le sous-wallet, jamais un solde stocké séparé :

```
wallets
  id
  name
  type              -- CASH | ASSET | JEKO (inchangé)
  module            -- NULL | 'MOTOS' | 'VEHICULES' | 'AGRICULTURE' | 'COMMERCE' | 'TRANSPORT'
  asset_kind         -- NULL | 'MOTORCYCLE' | 'VEHICLE' | 'FARM' | 'BUSINESS_LOCATION' | 'GENERAL'
  motorcycle_id      -- FK nullable, unique si non-null
  vehicle_id         -- FK nullable, unique si non-null
  farm_id            -- FK nullable, unique si non-null
  is_general         -- bool, une seule par module
  is_archived        -- bool, jamais supprimé
  archived_at
  balance, initial_balance, color, icon, is_default, alert_threshold  -- inchangés
```

Le "wallet MOTOS consolidé" = `SUM(balance) WHERE module='MOTOS' AND NOT is_archived`, calculé à la volée par une vue/RPC, jamais matérialisé. Impossible de compter l'argent deux fois puisqu'il n'existe qu'une ligne par franc, au niveau du sous-wallet.

`Marasse` et `Epargne` (type CASH, sans module) restent hors hiérarchie — ce sont vos comptes de trésorerie réelle, pas des allocations analytiques. `Jèko – HALAL & CO` (type JEKO) reste aussi hors hiérarchie — c'est un compte de règlement fournisseur de paiement, pas un actif métier.

## 2. Répond à la section 8 (trésorerie vs analytique)

"Combien l'entreprise possède réellement ?" = `SUM(balance) FROM wallets WHERE NOT is_archived` (tous types confondus).
"Combien est affecté à Moto 001 ?" = `balance` du sous-wallet `motorcycle_id = X`.
Les deux coexistent sans double calcul : le sous-wallet EST la trésorerie, juste étiqueté par module.

## 3. Création automatique + idempotence

Triggers `AFTER INSERT` sur `motorcycles`, `vehicles`, `farms` → appellent une fonction interne qui :
1. s'assure que le sous-wallet "Général" du module existe (`is_general=true`, contrainte unique partielle `(module) WHERE is_general`) ;
2. crée le sous-wallet lié à l'actif via `ON CONFLICT DO NOTHING` sur l'unique partielle `(motorcycle_id)`/`(vehicle_id)`/`(farm_id)`.

Rejouer l'insertion ou l'événement ne crée jamais de doublon — la contrainte unique est la garantie, pas une vérification applicative.

Commerce garde son mécanisme existant (`business_location_wallets` + `set_business_location_wallet`), déjà propre par FK — j'y ajoute seulement `module='COMMERCE'` sur le wallet pour qu'il apparaisse dans l'agrégation.

## 4. Affectation hybride (section 5)

Auto-création + auto-affectation par défaut (le trigger le fait). Réaffectation manuelle réservée à `admin`/`super_admin`/`gestionnaire` (permission `wallets.reassign`, nouvelle, même mécanisme que `security_require_finance_role`). Une réaffectation ne s'applique qu'aux opérations futures : les lignes `finance_operations` déjà écrites gardent leur `wallet_id` d'origine, jamais réécrites.

## 5. Transferts — solde disponible (sections 9-11)

`finance_create_operation` (fonction existante, modifiée, pas remplacée) : pour `type='TRANSFER'`, verrouille la ligne source (`SELECT balance FROM wallets WHERE id = v_wallet_id FOR UPDATE`) puis vérifie `balance >= v_amount` avant l'insertion. Le lock lève la condition de course décrite section 10 : deux transferts concurrents sur le même wallet s'exécutent en série, le second voit le solde déjà débité par le premier.

Pas de blocage rétroactif : la vérification ne s'applique qu'aux nouvelles opérations. Les wallets déjà négatifs (HALAL AGR001) restent en l'état, aucune correction automatique.

`REVENUE`/`EXPENSE`/`DEPOSIT` sur wallet source ne sont PAS bloqués par ce contrôle — seul `TRANSFER` a une notion de "disponible ailleurs" à protéger explicitement ; une dépense normale peut légitimement mettre un wallet à zéro ou en dessous selon la réalité métier déjà en place (non modifié ici).

## 6. Wallets migrés (mapping confirmé par les données réelles, pas par convention de nom)

| Wallet existant | module | asset_kind | Lien FK |
|---|---|---|---|
| HALAL AGR001 | AGRICULTURE | FARM | `farms.id` où `code='AGR001'` (confirmé exact) |
| HALAL AGR002 | AGRICULTURE | FARM | `farms.id` où `code='AGR002'` (confirmé exact) |
| HALAL MOTO 001/002/003 | MOTOS | GENERAL | aucune moto n'existe encore en base — pas de lien forcé, nichés sous MOTOS/Général |
| HALAL_VHC_01 | VEHICULES | GENERAL | 2 véhicules existent, aucune correspondance fiable — niché sous VEHICULES/Général plutôt que deviné |
| Magasin lélédou | COMMERCE | BUSINESS_LOCATION | déjà lié via `business_location_wallets` |
| Marasse, Epargne | NULL | NULL | trésorerie, hors hiérarchie |
| Jèko – HALAL & CO | NULL | NULL | règlement fournisseur, hors hiérarchie |

Aucun montant modifié. Uniquement des colonnes de rattachement ajoutées sur des lignes existantes.

## 7. Ce que je ne fais pas

- Pas de correction des wallets négatifs existants (HALAL AGR001 reste en audit).
- Pas de fusion Commerce/Field sur `finance_create_operation` central — hors scope.
- Pas de permission `ALLOW_NEGATIVE_BALANCE` activée — colonne/permission prévue mais désactivée par défaut, décision administrative séparée si besoin plus tard.
- Pas de redesign visuel au-delà de PageHeader/MetricCard déjà validés (Design V2).
