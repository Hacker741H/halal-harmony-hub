# Audit des données de reporting

Date de l'audit : 28 juillet 2026.
Projet Supabase contrôlé : `iljetumzbqtrjvtdlynj`.
Fuseau de présentation retenu : `Africa/Dakar`.

## Périmètre et principe

Les rapports de gestion lisent les données opérationnelles existantes : ils ne
créent ni copie de reporting, ni écriture financière. `finance_operations` est
la seule source financière : les tables historiques `revenues`, `expenses` et
`payments` ne font pas partie de ce périmètre.

Les chiffres ci-dessous sont un état de la base distante au moment de l'audit,
obtenu avec un rôle d'administration de projet. Ils ne constituent pas une
garantie comptable légale.

| Domaine | Source principale | Volume observé | Dates / montants utilisables | Relations exploitables | Limites et qualité |
| --- | --- | ---: | --- | --- | --- |
| Finance | `finance_operations` | 2 | `operation_date`, `amount`, `type`, `status`, catégorie, module | wallet, wallet destination, véhicule, moto, chauffeur, employé, exploitation, récolte, entretien, stock, contrat | Les deux lignes observées sont `DEPOSIT` (1 500 000 FCFA) et `EXPENSE` (3 500 000 FCFA), toutes deux `VALIDE`. Les opérations `CANCELLED` doivent être exclues. |
| Liens financiers | `finance_links` et liens explicites du lot 5 | liés aux opérations | date de création | achats véhicule, récolte, entretiens, achat moto, salaires, mouvements de stock | `finance_links` reste un lien générique historique ; les rapports de coût privilégient les clés étrangères de `finance_operations` et les tables de liens explicites. |
| Wallets | `wallets`, `finance_wallet_reconciliation` | 1 | `initial_balance`, `balance`, `alert_threshold` | `finance_operations.wallet_id` et `destination_wallet_id` | Le solde agrégé enregistré est -2 000 000 FCFA. Les écarts doivent être signalés, jamais corrigés par un rapport. |
| Véhicules | `vehicles` | 1 | achat, kilométrage, statut, création | chauffeur courant et affectations, opérations `vehicle_id`, entretiens `maintenances` | Les coûts ne peuvent être calculés que depuis des opérations explicitement liées. Aucune rentabilité véhicule n'est calculable sans recette liée. |
| Motos | `motorcycles` | 2 | achat, kilométrage, statut, dates assurance / visite | chauffeur courant et affectations, opérations `motorcycle_id`, `motorcycle_maintenances` | Les coûts reposent sur les liens financiers explicites ; aucune rentabilité n'est inférée. |
| Chauffeurs | `drivers`, `driver_vehicle_assignments`, `driver_motorcycle_assignments` | 1 | statut, permis, dates d'affectation | `employee_id`, affectations, opérations `driver_id`, paiements de salaire | Une seule source personnelle est `employees`; pas de score subjectif de performance. |
| Employés et salaires | `employees`, `salary_payments` | 1 / 0 | poste, statut ; `paid_at`, `amount`, `period_start`, `status` | chauffeur facultatif, contrat, wallet et finance par liens explicites | Pas de salaire versé observé. Les salaires théoriques (`salaire_base`) ne sont pas des dépenses ni des montants versés. |
| Exploitations | `farms`, `harvests` | 1 / 0 | superficie, statut ; récolte : date, quantité, prix, montant | opérations `farm_id`, `harvest_id`, wallet de vente | Une récolte n'est une recette que si une opération `REVENUE` liée existe. La marge est une marge de gestion, jamais un bénéfice comptable officiel. |
| Entretiens véhicule | `maintenances` | 0 | date, coût, kilométrage, type | entité véhicule via `entity_type` / `entity_id`, opération `maintenance_id` | Relation historique polymorphe : les rapports la limitent à `entity_type = 'VEHICLE'`. |
| Entretiens moto | `motorcycle_maintenances` | 0 | `maintenance_date`, `cost`, kilométrage, prochaines échéances | `motorcycle_id`, opération `motorcycle_maintenance_id` | Les coûts financiers sont disponibles uniquement lorsqu'une dépense liée existe. |
| Stocks | `inventory_items`, `stock_movements` | 1 / 0 | stock actuel, seuil, quantité, prix unitaire, date, type et statut | mouvement vers article, wallet et opération `inventory_item_id` | Pas de valorisation fiable tant qu'aucun prix unitaire de mouvement n'est renseigné. Entrées/sorties physiques et flux financiers doivent rester distincts. |
| Contrats et documents | `contracts`, `documents` | 1 / 3 | dates de début/fin, montant indicatif, statut ; émission/expiration/archive | relations explicites créées au lot 6, plus champs historiques `entity_type/entity_id` | Le montant d'un contrat n'est pas une recette/dépense sans opération financière liée. |
| Alertes | `notifications` et tables de liens | 1 | gravité, statut, échéance, lecture/résolution | route et liens explicites vers entités | Les alertes sont filtrées par RLS et par destinataire. Les temps de résolution ne sont calculables que pour les notifications résolues. |
| Historique | `business_finance_audit` | 14 | action, horodatage, avant/après, auteur | opération liée quand disponible | Support de traçabilité ; pas un journal financier secondaire. |

## Relations, sécurité et dates

`finance_operations` possède des clés étrangères vers les wallets (source et
destination), véhicules, motos, chauffeurs, employés, exploitations, récoltes,
les deux modèles d'entretien, articles de stock et contrats. Les affectations
chauffeur-véhicule et chauffeur-moto sont normalisées dans des tables
historiques explicites. `drivers.employee_id` lie le profil métier à
l'employé.

Les dates de mouvement sont des `date`, sans heure. Les bornes de période sont
donc calculées au calendrier `Africa/Dakar`, inclusives, avant d'être
transmises à PostgreSQL. `created_at` sert à l'audit mais pas à dater un flux
de gestion lorsqu'une date métier existe.

Le RLS actuel autorise encore la lecture directe de plusieurs tables métier à
tout utilisateur authentifié, y compris `finance_operations`, `wallets` et
`salary_payments`. Le centre de rapports ne doit pas dépendre de cette
permissivité : les RPC de reporting doivent vérifier le rôle avant de renvoyer
les agrégats ou les lignes détaillées. Les rôles disponibles sont
`super_admin`, `admin`, `gestionnaire`, `comptable`, `chauffeur`, `employe` et
`lecture_seule`.

## Indicateurs réalisables maintenant

- recettes, dépenses, dépôts, transferts, flux net et nombre d'opérations ;
- répartition temporelle, par catégorie, module, wallet et statut ;
- rapprochement wallet : solde initial, soldes enregistrés et mouvements du
  journal ;
- coûts explicitement liés des véhicules et motos ;
- affectations en cours, statuts et entretiens ;
- récoltes physiques, recettes encaissées liées, dépenses liées et marge de
  gestion ;
- niveaux de stock, seuils, mouvements physiques, achats et ventes liés ;
- échéances de contrats/documents et alertes par gravité/statut.

## Indicateurs volontairement indisponibles

- consommation carburant : aucun journal de carburant, litre ou kilométrage
  consommé n'est disponible ;
- rentabilité véhicule/moto : aucune recette n'est obligatoirement reliée à un
  actif ;
- valorisation et rotation de stock fiables : aucun coût unitaire fiable n'est
  encore observé dans les mouvements ;
- bilan légal, résultat comptable légal, taxes et amortissements : le projet ne
  contient ni plan comptable, ni écritures débit/crédit, ni clôtures ;
- salaire « attendu / impayé » fiable : les périodes dues et échéances ne sont
  pas modélisées de façon suffisante ; seuls les paiements réalisés sont
  reportables.

## Risques à traiter par l'implémentation

1. Les contraintes relationnelles ajoutées sur `finance_operations` sont
   encore marquées `NOT VALID` pour plusieurs entités historiques. Les
   rapports doivent gérer les références nulles et ne doivent pas déduire un
   lien depuis une description.
2. Les relations historiques polymorphes de `maintenances`, `contracts` et
   `documents` sont conservées pour compatibilité. Les tableaux de coût et les
   drill-downs privilégient les FK et tables de relations explicites quand elles
   existent.
3. Les petits volumes actuels ne prouvent pas les performances de production.
   Les index ajoutés doivent correspondre aux filtres réellement exécutés, sans
   créer de copie matérialisée prématurée.
4. Les exports doivent être générés à partir de résultats déjà autorisés par
   le serveur : aucune colonne salariale ou financière ne doit être filtrée
   seulement dans le navigateur.
