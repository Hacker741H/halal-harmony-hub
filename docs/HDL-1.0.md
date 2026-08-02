# HALAL Design Language 1.0

## Objet

HDL est le langage de design officiel de HALAL ERP. Il donne une grammaire commune aux interfaces de gestion : calme, précise, lisible et durable. Il s'applique aux primitives UI, au Product Shell et aux écrans métier, sans modifier leurs données, leurs permissions ni leur logique.

La source technique des tokens est [`src/styles.css`](../src/styles.css). Les composants de référence se trouvent dans `src/components/ui` et les composants de cadre dans `src/components/shell`.

## Philosophie

HALAL ERP doit inspirer la confiance d'un outil de gestion utilisé toute la journée.

- **La clarté précède la décoration.** Une valeur, une action et un état doivent se comprendre avant tout effet visuel.
- **La hiérarchie révèle les priorités.** Les alertes, montants et actions importantes gagnent de l'espace ; le bruit visuel en perd.
- **La profondeur reste fonctionnelle.** Bordures, surfaces et ombres servent à séparer les niveaux, jamais à créer un décor lourd.
- **Le mouvement confirme une action.** Les transitions expliquent un changement d'état ; elles ne sont jamais permanentes ni distrayantes.
- **Le système est inclusif par défaut.** Le contraste, le clavier, les lecteurs d'écran et la réduction des animations font partie de la définition d'un composant terminé.

## Principes UX

1. Montrer l'état réel avant de proposer une action.
2. Ne jamais présenter une absence de donnée ou une erreur comme un zéro confirmé.
3. Utiliser des libellés métiers explicites ; éviter les termes décoratifs ou ambigus.
4. Conserver une action principale par zone et limiter les actions secondaires visibles.
5. Préserver le contexte lors de la navigation : titre, fil d'Ariane, filtres et retour doivent rester compréhensibles.
6. Préférer les données sources aux scores arbitraires. Une synthèse doit indiquer les signaux qui la composent.
7. Utiliser la couleur comme renfort, jamais comme seul porteur de sens.

## Architecture des tokens

Les tokens internes commencent par `--ds-`. Ils alimentent les alias sémantiques consommés par Tailwind et les composants.

| Niveau | Règle |
| --- | --- |
| Fondation | `--ds-space-*`, `--ds-radius-*`, `--ds-shadow-*`, `--ds-duration-*` définissent l'échelle. |
| Sémantique | `--surface-*`, `--text-*`, `--border-*`, `--success`, `--warning`, etc. décrivent l'intention. |
| Composant | Les composants utilisent des classes sémantiques comme `bg-surface`, `text-muted-foreground`, `border-border` ou `shadow-sm`. |

Ne pas introduire une couleur hexadécimale, une ombre arbitraire ou une durée numérique dans un composant lorsqu'un token couvre le besoin.

## Couleurs

| Token | Usage |
| --- | --- |
| `background` | Canevas global de l'application. |
| `surface` | Surface standard : carte, formulaire, menu. |
| `surface-sunken` | Zone en retrait, arrière-plan de groupe ou contrôle inactif. |
| `surface-elevated` | Surface au premier plan, telle qu'une zone de cockpit. |
| `surface-hover` | État de survol ou élément sélectionnable discret. |
| `border-subtle` / `border` / `border-strong` | Séparation légère, standard, puis structurante. |
| `primary` | Action principale et identité HALAL ERP. |
| `gold` | Accent premium, employé avec parcimonie. |
| `success` | État favorable confirmé. |
| `warning` | Élément à anticiper ou à surveiller. |
| `destructive` | Erreur, danger ou action irréversible. |
| `info` | Information utile sans urgence. |
| `overlay` | Voile des dialogues et panneaux superposés. |
| `text-primary`, `text-secondary`, `text-muted` | Hiérarchie de lecture, jamais simple décoration. |

Les modes clair et sombre redéfinissent ces variables. Un composant ne doit donc pas remplacer ces tokens par une couleur fixe.

## Espacement et mise en page

L'échelle de base est : **4, 8, 12, 16, 20, 24, 32, 40, 48 et 64 px**.

| Intention | Référence |
| --- | --- |
| Élément interne compact | 4–8 px |
| Libellé et contrôle | 8–12 px |
| Contenu de carte | 16–24 px |
| Séparation de sections | 24–32 px |
| Respiration de page | 32–64 px |

- Utiliser `gap`, `space-y` et `p-*` issus de cette échelle.
- La largeur maximale de contenu est définie par `--ds-content-max-width` ; utiliser `max-w-(--ds-content-max-width)` pour les pages de pilotage.
- Les hauteurs de contrôle de référence sont `--ds-control-height-sm`, `--ds-control-height-md` et `--ds-control-height-lg`.
- Les valeurs arbitraires restent admises uniquement pour une contrainte de structure démontrée (par exemple une hauteur Radix calculée ou un ratio visuel), jamais pour contourner l'échelle.

## Typographie

La police est **Inter Variable**. `text-display` et les titres utilisent `--font-display` ; le contenu courant utilise `--font-sans`.

| Style | Usage |
| --- | --- |
| `text-display` | Salutation, titre de cockpit, information dominante. |
| `text-h1` | Titre de page. |
| `text-h2` | Grand groupe ou zone majeure. |
| `text-h3` | Titre de carte ou de section. |
| `text-h4` | Sous-section et titre compact. |
| `text-body-sm` | Texte opérationnel et descriptions. |
| `text-caption` | Métadonnée, date, aide courte. |
| `text-label` | Libellé de contrôle ou d'indicateur. |
| `text-overline` | Catégorie discrète, toujours courte. |

- Les chiffres financiers utilisent `tabular-nums` lorsque la comparaison compte.
- Les montants compacts doivent conserver la valeur complète dans un libellé accessible, une infobulle ou un titre.
- Ne pas utiliser une taille, une graisse ou un interlignage arbitraires lorsqu'un style HDL existe.

## Rayons, ombres et élévation

| Token | Usage |
| --- | --- |
| `radius-xs` / `radius-sm` | Indicateur, swatch, contrôle très compact. |
| `radius-md` | Bouton, champ, élément de liste. |
| `radius-lg` | Carte et menu. |
| `radius-xl` / `radius-2xl` | Zone de page, Hero ou composition majeure. |
| `shadow-xs` | Séparation très légère. |
| `shadow-sm` | Carte standard. |
| `shadow-md` | Élément interactif important ou Hero. |
| `shadow-lg` | Dialogues et surfaces réellement élevées. |

Une bordure sémantique est préférable à une ombre lourde. Les ombres ne doivent pas simuler une profondeur sans utilité.

## Animation et mouvement

Les durées autorisées sont :

- `--ds-duration-fast` : **120 ms** ;
- `--ds-duration-standard` : **150 ms** ;
- `--ds-duration-slow` : **180 ms**.

Utiliser `transition-ui-fast`, `transition-ui` ou `transition-ui-slow`. Les animations de composition disponibles sont `animate-fade-in`, `animate-slide-in`, `animate-scale-in` et `animate-collapse-in`.

- Animer uniquement l'opacité, la transformation ou un changement d'état perceptible.
- Ne pas utiliser `transition-all` dans les primitives lorsque les propriétés concernées sont connues.
- Ne pas créer d'animation permanente. L'unique exception est le curseur d'un champ OTP, défini par `--ds-duration-caret`.
- Toutes les animations doivent respecter `prefers-reduced-motion`; le socle désactive les transitions non essentielles dans ce mode.

## Composants de base

| Famille | Règle HDL |
| --- | --- |
| Boutons | Variantes Primary, Secondary, Ghost, Outline, Danger et Success. Toujours un état clavier, désactivé et chargement. |
| Formulaires | `Input`, `Textarea`, `Select`, `Combobox`, recherche et date partagent hauteur, rayon, focus et erreurs sémantiques. |
| Cartes | Utiliser les variantes `analytics`, `section`, `information`, `kpi`, `glass` ou `compact` avant de créer une nouvelle carte locale. |
| Badges | Employer `neutral`, `success`, `warning`, `danger`, `info` ou `premium` avec une apparence `soft`, `solid` ou `outline`. |
| Tableaux | `DataTable` porte les états de densité, tri, sélection, pagination, surcharge et ligne interactive. |
| Dialogues | `Dialog`, `AlertDialog`, `Drawer`, `Sheet`, `Popover` et `DropdownMenu` utilisent `overlay`, `surface`, les rayons HDL et des durées normalisées. |
| Navigation | Sidebar, Header, Breadcrumbs, Tabs et Command Palette constituent le Product Shell. Aucune page métier ne doit recréer son propre cadre. |
| États | Les squelettes signalent un chargement ; les états vides expliquent ce qui manque et l'action possible ; les erreurs ne masquent pas les données défaillantes. |

## Responsive

- **Desktop** : densité et comparaison rapide ; les tableaux restent le format privilégié.
- **Tablette** : les zones secondaires passent sous le contenu principal ; conserver les actions essentielles visibles.
- **Mobile** : transformer les lignes complexes en blocs lisibles plutôt que de compresser les colonnes.
- Prévoir `min-w-0`, `truncate`, retour contrôlé à la ligne et valeurs financières compactes pour les textes longs.
- Les surfaces de lecture ne doivent jamais provoquer de défilement horizontal de page.

## Accessibilité WCAG

- Viser au minimum le niveau **WCAG AA** pour texte, icônes et contrôles.
- Toute action iconique possède un nom accessible ou un libellé visuel.
- Le focus est visible via `ring` et ne doit jamais être supprimé sans alternative équivalente.
- Le clavier doit atteindre et activer chaque action, menu, dialogue et élément de tableau interactif.
- Les statuts associent couleur, icône et texte explicite.
- Les montants, dates et métriques conservent une alternative non tronquée pour les technologies d'assistance.
- Les interactions Radix conservent leurs rôles et attributs ARIA ; ne pas les remplacer par des conteneurs génériques.

## Conventions de nommage

- Les fichiers et composants réutilisables sont en `kebab-case` / `PascalCase` : `entity-table.tsx` exporte `EntityTable`.
- Préfixer les primitives génériques par leur rôle : `PageHeader`, `SearchInput`, `DataTable`, `EntityDocumentsTab`.
- Nommer les variantes selon l'intention, pas selon la couleur : `danger`, pas `red`; `information`, pas `blue-card`.
- Nommer les composants locaux d'écran selon leur responsabilité : `CompanyHealthCard`, pas `RightPanel`.
- Les tokens internes utilisent `--ds-*`; les tokens consommés par les composants restent sémantiques (`--surface-*`, `--border-*`, `--text-*`).

## Exceptions documentées

- Les sélecteurs Recharts contenant `#ccc` et `#fff` restent limités à la compatibilité avec les attributs SVG par défaut de la bibliothèque. Ils ne constituent pas une palette produit et ne doivent pas être copiés dans de nouveaux composants.
- Les dimensions Radix calculées et certains ratios de visualisation peuvent rester arbitraires lorsque l'API de la bibliothèque les impose.
- Les composants métier historiques ne sont pas réécrits dans HDL 1.0. Ils adopteront les primitives au fil des lots, sans changement de comportement.

## Checklist avant livraison d'un écran

1. Utilise-t-il les surfaces, textes, bordures et états sémantiques ?
2. Les actions principales, chargements, vides et erreurs sont-ils explicites ?
3. Les données réelles sont-elles distinguées des calculs et des absences de données ?
4. Les tailles, espacements, rayons et transitions respectent-ils HDL ?
5. Le clavier, le focus, le contraste et la réduction des animations sont-ils vérifiés ?
6. Les changements passent-ils `npx tsc --noEmit`, `npm run build` et `git diff --check` ?

## Piste pour HDL 1.1

HDL 1.1 pourra formaliser des exemples visuels documentés, une grille de densité pour les tableaux, les règles de graphiques métiers et une stratégie de tests visuels. Ces éléments ne doivent être ajoutés qu'après validation d'au moins un module pilote utilisant HDL en production.
