# Réconciliation de la migration de permissions

Date : 29 juillet 2026. Migration concernée :
`20260729091000_add_granular_permissions.sql`.

## Méthode

L'état antérieur reposait sur `public.user_roles` et des contrôles de noms de
rôles. La migration est additive : elle conserve toutes les lignes de
`user_roles`, crée le catalogue `roles`, `permissions` et `role_permissions`,
et attribue les permissions par rôle. Aucun utilisateur, mot de passe, rôle ou
donnée métier n'est supprimé.

Les droits effectifs sont l'union des permissions des rôles actifs. Un rôle
sans permission de mutation ne retire donc pas les permissions données par un
autre rôle. Cela confirme que le compte actuel `super_admin + lecture_seule`
reste administrateur et ne peut pas valider un scénario lecture seule.

## Écart avant / après par rôle

| Rôle | Avant | Après | Justification |
| --- | --- | --- | --- |
| `super_admin` | accès global selon le nom du rôle | toutes les permissions du catalogue, rôle système protégé | Administration et sécurité globales ; dernier compte protégé. |
| `admin` | accès large selon les politiques | administration fonctionnelle, sans gestion des super administrateurs ni audit sécurité | Réduit l'escalade de privilège. |
| `comptable` | finance et wallets selon contrôles dispersés | finance, wallets, salaires autorisés et rapports finance ; pas de documents RH sensibles | Séparation Finance/RH. |
| `rh` | inexistant | employés, chauffeurs, contrats, documents sensibles et salaires autorisés | Responsabilité RH explicite. |
| `operations` | inexistant | véhicules, motos, affectations et entretiens ; pas de salaires ni finance générale | Responsabilité opérationnelle explicite. |
| `stocks` | inexistant | articles, mouvements, alertes et rapports stocks ; pas de wallets ni salaires | Responsabilité Stock explicite. |
| `exploitations` | inexistant | exploitations, récoltes, documents agricoles et finance liée | Responsabilité agricole explicite. |
| `gestionnaire` | raccourci très large dans les politiques | véhicules, motos, exploitations, contrats, documents non sensibles, notifications et rapports opérations | Réduction volontaire : pas de wallets, salaires, écriture finance, paramètres ni administration de rôles. |
| `lecture_seule` | lecture variable suivant les politiques | uniquement des permissions de lecture explicites ; aucun export sensible et aucune mutation | Lecture sans effet de bord. |
| `chauffeur` / `employe` | accès minimal historique | tableau de bord et notifications propres | Compatibilité minimale en attendant des permissions individuelles métier. |

## Vérifications réalisées

- Les migrations `20260729090000`, `20260729091000`, `20260729092000` et
  `20260729093000` ont été appliquées au projet Supabase lié.
- Les types Supabase ont été régénérés à partir de ce schéma distant.
- `current_user_permissions()`, `user_has_permission()`,
  `user_has_any_permission()` et `user_has_all_permissions()` utilisent
  `auth.uid()` et l'union SQL des rôles.
- Les modifications de permissions et d'attributions utilisent des RPC
  sécurisées et sont journalisées dans `security_audit_log`.

## Limites de la réconciliation

- Les comptes de test distincts n'ont pas été créés : les variables serveur
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` et
  `ALLOW_SECURITY_TEST_USERS=true` n'étaient pas disponibles dans cet
  environnement. Les validations réelles par rôle restent donc à exécuter.
- Les rôles personnalisés, la duplication et l'archivage de rôles ne sont pas
  proposés : `user_roles.role` est un enum et il serait dangereux de créer une
  seconde architecture de rôles. Cette évolution nécessitera une migration de
  modèle dédiée et validée.
