# Préparation production ERP

## État actuel

Le projet compile et produit un build Nitro/Vite. Les modules ERP sont reliés
à Supabase, avec RLS, permissions métier, journal financier, Storage privé et
URLs de document signées.

## Checklist avant déploiement

1. Configurer les secrets Supabase uniquement côté serveur et déployer les Edge
   Functions prévues.
2. Créer les comptes de recette distincts, exécuter les scripts de sécurité et
   les retirer après validation.
3. Vérifier les migrations sur une sauvegarde/restauration avant production.
4. Mettre en place supervision des erreurs, sauvegardes Supabase, rotation des
   clés et procédure de restauration.
5. Réaliser une recette manuelle multi-rôles et une vérification mobile.

## Niveau estimé

**Prêt pour une préproduction contrôlée.** Le déploiement production est
recommandé après la recette multi-rôles réelle et la confirmation opérationnelle
des règles documentaires, financières et de rétention des archives.

## Risques restants

- Le bundle contient des chunks de plus de 500 kB : surveiller le chargement
  mobile et découper les écrans lourds si les métriques le justifient.
- Les politiques historiques doivent rester suivies après toute restauration de
  base ; les migrations de durcissement sont la source de sécurité finale.
- La cohérence inter-systèmes Storage/PostgreSQL repose sur des compensations
  et le script d'inventaire des objets orphelins.
