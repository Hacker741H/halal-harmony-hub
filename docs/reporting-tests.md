# Tests du centre de rapports

## Automatisés SQL

Le script [test-reporting.sql](../scripts/test-reporting.sql) s'exécute dans
une transaction puis termine par `ROLLBACK`. Il sélectionne un rôle financier
autorisé et contrôle :

1. l'égalité entre le résumé Finance et `finance_operations` ;
2. l'exclusion d'une écriture `CANCELLED` ajoutée temporairement ;
3. la formule de rapprochement des wallets, y compris lorsqu'une période vide
   est sélectionnée ;
4. la pagination et le total des lignes de drill-down ;
5. le chargement de chaque rapport métier disponible ;
6. la création et la lecture RLS d'un rapport personnel enregistré.

Commande :

```powershell
npx supabase db query --linked --file scripts/test-reporting.sql
```

## Contrôles manuels à effectuer avec une session autorisée

1. Ouvrir `/reports`, puis chaque onglet visible pour le rôle courant.
2. Modifier la période et vérifier que l'URL conserve les filtres.
3. Comparer un total Finance avec la page Finance sur les mêmes filtres.
4. Filtrer par wallet puis ouvrir une opération source et sa fiche liée.
5. Vérifier qu'un écart wallet est seulement signalé, jamais corrigé.
6. Exporter le CSV filtré et vérifier les montants FCFA, le fuseau Abidjan et
   les métadonnées de génération. L'export est préparé côté Server Function et
   s'arrête à 10 000 lignes : au-delà, les filtres doivent être affinés.
7. Enregistrer un rapport personnel, le recharger, puis le supprimer.
8. Tester avec un rôle `gestionnaire` : pas de montants financiers ni de
   salaires ; avec `comptable` : Finance, trésorerie et salaires accessibles.
9. Vérifier l'affichage mobile, une période vide et les tableaux horizontaux.

L'environnement Codex ne possède pas de session applicative authentifiée ; ces
contrôles d'interface restent donc à faire par un utilisateur autorisé.
