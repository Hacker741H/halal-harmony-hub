# Réconciliation initiale des rapports de gestion

Contrôle exécuté le 28 juillet 2026 sur le projet Supabase lié, en excluant
`finance_operations.status = 'CANCELLED'`.

| Indicateur | Valeur source `finance_operations` | Valeur attendue dans le rapport |
| --- | ---: | ---: |
| Recettes | 0 FCFA | 0 FCFA |
| Dépenses | 3 500 000 FCFA | 3 500 000 FCFA |
| Dépôts | 1 500 000 FCFA | 1 500 000 FCFA |
| Transferts internes | 0 FCFA | 0 FCFA |
| Flux net | -2 000 000 FCFA | -2 000 000 FCFA |
| Nombre d'opérations | 2 | 2 |

## Wallet contrôlé

| Wallet | Solde initial | Solde enregistré | Solde calculé | Écart |
| --- | ---: | ---: | ---: | ---: |
| WAVE | 0 FCFA | -2 000 000 FCFA | -2 000 000 FCFA | 0 FCFA |

La formule contrôlée est :

```text
solde calculé = solde initial
              + recettes + dépôts + transferts entrants
              - dépenses - transferts sortants
```

La sélection d'une période filtre les flux affichés pour le wallet, mais ne
modifie jamais le solde calculé utilisé pour comparer le solde courant
enregistré. Cela évite de signaler artificiellement un écart pour une période
partielle.

Le script transactionnel de reporting vérifie automatiquement ces égalités,
l'exclusion des annulations et la pagination des lignes sources.
