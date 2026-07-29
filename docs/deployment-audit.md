# Audit de déploiement — 2026-07-29

## État constaté

- Application : React 19, TanStack Start 1.168, Vite 8, TypeScript 5.8.
- La commande de production est `npm run build` (`vite build`), et la CI exécute
  également `npx tsc --noEmit`.
- `vite.config.ts` utilise le wrapper officiel Lovable. Le wrapper accepte une
  option Nitro et, sans option, cible Cloudflare. La configuration du projet
  fixe désormais explicitement `nitro: { preset: "vercel" }` : c'est nécessaire
  pour que Nitro émette une sortie compatible Vercel hors de Lovable.
- Le package déclare Node `22.x`, identique à la CI. Nitro sélectionne le runtime
  Vercel à partir du Node qui lance le build ; Vercel doit donc être configuré
  pour construire avec Node 22. La surface typée du wrapper Lovable ne permet
  pas de transmettre l'option Nitro `vercel.functions.runtime` directement.
- Il n'existait pas de `vercel.json`. Aucun n'est ajouté : le preset Nitro porte
  déjà la configuration de runtime et de routage. Un `vercel.json` statique ne
  doit être ajouté que si Vercel remonte un besoin précis après le premier build.
- Une Edge Function Supabase `generate-notifications` existe. Elle utilise le
  secret `NOTIFICATION_SCHEDULER_SECRET`; elle n'est pas une Server Function
  Vercel et doit rester déployée/lancée depuis Supabase.
- Le projet Supabase lié contient toutes les migrations locales : la commande
  `npx supabase migration list --linked` a retourné 39 paires local/remote
  concordantes le 2026-07-29. Cette vérification ne prouve pas que ce projet est
  le projet Supabase de production : confirmer son environnement dans le
  tableau de bord avant toute mise en ligne.
- Une CI minimale GitHub Actions est présente dans `.github/workflows/ci.yml` :
  installation verrouillée, typecheck et build. Elle n'exécute ni migration ni
  déploiement.
- Validation locale : typecheck réussi et build Vercel généré dans
  `.vercel/output` avec `config.json` et une fonction `__server.func`. Aucun
  artefact Cloudflare n'est présent dans cette sortie. La machine locale utilise
  Node 24 et génère donc localement `nodejs24.x`; le build Vercel doit être
  contrôlé une fois avec Node 22 avant promotion.
- Performance : le bundle client principal pèse environ 728 kB minifié (210 kB
  gzip) ; le rapport est chargé séparément (environ 399 kB minifié). Cet
  avertissement ne bloque pas Vercel, mais un découpage additionnel du shell
  applicatif devra être étudié après mesure réelle de l'expérience utilisateur.
- Audit npm : `npm audit --omit=dev` ne remonte aucune vulnérabilité de
  production. L'audit complet remonte cinq vulnérabilités élevées uniquement
  dans la chaîne de développement ESLint (`eslint`, `@eslint/eslintrc`,
  `@eslint/config-array`, `minimatch`, `brace-expansion`) avec correctif
  disponible. Planifier cette mise à jour dans une maintenance dédiée, sans
  appliquer `npm audit fix --force` avant revue.

## Variables et secrets

La liste exacte est dans [environment-variables.md](environment-variables.md).
Les seules variables injectables dans le navigateur sont `VITE_SUPABASE_URL` et
`VITE_SUPABASE_PUBLISHABLE_KEY`. La clé `SUPABASE_SERVICE_ROLE_KEY` reste
exclusivement côté serveur ou dans les secrets Supabase.

Le fichier `.env` local a été retiré de l'index Git et est désormais ignoré,
sans suppression du fichier local. Il figure dans l'historique au commit
`ddbd2fd`; considérer toute clé qui a pu y figurer comme potentiellement
exposée et la remplacer avant production. Cette opération de retrait ne réécrit
pas l'historique (conforme à la contrainte Lovable).

## Préparation Vercel requise

1. Confirmer dans Vercel Node.js 22, `npm ci` comme installation et
   `npm run build` comme commande de build.
2. Définir les variables `VITE_*` dans les environnements Preview et Production.
   Définir les variables serveur sans préfixe `VITE_` uniquement là où les
   Server Functions les exigent.
3. Lancer un déploiement Preview et vérifier que la sortie Nitro Vercel est
   reconnue. Ne déployez pas une sortie contenant une configuration Wrangler.
4. Après validation Preview, lancer `vercel --prod`, puis configurer l'URL dans
   Supabase Auth avant de tester les parcours authentifiés.

Commandes, à lancer par un administrateur Vercel connecté :

```powershell
npm install --global vercel
vercel login
vercel link
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_PUBLISHABLE_KEY production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_PUBLISHABLE_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel --prod
```

Ajouter `NOTIFICATION_SCHEDULER_SECRET` à Vercel uniquement si une Server
Function Vercel l'utilise réellement. Le scheduler actuel le consomme côté Edge
Function Supabase, via les secrets Supabase, pas côté navigateur.

## Risques à lever avant go-live

- Aucun accès Vercel n'est disponible dans cet environnement : aucun projet,
  domaine ou déploiement réel n'a été créé.
- L'URL réellement liée à Supabase peut être un environnement de travail plutôt
  que la production ; elle doit être confirmée manuellement.
- Le projet ne possède pas encore de suite E2E automatisée. Les contrôles
  fonctionnels à exécuter après déploiement sont dans
  [production-smoke-tests.md](production-smoke-tests.md).
- L'artefact de build doit être contrôlé après le changement de preset Nitro
  avant le premier déploiement Vercel.
