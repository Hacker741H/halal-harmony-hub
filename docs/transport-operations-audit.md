# Audit — exploitation transport

Date : 1er août 2026
Périmètre : Planning, Affectations, Départs et Livraisons, exclusivement à partir du module **Courses** existant.

## Source de vérité existante

`transport_missions` est déjà l'entité opérationnelle unique d'une Course. Elle porte le client, le véhicule, le chauffeur, l'itinéraire, les dates prévues et réelles, les kilométrages ainsi que le statut. Les nouveaux espaces ne créent donc ni une seconde mission, ni une seconde affectation, ni un journal financier parallèle.

Les migrations distantes sont synchronisées jusqu'à `20260801120000_finalize_transport_courses_v1.sql` au moment de l'audit.

## Statuts et cycle disponibles

| Statut technique | Libellé | Usage existant |
| --- | --- | --- |
| `DRAFT` | Brouillon | Course en préparation |
| `PLANNED` | Planifiée | Dates prévues définies ; contraintes de planning actives |
| `IN_PROGRESS` | En cours | Course démarrée |
| `COMPLETED` | Terminée | Course livrée / transport terminé |
| `CLOSED` | Soldée | Clôture financière validée |
| `CANCELLED` | Archivée | Annulation conservée dans l'historique |

Les transitions déjà protégées sont `DRAFT → PLANNED`, `PLANNED → IN_PROGRESS`, `IN_PROGRESS → COMPLETED` et `COMPLETED → CLOSED`. Une annulation est historisée. La clôture contrôle déjà les dépenses, factures, paiements et écritures financières liés.

## Dates, kilométrages et affectations

La table possède déjà `planned_departure_at`, `planned_arrival_at`, `actual_departure_at`, `actual_arrival_at`, `start_odometer` et `end_odometer`. La contrainte existante garantit que l'arrivée prévue est postérieure au départ prévu et que le kilométrage final ne peut être inférieur au kilométrage initial.

Les colonnes `vehicle_id` et `driver_id` sont les affectations de la Course. Elles sont alimentées à la création depuis la migration corrective `20260731133000_fix_transport_mission_assignments.sql`. Elles doivent rester la seule affectation opérationnelle de la Course ; aucune table d'affectations parallèle ne sera introduite.

Deux contraintes `EXCLUDE` GiST empêchent les chevauchements de créneau pour un véhicule ou un chauffeur sur les Courses `PLANNED` ou `IN_PROGRESS`. Une dérogation ne peut passer qu'avec une justification dans `overlap_exception_reason` et la permission d'administration existante `missions.override`.

## Documents, historique et finance réutilisés

- Les documents de Course utilisent `document_transport_mission_links` et le composant réutilisable `EntityDocumentsTab` avec la relation `mission`.
- Les actions existantes sont historisées dans `business_finance_audit`; les actions de départ, livraison et affectation seront ajoutées à ce même journal.
- Les dépenses, factures et paiements de Course utilisent les tables `transport_mission_expenses`, `transport_invoices` et `transport_invoice_payments`, avec leurs liens explicites vers `finance_operations`.
- Un départ ou une livraison ne déclenchera aucune écriture financière : seuls la confirmation d'une dépense et celle d'un paiement peuvent modifier un wallet via le journal financier existant.

## Permissions et RPC existantes

Les permissions Courses existantes sont `missions.read`, `missions.create`, `missions.update`, `missions.dispatch`, `missions.expenses.manage`, `missions.expenses.confirm`, `missions.invoice`, `missions.payments`, `missions.close`, `missions.override`, `missions.cancel`, `missions.finance.read` et `missions.delete`.

Les RPC existantes réutilisées sont :

- `create_transport_mission`, `update_transport_mission`, `set_transport_mission_status`;
- les RPC de dépenses, factures et paiements de Course;
- `get_transport_mission_financial_summary` et `get_transport_mission_history`;
- `create_document_with_relation` pour les documents liés.

Il manque une RPC métier dédiée à l'affectation, une confirmation transactionnelle du départ et une confirmation/correction transactionnelle de livraison. Ces trois opérations seront les seules nouvelles mutations métier de ce lot.

## Écarts à combler

1. Aucun espace opérationnel dédié ne liste aujourd'hui les Courses par planning, affectation, départ ou livraison.
2. La livraison ne possède pas encore de données structurées pour le réceptionnaire, les réserves, l'incident et la preuve documentaire.
3. Les permissions d'exploitation fines (`planning.*`, `assignments.*`, `departures.*`, `deliveries.*`) ne sont pas encore définies.
4. Les actions de départ/livraison ne sont pas encore disponibles par une RPC idempotente et sécurisée.

## Décisions d'implémentation du lot

- Les pages utiliseront les Courses, sélecteurs, documents et journal d'audit existants.
- La vue Planning sera une grille CSS légère jour/semaine/liste, sans bibliothèque calendrier lourde.
- La livraison ajoutera des champs structurés directement à `transport_missions`, qui demeure la source de vérité.
- Les migrations, RPC et politiques seront créées localement mais **ne seront pas appliquées à Supabase sans autorisation explicite**.
- Aucune règle de document obligatoire n'étant configurée dans le modèle actuel, la checklist de départ l'indiquera comme non définie et ne bloquera pas artificiellement le départ.
