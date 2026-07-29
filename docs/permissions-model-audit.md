# Audit du modèle de permissions

Date : 29 juillet 2026. Sources : schéma Supabase distant lié, migrations jusqu'à `20260728194000`, types générés, Server Functions et routes authentifiées.

## État initial

- `public.user_roles(user_id, role)` est l'unique relation utilisateur-rôle. Elle accepte plusieurs lignes par utilisateur et impose `UNIQUE(user_id, role)`.
- Il n'existe pas de tables `roles`, `permissions` ni `role_permissions` dans la base distante. Les rôles sont un enum `public.app_role` et sont codés dans des politiques RLS, RPC et quelques Server Functions.
- Les rôles existants sont `super_admin`, `admin`, `gestionnaire`, `comptable`, `chauffeur`, `employe` et `lecture_seule`.
- `security_audit_log` journalise déjà les changements de `user_roles` par trigger, mais aucun catalogue de permissions n'existe et les changements de droits de rôle ne peuvent pas encore être audités.

## Utilisateurs à rôles multiples

La base distante contient un seul compte, avec les rôles `super_admin` et `lecture_seule`. La fonction historique `current_user_role()` applique une priorité (`super_admin` avant `lecture_seule`) et retourne donc `super_admin` pour ce compte. Les politiques basées sur `current_user_has_any_role()` appliquent déjà une union : la présence d'un rôle autorisé suffit.

Le modèle retenu pour ce lot rend cette règle explicite : **les permissions effectives sont l'union des permissions de tous les rôles actifs**. `lecture_seule` n'est pas une interdiction ; un compte cumulant `super_admin` et `lecture_seule` conserve tous les droits administrateur. Il ne peut donc pas servir de recette lecture seule.

## Contrôles existants et écarts

| Couche | Constat | Correction du lot |
| --- | --- | --- |
| RLS | Les politiques Lot 10 vérifient encore des tableaux de noms de rôle, notamment `gestionnaire`. | Les politiques métier ciblées vérifient désormais des codes de permission. |
| RPC finance | Les helpers `finance_require_write_role` et `business_finance_require_write_role` vérifient des rôles. | Ils sont réorientés vers `finance.*` et les permissions de leur événement métier. |
| Reporting / alertes | Quelques Server Functions calculent des booléens à partir de `user_roles`. | Elles lisent le résumé de permissions renvoyé par la base. |
| Interface | `/roles` est un placeholder ; les boutons de modules ne disposent pas encore de garde commune. | Une page d'administration, `usePermissions`, `Can` et `PermissionGuard` sont ajoutés. |
| Storage | L'upload privé peut laisser un objet orphelin si la création du document échoue. | Suppression compensatoire immédiate côté client et script d'inventaire/nettoyage à confirmation explicite. |

## Occurrences de rôles codés en dur

Les occurrences SQL sont classées ainsi :

- **système légitime** : maintien du dernier `super_admin`, gestion des rôles système, tâches internes et déclencheurs ;
- **métier à remplacer** : finance, wallets, salaires, opérations, stocks, exploitations, documents, contrats, paramètres, rapports et lecture de tables ;
- **affichage** : libellés de rôles et règles de notification ;
- **compatibilité transitoire** : anciennes fonctions `has_role`, `has_any_role` et migrations historiques, conservées pour ne pas casser les RPC déjà appliquées.

Les nouvelles politiques ne dépendent plus de `gestionnaire` comme raccourci administratif. Les fonctions historiques restent disponibles mais ne constituent plus la source de décision des nouveaux contrôles.

## Risques traités et ouverts

- L'ancienne priorité de `current_user_role()` ne doit jamais être utilisée pour calculer les permissions : la nouvelle API retourne l'union déterministe des codes.
- Les rôles `rh`, `operations`, `stocks` et `exploitations` n'existent pas encore dans l'enum ; une migration additive les ajoute sans toucher aux lignes existantes.
- Les rôles personnalisés ne sont pas compatibles avec un enum sans transformer le modèle d'identité. Ils ne sont pas simulés par une seconde architecture dans ce lot.
- Les contrôles UI restent ergonomiques ; la décision d'autorisation reste dans PostgreSQL/RLS/RPC.
