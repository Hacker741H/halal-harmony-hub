# Sauvegarde et restauration

## Responsabilités et état

Supabase propose des mécanismes de sauvegarde dont la disponibilité, fréquence
et rétention dépendent de l'offre du projet. Aucun accès au tableau de bord
Supabase n'est disponible ici : une sauvegarde active ne doit donc pas être
présumée. Le responsable de production doit confirmer ces paramètres avant le
go-live et consigner la date du dernier test de restauration.

## Base de données

1. Avant une migration ou un changement sensible, créer un point de restauration
   ou un export conforme aux capacités de l'offre Supabase.
2. Conserver les exports chiffrés dans un emplacement restreint, avec une durée
   de conservation définie par l'entreprise.
3. Pour une restauration, geler les écritures, confirmer le projet et l'horodatage,
   restaurer dans un environnement isolé d'abord, exécuter les contrôles RLS et
   les réconciliations Finance/Wallets, puis seulement restaurer la production.
4. Ne pas utiliser `supabase db reset` sur la production.

## Storage privé

Les fichiers Storage ne doivent pas être supposés inclus dans un export SQL.
Mettre en place un export périodique des objets privés avec leur chemin et leur
métadonnée `documents.storage_path`, chiffré et conservé séparément de la base.
Tester la restauration d'un document et la génération d'une URL signée.

## Vérification périodique

- [ ] Vérifier chaque mois le statut des backups Supabase et l'espace Storage.
- [ ] Tester une restauration au moins trimestriellement dans un projet isolé.
- [ ] Réconcilier les opérations financières, les soldes wallets et les objets
      Storage après le test.
- [ ] Documenter le RTO/RPO retenu par le métier ; ils ne sont pas encore définis
      dans le dépôt.
