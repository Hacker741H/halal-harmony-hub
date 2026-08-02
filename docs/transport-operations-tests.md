# Tests — exploitation transport

Le script transactionnel [test-transport-operations.sql](../scripts/test-transport-operations.sql) couvre le processus opérationnel ajouté par EXP-01. Il doit être exécuté sur une base liée après application de `20260801140000_add_transport_operations.sql` :

```powershell
npx supabase db query --linked --file scripts/test-transport-operations.sql
```

Le script commence par `BEGIN` et termine systématiquement par `ROLLBACK` : il ne conserve ni client, ni Course, ni véhicule, ni chauffeur de test.

## Cas couverts

1. présence des quatre RPC opérationnelles et refus de leur exécution par `anon` ;
2. RLS toujours active sur `transport_missions` ;
3. affectation valide véhicule + chauffeur, avec événement d’audit `ASSIGN` ;
4. refus d’un chevauchement véhicule ;
5. refus d’un chevauchement chauffeur ;
6. checklist de départ valide ;
7. départ confirmé, statut `IN_PROGRESS` et kilométrage de départ ;
8. seconde confirmation de départ idempotente ;
9. refus d’un kilométrage d’arrivée incohérent ;
10. livraison complète, statut `COMPLETED` et événement `DELIVERY` ;
11. incident conservant la Course `IN_PROGRESS` ;
12. correction administrateur, remise en cours sans effacer l’historique et événement `CORRECT`.

## Limites des tests SQL

Supabase Storage ne peut pas être contrôlé entièrement dans une transaction SQL. La migration vérifie toutefois qu’un document choisi comme preuve est déjà lié à la Course par `document_transport_mission_links`. Le téléversement et la signature de l’URL restent couverts par le module Documents existant ; une recette manuelle doit vérifier l’ajout d’un document de livraison dans l’onglet Documents puis sa sélection lors de la livraison.

## Recette manuelle recommandée

Avec un compte Opérations : créer ou sélectionner une Course planifiée, l’affecter, vérifier qu’un conflit est refusé, confirmer le départ, puis confirmer une livraison. Avec un administrateur : annuler une confirmation de livraison avec justification. Avec un compte Lecture seule : vérifier que les quatre espaces sont consultables mais qu’aucune action de mutation n’apparaît.
