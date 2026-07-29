# Audit final ERP — Lot 13

## Périmètre inspecté

- 37 routes, 90 composants, 30 modules `src/lib` et 39 migrations ;
- routes TanStack, hooks React Query, Server Functions, RPC PostgreSQL, RLS,
  Storage privé, permissions et scripts de recette ;
- build production et typecheck global.

## Constats

| Domaine | État | Dette / risque |
| --- | --- | --- |
| Architecture | Cohérente : routes, composants par module et Server Functions | Plusieurs écrans historiques restent volumineux et mélangent présentation/requêtes. |
| Données | Finance et relations explicites en place | Tables historiques conservées volontairement ; ne pas les supprimer sans procédure de rétention. |
| Sécurité | Permissions/RLS/RPC et Storage privé en place | Les migrations historiques contiennent des `USING (true)` ; elles sont remplacées par les migrations de durcissement plus récentes, à contrôler après toute restauration. |
| Performances | Pagination dans Documents et rapports ; agrégats SQL | Surveiller les fiches 360° : certaines agrègent plusieurs requêtes React Query au chargement. |
| Frontend | Typecheck et build réussissent | Quelques composants de fiche restent larges ; découpage futur possible sans changement métier. |
| Observabilité | Audit métier/sécurité et scripts disponibles | Centraliser les erreurs clientes vers un service de supervision avant production. |

## Nettoyage

Aucun fichier n'a été supprimé : le répertoire est déjà un worktree avec de
nombreux changements non liés. Les occurrences `@ts-nocheck` et `as any` sont
uniquement dans `src/routeTree.gen.ts`, fichier généré par TanStack Router.
Les `console.error` examinés sont des chemins d'erreur ou diagnostics, pas du
code mort certain.

## Optimisations utiles déjà présentes

- pagination des documents et requêtes de reporting côté PostgreSQL ;
- URLs Storage signées à durée limitée ;
- invalidation React Query après mutations ;
- index relationnels et d'échéance ajoutés par les migrations précédentes.

## Vérifications de non-régression

Les contrats TypeScript et le build traversent les routes Employés,
Chauffeurs, Véhicules, Motos, Exploitations, Maintenance, Stocks, Finance,
Wallets, Documents, Contrats, Notifications et Rapports. Les tests SQL déjà
présents couvrent RLS, relations, finance, notifications, reporting et
documents. Une recette manuelle multi-rôles reste nécessaire avant le premier
déploiement client.
