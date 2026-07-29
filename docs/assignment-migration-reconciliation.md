# Réconciliation du backfill des affectations

Exécutée le 28 juillet 2026 après l'application de `20260728180000_add_entity_relations_360.sql`.

| Contrôle | Avant (`driver_id`) | Après (affectation active) | Écart |
| --- | ---: | ---: | ---: |
| Véhicules avec chauffeur | 1 | 1 | 0 |
| Motos avec chauffeur | 0 | 0 | 0 |

Les deux documents historiques portant un lien polymorphe valide ont également produit deux liaisons documentaires explicites.

La migration ne renseigne aucune date inventée : une éventuelle reprise dont la date de début est inconnue conserve `start_date = NULL` et est marquée dans `notes`. Aucun véhicule ni moto sans chauffeur historique n'a reçu d'affectation.

## Réexécution et restauration

Le backfill utilise `NOT EXISTS` avec l'index unique d'affectation active : une réexécution ne crée pas de doublon. Les colonnes historiques `vehicles.driver_id` et `motorcycles.driver_id` ne sont ni supprimées ni modifiées par le backfill. En cas de rollback métier, elles restent donc disponibles ; les nouvelles tables peuvent être ignorées sans perte des affectations d'origine.
