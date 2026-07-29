# Checklist sécurité avant production

## Secrets

- [x] `.env` est ignoré et retiré de l'index Git sans effacer le fichier local.
- [ ] La clé `SUPABASE_SERVICE_ROLE_KEY` historique a été remplacée. Le fichier
      `.env` figure dans l'historique du commit `ddbd2fd`, donc toute valeur qui
      y a figuré est considérée exposée jusqu'à rotation.
- [ ] Remplacer également `NOTIFICATION_SCHEDULER_SECRET` si elle a été stockée
      localement ou partagée hors d'un gestionnaire de secrets.
- [ ] Vérifier que Vercel ne reçoit aucune variable secrète préfixée `VITE_`.
- [ ] Les variables de scripts de recette sont absentes de Vercel Production.
- [ ] Les comptes de test sécurité sont supprimés après recette.
- [ ] Ne pas exécuter `supabase secrets list` dans un terminal partagé : selon
      la version du CLI, la réponse comprend un champ de valeur ou de
      fingerprint. Contrôler les noms de secrets depuis le tableau de bord
      Supabase à accès restreint.

## Contrôles applicatifs et Supabase

- [ ] RLS et permissions testées avec des comptes séparés.
- [ ] Bucket documents privé, téléchargements par URL signée uniquement.
- [ ] Service role utilisée seulement par des Server Functions, scripts contrôlés
      ou Edge Functions ; jamais par le bundle navigateur.
- [ ] RPC sensibles autorisées uniquement à `authenticated`/rôles appropriés,
      jamais à `anon` sans nécessité formellement documentée.
- [ ] Les logs Vercel, Supabase et Edge Functions ne contiennent aucun token,
      cookie ou en-tête d'autorisation.

## Dépendances

- [x] `npm audit --omit=dev` : aucune vulnérabilité de production signalée au
      2026-07-29.
- [ ] Revoir la mise à jour disponible de la chaîne ESLint : l'audit complet
      remonte cinq vulnérabilités élevées de développement. Ne pas utiliser
      `npm audit fix --force` sans revue de compatibilité.

## Vérification avant promotion

```powershell
npx tsc --noEmit
npm run build
git ls-files -- .env .env.local .env.production .env.development
rg -n --glob '!node_modules/**' "SUPABASE_SERVICE_ROLE_KEY|NOTIFICATION_SCHEDULER_SECRET" .vercel\output\static
```

La deuxième commande peut trouver le nom d'une variable dans du code mort ou de
diagnostic ; cela ne constitue pas une fuite de valeur. Vérifier surtout qu'aucune
**valeur** de secret configurée ne se retrouve dans `.vercel/output/static`, par
comparaison locale sans imprimer les valeurs. Ces contrôles ne remplacent pas la
rotation des clés historiques.
