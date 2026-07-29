# Contrôles des opérations financières

Le projet ne contient pas encore de runner de tests front-end. Les contrôles de base sont fournis dans [`scripts/verify-finance-journal.sql`](../scripts/verify-finance-journal.sql) et les scénarios ci-dessous sont à exécuter avec un compte possédant le rôle `gestionnaire`, `comptable`, `admin` ou `super_admin`.

| Scénario | Vérification attendue |
| --- | --- |
| Création d'une recette | une ligne `REVENUE`, le wallet augmente, la vue Recettes et Finance l'affichent |
| Création d'une dépense | une ligne `EXPENSE`, le wallet diminue, la vue Dépenses et Finance l'affichent |
| Création d'un versement | une ligne `DEPOSIT`, le wallet augmente, la vue Versements et Finance l'affichent |
| Transfert entre wallets | une ligne `TRANSFER`, source diminuée et destination augmentée du même montant |
| Modification du montant | l'opération existante est modifiée, aucun doublon, les wallets sont recalculés |
| Changement de wallet | ancien et nouveau wallets sont recalculés |
| Suppression | l'opération et son lien sont supprimés dans la même transaction, les wallets sont recalculés |
| Backfill réexécuté | les liens explicites empêchent toute deuxième migration de ligne historique |
| Fiche liée | les dépenses d'exploitation se lisent depuis `farm_id`; les achats véhicules se lisent depuis `vehicle_id` et `finance_links` |
| RLS | lecture authentifiée ; écriture finance et wallets limitée aux rôles financiers ; archives en lecture seule |

Le script transactionnel [`scripts/test-finance-operations.sql`](../scripts/test-finance-operations.sql) a été exécuté avec succès sur le projet distant ; il a contrôlé création recette/dépense, transfert, modification de montant, changement de wallet, suppression, cascade du lien, recalcul des wallets et réexécution du backfill avant de faire un rollback complet. Lors de ce lot, le navigateur de test n'avait aucune session authentifiée. Les tests interactifs de l'interface n'ont donc pas été lancés afin de ne pas contourner l'authentification ni créer de données de démonstration dans le projet distant. Les contrôles SQL, le typecheck et le build ont été exécutés avec succès.
