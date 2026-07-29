# Audit — paramètres d’alertes et planification (Lot 8)

Date d’audit : 28 juillet 2026.

## État existant

- Le fichier `supabase/config.toml` contenait un `project_id` obsolète (`rpdhmranermceanyginr`) alors que le projet réellement lié par la CLI est `iljetumzbqtrjvtdlynj`. Il a été aligné avant le déploiement de la fonction afin d’éviter toute ambiguïté d’environnement.
- `company_settings` est le singleton de paramètres déjà présent. Il contient notamment `timezone`, actuellement initialisé à `Africa/Dakar`; il n’existe ni table générique `settings` ni organisation/espace de travail dans le schéma.
- `profiles` ne contient que des préférences personnelles (`locale`, coordonnées, avatar). Il ne convient pas aux règles métier globales.
- Les rôles disponibles sont `super_admin`, `admin`, `gestionnaire`, `comptable`, `chauffeur`, `employe` et `lecture_seule`. Au moment de l’audit, le seul compte de test possède `super_admin` et `lecture_seule`.
- Le moteur du Lot 7 est centralisé dans les fonctions PostgreSQL `generate_notifications`, `resolve_obsolete_notifications` et `create_or_update_notification_for_roles`. La page Notifications et le tableau de bord l’appellent aujourd’hui directement.
- Les délais `30 / 15 / 7 jours`, les destinataires et les gravités sont codés dans la migration `20260728184000_add_notifications_alerts_center.sql`; le trigger `tg_apply_notification_due_stage` les recopie également. C’est le point à normaliser.
- Les seuils de stock sont déjà propres à chaque `inventory_items.seuil_alerte`. Aucun seuil wallet n’existe encore : il doit donc être ajouté à `wallets`, avec une règle globale de repli.
- Les données de date réellement utilisables sont les permis chauffeur, les contrats, les documents, les échéances réglementaires moto et les entretiens moto. Les véhicules n’exposent toujours pas de dates d’assurance ou de visite technique; aucune règle fictive ne sera créée pour eux.
- `pg_cron` et `pg_net` ne sont pas activés dans le projet distant. Seule l’extension `supabase_vault` est présente. Par conséquent, aucune planification distante ne peut être déclarée active à ce stade.

## Migration Wallet apparue pendant le Lot 7

La migration [`20260728185000_preserve_wallet_opening_balance.sql`](../supabase/migrations/20260728185000_preserve_wallet_opening_balance.sql) est présente à la fois localement et sur le projet Supabase. Son historique SQL ne permet pas d’en attribuer l’auteur. Elle n’a pas été créée par le Lot 7 : elle a été détectée après son apparition, sans divergence entre les historiques local et distant.

Effets constatés :

- ajout de `wallets.initial_balance numeric(14,2) NOT NULL DEFAULT 0` ;
- les lignes existantes reçoivent `0` lorsqu’aucun solde initial n’était connu, afin de ne pas inventer un montant historique ;
- `update_wallet_balance(uuid)` devient le seul recalcul matérialisé : solde initial fixe + mouvements non annulés de `finance_operations` ;
- la vue `finance_wallet_reconciliation` applique la même formule.

La formule réellement implémentée est :

```text
solde wallet = initial_balance
              + recettes + dépôts
              + transferts entrants
              - dépenses
              - transferts sortants
```

Les écritures de statut `CANCELLED` sont exclues. Les anciens synonymes `RECETTE`, `VERSEMENT`, `DEPENSE` et `TRANSFERT` restent pris en compte dans `update_wallet_balance` pour compatibilité historique; le journal unifié produit désormais les types normalisés.

Vérification distante au moment de l’audit : le wallet `WAVE` a `initial_balance = 0`, un journal net de `-3 500 000` et un solde stocké de `-3 500 000`; l’écart est nul. Le solde initial n’est donc pas doublement compté dans les données présentes.

### Risque et rollback

Le seul risque identifié serait de renseigner un `initial_balance` qui inclut déjà des opérations historiques toujours présentes dans `finance_operations`. La migration du Lot 8 ajoutera un test SQL de non-double-comptage et conservera le recalcul officiel. Aucun historique ne sera supprimé.

Un rollback sûr consiste à appliquer une **nouvelle** migration qui remet le solde initial concerné à `0`, puis exécute `update_wallet_balance(wallet_id)`. La colonne et la migration appliquée ne doivent pas être supprimées ni modifiées rétroactivement.

## Choix de conception du Lot 8

- `company_settings.timezone` reste la source de vérité du fuseau métier. Une seule colonne supplémentaire y définira l’heure quotidienne de génération.
- Une table spécialisée `notification_alert_rules` portera les règles d’alertes, sans créer une seconde table générique de paramètres.
- Les paramètres par entité restent sur leur entité : `inventory_items.seuil_alerte` pour le stock et une nouvelle colonne explicite de surcharge sur `wallets` pour les wallets.
- Les modifications de règles, seuils et heure seront validées par des RPC sécurisées et journalisées dans un audit spécialisé.
- Un journal `notification_generation_runs` enregistrera les exécutions manuelles, de secours, de test et planifiées.
- Le moteur SQL unique sera appelé par les Server Functions et par une Edge Function. Le tableau de bord ne sera plus qu’un fallback limité lorsque la dernière exécution réussie est trop ancienne.

## Planification serveur

La documentation Supabase actuelle confirme que la planification s’appuie sur `pg_cron` et, pour l’appel HTTP d’une Edge Function, sur `pg_net` avec les secrets stockés dans Vault. L’audit initial ne trouvait pas ces extensions; elles ont été activées après vérification de leur disponibilité sur le projet lié.

L’Edge Function `generate-notifications` est déployée. Elle exige l’en-tête `x-notification-scheduler-secret`, comparé en temps constant à `NOTIFICATION_SCHEDULER_SECRET`, exclusivement stocké parmi les secrets Supabase. La même valeur est stockée dans Vault sous `notification_scheduler_secret`; l’URL du projet est stockée sous `notification_scheduler_project_url`.

Le job `halal-erp-generate-notifications` est actif avec l’expression `0 6 * * *`. Avec le réglage métier actuel (`Africa/Dakar`, `06:00`), cette heure locale est aussi `06:00 UTC`. Son appel `pg_net` a été vérifié : réponse HTTP 200 de l’Edge Function, avec une exécution `SCHEDULED` journalisée et sans doublon.

La fonction `save_notification_general_settings` resynchronise ce job quand un administrateur change l’heure ou le fuseau. Le calcul se fait avec l’offset UTC à la date de modification. `Africa/Dakar` n’ayant pas d’heure d’été, le réglage actuel reste stable. Pour un futur fuseau avec heure d’été, un changement de saison nécessitera une resynchronisation de la planification : c’est le risque restant documenté, à traiter par un scheduler conscient des changements DST si ce cas devient métier.
