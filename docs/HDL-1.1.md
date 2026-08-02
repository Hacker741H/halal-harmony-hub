# HDL 1.1 — Design Showcase

## Rôle

Le Design Showcase est la référence interne et vivante du HALAL Design Language. Il est conçu pour les équipes design et développement : il ne constitue pas un écran métier et n’est alimenté par aucune donnée de l’ERP.

La route `/_authenticated/design-showcase.tsx` produit l’URL `/design-showcase`. Elle reste volontairement absente de la navigation et ne rend ses démonstrations qu’en développement (`import.meta.env.DEV`). En production, les utilisateurs authentifiés reçoivent un état générique ne contenant aucune démo. Ce choix évite d’ajouter une permission, une requête ou un mécanisme d’autorisation parallèle.

## Référence des démonstrations

Le composant `src/components/design-showcase/design-showcase-page.tsx` rassemble des démonstrations strictement locales pour :

- fondations : palette sémantique, typographie, spacing, radius, ombres et durées ;
- actions : variantes, tailles, états désactivés et chargement ;
- champs : Input, Textarea, Select, Combobox, date, recherche et OTP ;
- surfaces : cartes Analytics, KPI, Glass, Compact, Section et Information ;
- badges : les six familles et les trois apparences ;
- overlays : Dialog, Drawer, Popover, Dropdown, Tooltip et Alert Dialog ;
- DataTable : recherche, tri, sélection, pagination et colonnes responsives ;
- navigation : sidebar, header, breadcrumbs, tabs, recherche et Command Palette simulés ;
- retours : banner, toast, empty state, skeleton et progression ;
- graphiques : barres, aires, ligne et camembert ;
- formulaires : validation locale, erreur, succès et chargement ;
- motion, icônes Lucide et états d’accessibilité.

Chaque cadre de démonstration affiche les tokens liés et propose un aperçu de code copiable. Les extraits sont des indications d’usage, pas des composants métier.

## Conventions HDL 1.1

- Les données de démonstration sont déclarées localement et ne proviennent ni de Supabase, ni de React Query, ni d’un hook métier.
- Les nouvelles démos réutilisent les primitives de `src/components/ui/`. Elles ne créent pas une seconde bibliothèque de composants.
- Les couleurs ont une intention sémantique (`primary`, `success`, `warning`, `danger`, `info`) et les statuts critiques associent texte, icône et couleur.
- Les interactions démontrées gardent un focus visible, un libellé accessible et un comportement clavier issu des primitives Radix existantes.
- Les animations restent déclenchées par une interaction ou un rendu ponctuel, durent au plus 180 ms et respectent `prefers-reduced-motion`.
- Les écrans Showcase utilisent les tokens HDL (`--ds-space-*`, `--ds-radius-*`, `--surface-*`, `--ds-duration-*`) plutôt que de créer de nouvelles valeurs de présentation.

## Usage futur

Avant d’introduire ou de modifier une primitive générique, l’équipe doit :

1. vérifier l’API publique du composant existant ;
2. documenter la variante dans le Showcase si elle est réutilisable ;
3. s’appuyer sur les tokens HDL, sans ajouter de valeur arbitraire ;
4. valider le comportement clavier, les contrastes et les états vide/chargement/erreur.

Le Showcase ne remplace pas les tests fonctionnels des modules métier. Il sert de laboratoire visuel stable pour les composants génériques uniquement.
