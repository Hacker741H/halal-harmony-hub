# Catalogue des métriques de gestion

Ce catalogue est la définition unique des indicateurs du centre de rapports.
Il s'applique au fuseau `Africa/Dakar` et aux bornes de date inclusives. Sauf
indication contraire, les opérations dont `status = 'CANCELLED'` sont exclues.
Les montants sont affichés en FCFA (`fr-FR`) ; les rapports sont des rapports
de gestion, et non des états comptables légaux.

| Métrique | Formule et sources | Filtres / statuts | Confidentialité | Drill-down |
| --- | --- | --- | --- | --- |
| Recettes | Somme de `finance_operations.amount` où `type = 'REVENUE'` | période, wallet, catégorie, module et relations ; hors `CANCELLED` | finance : admin, super_admin, comptable | `/finance?type=REVENUE` avec les filtres |
| Dépenses | Somme où `type = 'EXPENSE'` | mêmes règles | finance : admin, super_admin, comptable | `/finance?type=EXPENSE` |
| Dépôts | Somme où `type = 'DEPOSIT'` | mêmes règles | finance : admin, super_admin, comptable | `/finance?type=DEPOSIT` |
| Transferts internes | Somme où `type = 'TRANSFER'`, présenté séparément | mêmes règles ; n'affecte pas le flux net entreprise | finance : admin, super_admin, comptable | `/finance?type=TRANSFER` |
| Flux net de gestion | recettes + dépôts − dépenses. Les transferts internes sont neutres au niveau global. | mêmes règles | finance : admin, super_admin, comptable | opérations filtrées de la période |
| Nombre d'opérations | Nombre des lignes financières non annulées | mêmes règles | finance : admin, super_admin, comptable | opérations filtrées |
| Évolution mensuelle | Agrégation mensuelle Dakar des recettes, dépenses, dépôts et flux net | période | finance : admin, super_admin, comptable | mois et opérations correspondants |
| Solde wallet recalculé | `initial_balance + REVENUE + DEPOSIT + transferts entrants − EXPENSE − transferts sortants` | hors `CANCELLED`, par wallet | trésorerie : admin, super_admin, comptable | `/wallets/$walletId` puis opérations |
| Écart wallet | `wallets.balance − solde wallet recalculé` | par wallet | trésorerie : admin, super_admin, comptable | wallet et opérations associées |
| Coût total véhicule | Somme des dépenses non annulées avec `vehicle_id` explicite ; achat et entretiens sont inclus lorsqu'ils ont ce lien | période optionnelle | opérations : admin, super_admin, gestionnaire ; montants réservés finance | `/vehicles/$vehicleId` |
| Coût total moto | Somme des dépenses non annulées avec `motorcycle_id` explicite | période optionnelle | opérations : admin, super_admin, gestionnaire ; montants réservés finance | `/motorcycles/$motorcycleId` |
| Coût moyen mensuel actif | coût total explicite / nombre de mois civils distincts contenant une dépense liée | période ; non affiché sans dépense | même règle que coût actif | fiche de l'actif |
| Entretien réalisé | Nombre et coût des entretiens véhicule/moto avec date métier dans la période | tables d'entretien ; coût financier seulement si opération liée | opérations : admin, super_admin, gestionnaire | fiche véhicule ou moto |
| Chauffeur / employé | affectation actuelle, contrats, documents, alertes et nombre d'opérations liées | périodes pour opérations ; pas de score de performance | opérations/RH : admin, super_admin, gestionnaire ; salaire réservé finance | `/drivers/$driverId`, `/employees/$employeeId` |
| Salaires versés | Somme des `salary_payments.amount` non annulés et/ou dépenses finance explicitement liées | `paid_at`, statut réel ; aucun salaire théorique | admin, super_admin, comptable | fiche employé/chauffeur et opération source |
| Récolte physique | quantité de `harvests.quantite_kg`, par produit/exploitation | `date_recolte` | opérations : admin, super_admin, gestionnaire | `/farms/$farmId` |
| Recettes exploitation | Somme des recettes non annulées avec `farm_id` explicite | période | finance + exploitation autorisée | opérations filtrées puis exploitation |
| Dépenses exploitation | Somme des dépenses non annulées avec `farm_id` explicite | période | finance + exploitation autorisée | opérations filtrées puis exploitation |
| Marge de gestion exploitation | recettes explicitement liées − dépenses explicitement liées | période ; ce n'est pas un bénéfice comptable | finance + exploitation autorisée | opérations filtrées puis exploitation |
| Stock disponible | `inventory_items.stock_actuel` | article, catégorie | opérations / stocks : admin, super_admin, gestionnaire | `/stocks?itemId=…` |
| Stock sous seuil / à zéro | `stock_actuel <= seuil_alerte` / `stock_actuel <= 0` | seuil défini, article actif | opérations / stocks : admin, super_admin, gestionnaire | article et mouvements |
| Entrées/sorties physiques | Somme signée des `stock_movements.quantity` par type de mouvement, hors annulés | période, article, statut | opérations / stocks : admin, super_admin, gestionnaire | mouvements de stock |
| Achats / ventes de stock | Opérations finance explicitement liées aux mouvements d'achat/vente | période, article, wallet | finance + stocks autorisés | opération et mouvement source |
| Contrats et documents | Comptages par statut et échéance ; document archivé exclu de l'actif | dates de fin/expiration | opérations/RH selon entité | contrat, document ou fiche liée |
| Alertes | Comptage par gravité et statut, notifications non résolues | date d'échéance / création ; visibilité RLS | seulement les notifications visibles au rôle/utilisateur | `/notifications` avec filtre |

## Filtres partagés

Les fonctions reçoivent un objet strict et limité à : `startDate`, `endDate`,
`walletId`, `operationType`, `category`, `status`, `driverId`, `employeeId`,
`vehicleId`, `motorcycleId`, `farmId`, `inventoryItemId` et `search`.
L'interface ajoute les périodes prédéfinies Aujourd'hui, Cette semaine, Ce
mois, Mois précédent, Ce trimestre, Cette année et Période personnalisée. Les
filtres de rapport sont enregistrés dans l'URL et, si l'utilisateur le choisit,
dans son rapport enregistré ; les résultats ne sont jamais stockés.

## Règles d'explication des totaux

Chaque carte de total pointe vers une liste paginée d'opérations sources avec
le même filtre. Les coûts d'actif et marges d'exploitation n'utilisent jamais
un texte libre : une FK de `finance_operations` ou un lien métier explicite
est exigé. Les transferts sont visibles en trésorerie, mais ne sont ni recettes
ni dépenses globales. Toute valeur non calculable est affichée comme
« Donnée non disponible », accompagnée de la donnée source manquante.
