# Fondations du Design System HALAL ERP

Ce document décrit le socle visuel partagé de HALAL ERP. Il ne modifie aucune règle métier, requête, route ou permission : les écrans existants continuent d'utiliser les mêmes composants et APIs publiques.

## Principes

- Apparence sobre, lisible et durable : surfaces nettes, élévation discrète, vert profond et or comme accent secondaire.
- Une information importante est d'abord transmise par la hiérarchie, le texte et la structure ; la couleur complète le signal.
- Les interactions ont des durées de 120, 150 ou 180 ms. Les animations permanentes sont proscrites.
- Chaque primitive expose un focus visible et conserve les comportements clavier de Radix.

## Tokens

Les tokens se trouvent dans `src/styles.css` et sont disponibles en clair dans CSS ainsi que dans Tailwind :

- Couleurs : `background`, `surface`, `surface-elevated`, `surface-hover`, `border`, `primary`, `secondary`, `accent`, `success`, `warning`, `danger`, `info`, `muted`, `text-primary`, `text-secondary`, `text-muted`.
- Rayons : `xs`, `sm`, `md`, `lg`, `xl`, `2xl`.
- Espacements : 4, 8, 12, 16, 20, 24, 32, 40, 48 et 64 px via `--ds-space-*`.
- Ombres : `shadow-xs`, `shadow-sm`, `shadow-md`, `shadow-lg`.
- Motion : `transition-ui`, `transition-ui-fast`, `transition-ui-slow`, puis `animate-fade-in`, `animate-slide-in`, `animate-scale-in` et `animate-collapse-in`.

La police d'interface et de titres est Inter avec une pile `Inter Variable` prioritaire. Les utilitaires `text-display`, `text-h1` à `text-h4`, `text-body-sm`, `text-caption`, `text-label` et `text-overline` définissent la hiérarchie typographique.

## Primitives disponibles

Les primitives existantes restent les points d'entrée à utiliser :

- `Button` : variantes `default`/`primary`, `secondary`, `outline`, `ghost`, `danger`/`destructive`, `success`, `link`, `floating`; tailles d'icône incluses; état `loading` pour les boutons HTML.
- `Input`, `Textarea`, `Select` : mêmes hauteurs, bordures, focus et états invalides. Un champ date ou recherche s'obtient en utilisant respectivement `Input` avec `type="date"` ou `type="search"`.
- `Combobox` et son alias `Autocomplete` : sélecteur générique contrôlé qui retourne uniquement un identifiant.
- `Badge` : variantes historiques inchangées et variantes `neutral`, `success`, `warning`, `danger`, `info`, `premium`, avec apparences `soft`, `solid`, `outline`.
- `Card` : variantes `section`, `analytics`, `information`, `kpi`, `glass` et `compact`, sans modification de l'API par défaut.
- `DataTable` : table générique client avec recherche, tri, pagination, sélection, en-tête sticky et densités `compact`, `comfortable`, `relaxed`. Elle reçoit toujours ses données et colonnes par props et ne contient aucune logique ERP.
- Dialogues, menus, popovers, tooltips, tabs et commandes rapides utilisent les mêmes surfaces, rayon, ombres et focus.
- `PageHeader` et `SearchInput` préparent les en-têtes de page et barres de recherche à venir. La sidebar, les breadcrumbs, les tabs et `CommandDialog` restent les primitives de navigation et d'actions rapides.

## Thème

Les tokens clair et sombre font partie du socle. Le `ThemeProvider`, monté à la racine par le Product Shell, garde un premier rendu déterministe pour le SSR puis applique la préférence locale côté navigateur. En mode système, il suit immédiatement les changements de préférence du système d'exploitation sans toucher aux données ERP.

## Règles d'adoption

1. Réutiliser une primitive existante avant de créer un composant spécifique.
2. Utiliser les tokens sémantiques et les tailles du système, sans valeurs de rayon ou de durée ad hoc.
3. Conserver les données, mutations et permissions en dehors des primitives UI.
4. Utiliser Lucide pour les icônes et laisser la primitive contrôler leur taille par défaut.
5. Ne pas remplacer une vue métier pendant la phase fondation ; les migrations visuelles d'écrans seront faites par lots séparés.

## Limites connues

- Les écrans métier existants ne sont pas refondus ici. Ils bénéficieront des améliorations compatibles des primitives, mais leur composition reste inchangée.
- La `DataTable` est une fondation UI; l'adaptation des tableaux métier, leurs filtres et leurs sources de données reste hors périmètre.
- Les préférences de thème, de densité et de largeur de sidebar sont locales au navigateur ; elles ne constituent pas encore des préférences synchronisées par utilisateur.
