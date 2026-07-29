# HALAL Harmony Hub

## Publication en production

La commande suivante prépare et publie les changements locaux sur `main` :

```bash
npm run deploy:prod
```

Elle effectue, dans cet ordre :

1. vérification de la branche `main` et synchronisation avec `origin/main` ;
2. blocage des fichiers sensibles, temporaires ou de sauvegarde ;
3. exécution de `npx tsc --noEmit` ;
4. exécution de `npm run build` ;
5. affichage du statut et du diff Git ;
6. demande d’un message de commit et d’une confirmation explicite `PUBLIER` ;
7. indexation, commit, puis `git push origin main`.

Pour fournir le message à l’avance :

```bash
npm run deploy:prod -- --message "fix: description de la correction"
```

Pour exécuter tous les contrôles sans indexer, committer ni pousser :

```bash
npm run deploy:prod -- --dry-run --message "test: vérification locale"
```

La commande refuse les chemins `.env` (à l’exception de `.env.example` et `.env.sample`), `.vercel`, les clés privées, les fichiers de secrets, ainsi que les fichiers temporaires et de sauvegarde. Elle ne force jamais un push et ne réécrit jamais l’historique Git.

Avant de confirmer, relisez le diff affiché : tous les changements locaux non ignorés seront inclus dans le commit.
