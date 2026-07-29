# Tests — notifications et alertes ERP

Le script [test-notifications-alerts.sql](../scripts/test-notifications-alerts.sql)
est transactionnel et se termine par un `ROLLBACK`. Il crée des données de test
temporaires et couvre :

1. permis chauffeur expirant ;
2. contrat expirant ;
3. document expirant ;
4. assurance et visite technique moto ;
5. entretien moto dépassé par date et kilométrage ;
6. wallet négatif puis retour à un solde normal ;
7. stock faible puis réapprovisionnement ;
8. déduplication après deux générations ;
9. report (`SNOOZED`) ;
10. résolution automatique ;
11. relations explicites ;
12. RLS avec un super administrateur et un rôle `lecture_seule`.

Dans la base liée, `super_admin` et `lecture_seule` sont actuellement attribués
au même compte. Le script utilise donc un sujet JWT non privilégié synthétique
pour vérifier qu'une alerte privée reste invisible, sans créer de ligne dans
`auth.users` pendant le test transactionnel.

Le test suppose qu'un utilisateur `super_admin` et un utilisateur
`lecture_seule` existent — c'est le cas de la base liée lors de l'audit. Il ne
peut pas produire une échéance salariale : aucune périodicité ni date de salaire
exigible n'existe dans le modèle actuel.

## Vérification manuelle à effectuer avec une session authentifiée

1. Ouvrir le tableau de bord avec un rôle gestionnaire et constater le bloc
   **Centre d’alertes**.
2. Ouvrir **Notifications**, cliquer **Actualiser les alertes**, puis filtrer
   par gravité et statut.
3. Ouvrir la fiche liée depuis une alerte ; vérifier le badge non lu dans la
   navigation.
4. Marquer une alerte lue, la reporter à une date future, la résoudre puis
   l’ignorer dans un jeu de données de test.
5. Modifier une date d’expiration ou réapprovisionner un stock ; actualiser les
   alertes et vérifier la résolution automatique.
6. Répéter avec un rôle `lecture_seule` et vérifier qu’aucune alerte financière
   ou salariale non adressée à cet utilisateur n’est visible.
