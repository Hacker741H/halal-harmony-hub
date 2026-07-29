# Tests des automatisations métier-finance

## Test SQL transactionnel

Exécuter :

```powershell
supabase db query --linked --file scripts/test-business-finance-automation.sql
```

Le script crée uniquement des références de test dans une transaction, se place
sous un rôle métier existant, puis termine par `ROLLBACK`. Il couvre :

- récolte encaissée, modification du montant et du wallet, annulation ;
- entretien moto et véhicule avec dépense, modification ou annulation ;
- achat de moto et annulation ;
- paiement de salaire avec mise à jour et annulation ;
- achat de stock, changement de wallet et montant, annulation ;
- unicité des liens, wallets recalculés et retrait de la politique RLS
  permissive historique.

Résultat du 28 juillet 2026 : succès, aucune ligne persistante créée.

## Vérifications manuelles à effectuer avec une session authentifiée

L’environnement automatisé n’a pas de session applicative. Avec un compte
`super_admin`, `admin` ou `gestionnaire`, vérifier :

- entretien moto et véhicule avec coût, modification puis annulation ;
- moto achetée avec wallet ;
- récolte non encaissée puis encaissement par sélection du wallet ;
- paiement de salaire complet et partiel ;
- achat et vente de stock ;
- présence de chaque écriture dans Finance et cohérence des wallets ;
- absence de doublon après plusieurs modifications consécutives.
