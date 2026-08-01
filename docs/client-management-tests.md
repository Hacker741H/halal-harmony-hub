# CRM-01 — Tests du référentiel Clients

## Périmètre vérifié

Le script [test-clients.sql](../scripts/test-clients.sql) vérifie le référentiel `transport_clients` après application de la migration `20260731110000_add_clients_reference.sql`. Il n'applique aucune migration, s'exécute dans une transaction puis exécute un `ROLLBACK` : aucune fiche Client de test n'est conservée.

## Exécution contrôlée

```powershell
npx supabase db query --linked --file scripts\test-clients.sql
```

Exécuter cette commande uniquement sur un environnement où la migration CRM-01 a déjà été appliquée. Le script recherche un compte actif `super_admin` existant afin de tester les RPC avec `auth.uid()`. S'il n'en trouve pas, il valide le schéma et la sécurité statique puis indique explicitement que les mutations n'ont pas pu être testées ; il ne crée aucun compte.

## Cas SQL couverts

| Cas | Vérification |
|---|---|
| Création | Numéro Client unique, pays initial `SN`, audit `CREATE`. |
| Modification | Mise à jour via `update_client`, jamais par écriture navigateur directe. |
| Archivage / restauration | Statuts `ACTIVE` et `ARCHIVED`, audit des deux opérations. |
| Doublons | Détection exacte par téléphone, avec exclusion du Client édité. |
| Fusion | Transaction, archivage de la source, conservation de la cible et audit `MERGE`. |
| Finances | Valeurs indisponibles tant que les tables Missions/Factures/Paiements n'existent pas ; aucune valeur zéro fictive. |
| TVA | `company_settings.vat_enabled` reste à `false` par défaut. |
| RLS / rôles | Présence de la politique de lecture, absence d'exécution `anon`, absence de droit `DELETE` direct pour `authenticated`. |
| Relations | Présence de la liaison explicite `document_transport_client_links`. |
| Rollback | Toutes les données de test sont annulées à la fin du script. |

## Limites intentionnelles

- Le test SQL ne crée pas de fichier Storage : Supabase Storage est une API objet, hors transaction PostgreSQL. Les parcours upload/téléchargement privé doivent être testés depuis l'interface avec un fichier non sensible et une URL signée.
- Les tests multi-rôles réels requièrent les comptes de test distincts du Lot 11. Le script vérifie les garde-fous SQL et peut tester les mutations avec un `super_admin` existant, mais ne fabrique pas d'identités ni de JWT.
- Les scénarios Missions, Factures et Paiements sont volontairement hors CRM-01. Ils seront ajoutés à la suite de l'implémentation MT et remplaceront les états « indisponible » de la fiche Client.

## Recette applicative recommandée

1. Se connecter avec un rôle disposant de `clients.create` puis créer un Client Sénégalais avec ou sans NINEA/RCCM.
2. Créer un second Client avec le même téléphone, e-mail, NINEA ou une raison sociale proche et confirmer l'avertissement de doublon.
3. Modifier, archiver puis restaurer un Client non fusionné.
4. Avec un administrateur, fusionner un doublon vers la fiche conservée et vérifier l'historique des deux fiches.
5. Avec un rôle sans `clients.financial.read`, confirmer l'absence de colonne et d'onglet financier exploitable.
6. Joindre un document depuis l'onglet Documents, vérifier son URL signée, puis confirmer l'absence d'URL publique.
7. Avec `lecture_seule`, contrôler que les actions de création, modification, archivage et fusion ne sont pas proposées et restent refusées par la base.
