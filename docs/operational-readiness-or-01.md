# OR-01 — Recette opérationnelle et rapprochement financier

Date de contrôle : 2 août 2026.

## Périmètre contrôlé

- synchronisation des migrations Supabase ;
- journal `finance_operations` et solde matérialisé des wallets ;
- dépenses et paiements confirmés des Courses ;
- liens financiers explicites ;
- cohérence des calculs affichés dans Wallets et Activité chauffeur.

Ce contrôle ne modifie aucune écriture historique.

## Règle de calcul unique

Pour chaque wallet, le solde est calculé comme suit :

```text
solde initial
+ recettes et dépôts
+ transferts entrants
- dépenses
- transferts sortants
```

Les opérations annulées sont exclues. Une annulation de dépense ou de paiement est conservée dans l'historique et compensée par une contre-écriture ; elle n'est jamais effacée.

## Rapprochement HALAL VHC

Le contrôle distant donne un écart nul entre le solde enregistré et le solde recalculé.

| Élément | Montant |
| --- | ---: |
| Entrées du wallet | 219 300 FCFA |
| Sorties du wallet | 142 000 FCFA |
| Solde disponible | 77 300 FCFA |

Les montants sont cohérents :

```text
219 300 - 142 000 = 77 300 FCFA
```

Les `219 300 FCFA` d'entrées comprennent `189 300 FCFA` de paiements de Courses confirmés, plus une contre-écriture de `30 000 FCFA` liée à une dépense de Course annulée. Les `142 000 FCFA` de sorties comprennent `112 000 FCFA` de dépenses de Courses encore validées, plus l'écriture initiale de `30 000 FCFA` ensuite contre-passée. La paire de 30 000 FCFA a donc un effet net nul sur le wallet.

## Pourquoi l'écran Chauffeur affichait un autre résultat

La fiche Chauffeur applique une période de travail, alors que le solde du wallet est global par défaut.

Sur la période du 26 juillet au 2 août :

| Indicateur Chauffeur | Montant |
| --- | ---: |
| Encaissements de Courses confirmés | 189 300 FCFA |
| Dépenses de Courses confirmées dans la période | 107 000 FCFA |
| Résultat d'activité | 82 300 FCFA |

Une dépense carburant de `5 000 FCFA` est confirmée mais datée du **28 août 2026**. Elle est donc bien présente dans le journal et dans le solde global du wallet, mais elle est correctement exclue de la période qui se termine le 2 août. Sur l'ensemble des dépenses de Courses confirmées, le total est `112 000 FCFA` et le résultat devient `77 300 FCFA`.

Il ne s'agit pas d'un double débit : chaque dépense et chaque paiement confirmé possède une seule opération financière liée, avec montant identique et statut valide.

## Correctif de prévention

La migration `20260802110000_prevent_future_confirmed_course_cashflows.sql` empêche désormais de confirmer :

- une dépense de Course datée dans le futur ;
- un paiement client de Course daté dans le futur.

Ces opérations peuvent rester **prévues** ou **engagées**, mais elles ne peuvent plus modifier le wallet avant leur date effective.

## Données à régulariser avec décision métier

Les données suivantes ne sont pas corrigées automatiquement, car elles nécessitent de confirmer la réalité métier :

1. la dépense future de 5 000 FCFA : si la date est une erreur, elle doit être annulée par contre-écriture puis recréée avec la date réelle ; si elle représente un coût futur, elle doit être annulée puis recréée à l'état prévu ou engagé ;
2. quatre Courses de démonstration ont des factures et paiements confirmés tout en restant au statut `DRAFT` ; leur statut doit être régularisé seulement après validation de leur déroulement réel ;
3. une Course clôturée avec un solde client de 90 000 FCFA porte une dérogation historisée avec la justification `test`. Elle doit être conservée comme donnée de test ou examinée par un administrateur avant mise en production.
4. cinq wallets ont un solde négatif mais un écart de rapprochement nul : `HALAL AGR001`, `HALAL AGR002`, `HALAL MOTO 001`, `HALAL MOTO 002` et `HALAL MOTO 003`. Ils ne doivent pas être corrigés manuellement. Il faut confirmer, pour chacun, s'il s'agit d'un financement initial non enregistré, d'un dépôt à enregistrer ou d'une position réellement négative.

Ces points ne révèlent pas une divergence de wallet : ils sont des éléments de qualité des données et de cycle opérationnel.

## Contrôles techniques

- migrations locales et distantes : synchronisées au démarrage du contrôle ;
- écart des wallets : `0` wallet en écart ;
- écritures de Course confirmées sans lien financier valide : `0` ;
- les anciennes tables financières restent historiques et en lecture contrôlée ;
- les scripts de test transactionnels se terminent par `ROLLBACK` et ne conservent pas de données de test.

## Mise en service

Avant publication, exécuter les validations techniques puis traiter les quatre décisions de régularisation ci-dessus. Une fois les opérations de test identifiées ou régularisées, les chiffres Wallets, Finance, Courses et Chauffeurs sont réconciliables à partir du même journal financier.

Le dernier build Vercel généré par Nitro cible le runtime `nodejs24.x`, alors que `package.json` déclare actuellement Node `22.x`. Le build passe, mais la version Node configurée dans Vercel doit être alignée et vérifiée avant la publication afin d'éviter une différence entre intégration continue et production.
