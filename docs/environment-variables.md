# Variables d’environnement

| Variable | Visibilité | Environnement | Usage |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | publique, injectée au build | Vercel Preview/Production et local | URL du projet Supabase côté navigateur. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publique | Vercel Preview/Production et local | Clé publishable Supabase côté navigateur. |
| `SUPABASE_URL` | serveur | Vercel, scripts, Edge Function | URL Supabase des Server Functions et tâches. |
| `SUPABASE_PUBLISHABLE_KEY` | serveur non secrète | Vercel | Middleware d’authentification SSR. |
| `SUPABASE_SERVICE_ROLE_KEY` | secret serveur | Vercel, Supabase Edge Function, scripts administratifs | Administration, jamais préfixée `VITE_`. |
| `NOTIFICATION_SCHEDULER_SECRET` | secret serveur | Supabase Edge Function / planificateur | Authentifie l’invocation du scheduler. |
| `ALLOW_SECURITY_TEST_USERS` | secret/opérationnel | scripts locaux seulement | Garde explicite des comptes de recette. |
| `SUPABASE_ANON_KEY` | publique, compatibilité script | scripts de recette uniquement | Repli historique de `scripts/test-security-users.ts`; préférer `SUPABASE_PUBLISHABLE_KEY`. Ne pas définir si le script n'est pas exécuté. |
| `SECURITY_TEST_EMAIL_DOMAIN` | opérationnel | scripts locaux seulement | Domaine réservé aux comptes de recette, sans donnée réelle. |
| `ALLOW_DOCUMENT_ORPHAN_CLEANUP` | secret/opérationnel | script local seulement | Garde explicite de la suppression effective des fichiers Storage orphelins. La valeur par défaut doit rester `false`. |

Ne mettez aucune valeur réelle dans `.env.example`. Dans Vercel, les variables
`VITE_*` sont publiques par conception ; tous les secrets doivent rester sans
préfixe `VITE_` et être limités aux Server Functions.

Les variables `SUPABASE_SERVICE_ROLE_KEY`, `NOTIFICATION_SCHEDULER_SECRET`,
`ALLOW_SECURITY_TEST_USERS` et `ALLOW_DOCUMENT_ORPHAN_CLEANUP` ne doivent jamais
être définies dans les environnements Vercel Preview ou Production sauf besoin
serveur documenté. Les scripts administratifs doivent être lancés depuis un
poste contrôlé, avec des variables temporaires supprimées aussitôt après usage.
