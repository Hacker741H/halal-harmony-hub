# Réconciliation financière — LOT 4

Exécutée le 28 juillet 2026 après les migrations de préparation, snapshot et backfill. Les contrôles sont issus des vues distantes `finance_legacy_migration_reconciliation` et `finance_wallet_reconciliation`.

## Run de migration

| Clé | Snapshot | Backfill | Statut |
| --- | --- | --- | --- |
| `legacy_finance_v1` | 2026-07-28 16:44:10 UTC | 2026-07-28 16:44:10 UTC | `BACKFILL_COMPLETE` |

Le snapshot contient 0 recette historique, 0 dépense historique, 0 paiement historique, 11 opérations du journal, 2 liens de finance et 5 wallets. Il est immuable : réexécuter la procédure de snapshot retourne le même run et ne l'écrase pas.

## Contrôle des archives migrées

| Source | Lignes avant | Montant avant | Lignes migrées | Montant migré | Écart lignes | Écart montant |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenues` | 0 | 0 FCFA | 0 | 0 FCFA | 0 | 0 FCFA |
| `expenses` | 0 | 0 FCFA | 0 | 0 FCFA | 0 | 0 FCFA |
| `payments` | 0 | 0 FCFA | 0 | 0 FCFA | 0 | 0 FCFA |

Il n'existe aucun écart, aucune ligne non migrée et aucune anomalie de mapping dans le snapshot courant. Aucun wallet historique n'était manquant puisque les trois sources étaient vides.

## Journal normalisé existant

Les 11 lignes qui existaient déjà dans `finance_operations` ont été conservées et normalisées, sans changement de montant :

| Type canonique | Lignes | Montant brut |
| --- | ---: | ---: |
| `REVENUE` | 1 | 45 000 FCFA |
| `EXPENSE` | 4 | 11 000 444 FCFA |
| `DEPOSIT` | 4 | 6 500 000 FCFA |
| `TRANSFER` | 2 | 55 000 FCFA |

La correspondance appliquée est : `RECETTE → REVENUE`, `DEPENSE → EXPENSE`, `VERSEMENT → DEPOSIT`, `TRANSFERT → TRANSFER`.

## Réconciliation des wallets

| Wallet | Solde avant/après stocké | Entrées | Dépenses | Transferts entrants | Transferts sortants | Solde calculé | Écart |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Epargne chez dady | 1 994 556 FCFA | 2 000 000 | 444 | 0 | 5 000 | 1 994 556 | 0 |
| ORANGE | -1 550 000 FCFA | 500 000 | 2 000 000 | 0 | 50 000 | -1 550 000 | 0 |
| VEH-001 | 5 000 FCFA | 4 000 000 | 4 000 000 | 5 000 | 0 | 5 000 | 0 |
| Versement MOTO | 95 000 FCFA | 45 000 | 0 | 50 000 | 0 | 95 000 | 0 |
| Wave business | -5 000 000 FCFA | 0 | 5 000 000 | 0 | 0 | -5 000 000 | 0 |

Tous les soldes stockés sont égaux aux soldes recalculés. Aucune correction manuelle de wallet n'a été appliquée.

## Anomalies et limites connues

- Les sources historiques sont vides. La procédure est néanmoins prête pour une restauration future : elle refuse de créer quoi que ce soit tant qu'un `default_wallet_id` n'est pas explicitement configuré dans `finance_legacy_migration_config`.
- Un futur `payment` de type autre que `entrant` ou `sortant` bloque le backfill et crée une anomalie de migration au lieu d'être deviné.
- Une relation polymorphe historique de recette ne devient une FK que si l'entité existe et appartient à un type reconnu. Dans le cas contraire, l'identifiant reste dans `finance_revenue_links` et une anomalie est signalée.

## Procédure de rollback

1. Identifier le `migration_run_id` de `legacy_finance_v1` dans `finance_migration_runs`.
2. Dans une transaction d'administration, consulter les six tables `finance_legacy_snapshot_*` de ce run.
3. Supprimer uniquement les liens `finance_revenue_links`, `finance_expense_links`, `finance_payment_links` de ce run ; les opérations liées sont supprimées par cascade.
4. Restaurer les archives si nécessaire à partir de `row_data`, sans écraser une écriture active sans validation métier.
5. Exécuter `update_wallet_balance(wallet_id)` pour chaque wallet concerné et vérifier `finance_wallet_reconciliation` jusqu'à ce que l'écart soit nul.

Les tables `revenues`, `expenses` et `payments` n'ont pas été supprimées et servent de référence historique pour ce rollback.
