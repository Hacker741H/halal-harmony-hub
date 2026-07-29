# Checklist Supabase Production

Cette liste est à exécuter sur le projet Supabase **de production**, après
confirmation de son identifiant et avant de pointer Vercel vers lui.

## Base de données et sécurité

- [ ] Créer/valider une sauvegarde avant toute nouvelle migration.
- [ ] Exécuter `npx supabase migration list --linked` depuis un poste relié au
      projet de production et vérifier que local et remote concordent.
- [ ] Vérifier que RLS est activée sur toutes les tables métier et que les
      politiques actuelles correspondent à `docs/security-rls-audit.md`.
- [ ] Exécuter les tests de sécurité prévus avec des comptes distincts ; ne pas
      utiliser le compte super-admin pour simuler la lecture seule.
- [ ] Vérifier les droits `EXECUTE` des RPC et le `search_path` des fonctions
      `SECURITY DEFINER`.
- [ ] Vérifier que `revenues`, `expenses`, `payments` et `stocks` historiques
      sont en lecture seule pour les utilisateurs applicatifs.

## Storage, Edge Function et scheduler

- [x] L'instance liée expose `generate-notifications` (version 3, statut
      `ACTIVE` au 2026-07-29). Sa vérification JWT est désactivée de façon
      intentionnelle car son code exige le secret constant-time
      `x-notification-scheduler-secret`; ne rendez jamais cette fonction
      publiquement appelable sans ce contrôle.
- [x] Les noms des secrets requis par cette fonction sont configurés dans
      l'instance liée. Ne lancez pas `supabase secrets list` dans un terminal ou
      un journal partagé : cette commande affiche un champ de valeur/fingerprint
      selon la version du CLI.
- [ ] Vérifier que le bucket de documents est privé et que ses politiques ne
      rendent aucune URL publique.
- [ ] Vérifier les URLs signées et l'accès refusé pour un utilisateur non
      autorisé.
- [ ] Déployer la fonction si nécessaire :

```powershell
npx supabase functions deploy generate-notifications
npx supabase secrets set NOTIFICATION_SCHEDULER_SECRET=<valeur-secrète>
```

- [ ] Configurer le mécanisme planifié côté Supabase avec l'en-tête
      `x-notification-scheduler-secret`. Confirmer le résultat dans
      `notification_generation_runs` ; la simple présence de la fonction ne
      prouve pas qu'un schedule est actif.
- [ ] Vérifier que les logs Edge Function et les journaux de génération ne
      contiennent ni JWT ni clé API.

## Auth et URLs

Dans **Supabase Dashboard → Authentication → URL Configuration**, renseigner :

- Site URL : `https://<projet-vercel>.vercel.app` pendant la phase initiale,
  puis le domaine final HTTPS.
- Redirect URLs : `http://localhost:8080/**`, l'URL Vercel Preview nécessaire,
  et `https://<domaine-production>/**`.

Après chaque changement, tester connexion, déconnexion, invitation ou reset
mot de passe et vérifier que le lien envoyé ne contient pas `localhost` en
production.

## Changement contrôlé

Ne lancez jamais `supabase db push` depuis la CI. Après sauvegarde et revue :

```powershell
npx supabase db push
npx supabase migration list --linked
```

La première commande modifie la base : elle requiert une validation humaine et
la confirmation explicite du projet lié.
