# Audit UX — Premium Transport Experience

Date : 1er août 2026
Périmètre : interfaces `/courses` et `/courses/$courseId` uniquement. Aucune règle métier, requête, mutation, permission, route ou écriture financière n’est concernée.

## État observé

### Liste des Courses

- La page propose déjà la recherche, les filtres client/chauffeur/véhicule/statut/période, la pagination et le respect de `missions.finance.read`.
- Les informations importantes sont présentes mais réparties dans une table horizontale, ce qui ralentit la lecture d’une Course sur tablette et mobile.
- Il n’existe pas de requête d’agrégats filtrés par période. Les indicateurs de l’en-tête ne doivent donc pas se présenter comme des totaux de l’entreprise : ils seront clairement limités aux Courses visibles dans la page courante.
- Les données de tendance ne sont pas fournies par le contrat existant. Aucune tendance ne sera inventée.

### Fiche Course

- La fiche contient déjà les données nécessaires : client, itinéraire, véhicule, chauffeur, budgets, dépenses, factures, paiements, résumé financier calculé, documents et historique.
- La première vue affiche des métriques, mais elle ne met pas assez en relation le transport, l’encaissement et les dépenses.
- Les paiements et l’historique sont fonctionnels mais présentés comme de simples listes.
- Les documents sont servis par `EntityDocumentsTab`. La fiche Course ne reçoit pas directement les métadonnées et aperçus nécessaires pour construire une galerie locale sans ajouter de requête ; ce composant relationnel restera la source unique de vérité.

## Risques et garde-fous

- Les montants ne sont affichés que lorsque `missions.finance.read` est déjà accordée.
- Les totaux de l’interface sont des regroupements de présentation des lignes déjà chargées ; ils ne remplacent ni ne modifient les calculs financiers et les valeurs calculées côté RPC.
- Les actions existantes, leurs permissions, leurs mutations et leurs confirmations sont préservées à l’identique.
- Les états chargement, vide et erreur doivent rester explicites et ne pas afficher de zéro comme donnée confirmée.

## Plan UX retenu

1. Ajouter un hero de liste avec un filtre de période existant et des indicateurs contextualisés à la page visible.
2. Transformer le tableau en liste de cartes compactes, avec une grille dense sur grand écran et une lecture verticale sur mobile.
3. Recomposer la fiche comme un cockpit : identité opérationnelle, situation financière, progression d’encaissement, budget par catégorie et timeline.
4. Réemployer exclusivement les primitives existantes (Card, Badge, Button, Tabs, Progress, Skeleton et EntityDocumentsTab), les tokens HDL et les icônes Lucide.
5. Respecter `prefers-reduced-motion`, le focus clavier et les libellés accessibles.

## Hors périmètre

- Nouveaux agrégats de période, nouvelles requêtes, nouvelles notifications, génération de documents ou aperçu fichier personnalisé.
- Changement des calculs de budget, de résultat, de paiement, de wallet, de rentabilité ou des statuts.
- Modification du module Documents ou des composants métier extérieurs à Courses.
