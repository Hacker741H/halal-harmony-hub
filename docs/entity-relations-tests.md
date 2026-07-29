# Tests relationnels — lot 6

## Test SQL transactionnel

Exécuter :

```powershell
npx supabase db query --linked --file scripts/test-entity-relations.sql
```

Le script utilise un acteur `super_admin`, `admin` ou `gestionnaire`, crée ses données de test dans une transaction et termine par `ROLLBACK`.

Il vérifie :

1. le profil chauffeur lié à un employé sans duplication d'identité ;
2. l'affectation véhicule, la réaffectation, la clôture et la projection `vehicles.driver_id` ;
3. l'unicité d'une affectation active par véhicule ;
4. l'affectation et la clôture d'une moto ;
5. la création puis l'archivage d'un document et sa liaison explicite ;
6. un contrat lié simultanément à un employé et un véhicule ;
7. les politiques RLS de lecture indispensables.

## Contrôles manuels à effectuer avec une session authentifiée

1. Ouvrir `/drivers/$driverId`, affecter un véhicule puis ouvrir sa fiche.
2. Depuis le véhicule, vérifier le lien vers le chauffeur et clôturer l'affectation.
3. Affecter une moto, puis vérifier l'historique dans les deux fiches.
4. Ajouter un document depuis une fiche employé, chauffeur, véhicule, moto ou exploitation.
5. Créer un contrat depuis `/contracts` et confirmer qu'il apparaît dans la fiche liée.
6. Vérifier que les onglets salaires et finances n'affichent que les données autorisées par la session.
7. Actualiser directement chaque URL de fiche pour valider le chargement par identifiant.
