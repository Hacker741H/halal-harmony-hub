# Tests de fumée de production

À exécuter sur l'URL Preview, puis à nouveau sur l'URL Production, avec des
comptes autorisés distincts. Noter l'URL, l'heure, le rôle et le résultat de
chaque ligne dans le ticket de mise en production.

## Accès et routage

- [ ] Connexion et déconnexion.
- [ ] Réinitialisation du mot de passe : lien reçu et retour vers le domaine de
      production, jamais `localhost`.
- [ ] Accès direct puis rechargement de `/dashboard`, `/vehicles`,
      `/documents` et `/reports`.
- [ ] Accès direct à une route protégée sans session : refus ou redirection
      attendue, sans fuite de données.

## Parcours ERP critiques

- [ ] Tableau de bord, employés, chauffeurs, véhicules, motos, exploitations,
      contrats et entretiens.
- [ ] Finance, wallets, stocks et rapports avec un rôle autorisé.
- [ ] Documents : upload privé, URL signée temporaire, téléchargement,
      remplacement, archivage et suppression selon permission.
- [ ] Notifications : affichage du badge, actions autorisées et absence de
      doublon après génération planifiée/manuelle.
- [ ] Rôles et permissions : un rôle non autorisé ne reçoit pas les montants ou
      actions sensibles dans les réponses réseau.

## Contrôles techniques

- [ ] Pas d'erreur CORS dans la console ou les journaux Vercel/Supabase.
- [ ] Les appels RPC autorisés fonctionnent ; les appels interdits sont refusés
      par Supabase, pas seulement masqués dans l'interface.
- [ ] Aucun en-tête, token ni clé `service_role` dans les réponses réseau ou le
      JavaScript servi au navigateur.
- [ ] Vérifier l'exécution indépendante du navigateur du scheduler et son
      dernier état dans `notification_generation_runs`.
- [ ] Comparer un total Finance avec le rapport de gestion selon les mêmes
      filtres.

## Critère d'acceptation

Tout échec bloquant (authentification, données sensibles, upload privé,
routes profondes, RPC, scheduler) suspend la promotion en production jusqu'à
correction et nouvelle exécution de cette checklist.
