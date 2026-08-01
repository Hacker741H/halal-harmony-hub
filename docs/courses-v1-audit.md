# Audit V1.0 — module Courses

Date de l’audit : 1er août 2026
Périmètre : `transport_missions`, ses écritures financières liées, son interface `/courses`, ses documents et ses alertes. Cet audit ne couvre pas Planning, Affectations, Départs ou Livraisons, qui restent explicitement hors périmètre de la V1.0.

## Fonctionnalités déjà terminées

### Référentiel et relations

- Une Course possède un numéro unique, un client obligatoire, un véhicule et un chauffeur optionnels mais explicitement reliés par clés étrangères.
- Les relations vers les wallets, budgets, dépenses, factures, paiements, documents et audit sont séparées et traçables ; aucune donnée maître n’est recopiée dans la Course.
- Les contraintes d’exclusion PostgreSQL empêchent les créneaux qui se chevauchent pour un même véhicule ou chauffeur planifié/en cours. La migration corrective `20260731133000` alimente bien `vehicle_id` et `driver_id` à la création.
- Les documents de Course utilisent déjà `EntityDocumentsTab` et `document_transport_mission_links`, avec Storage privé et URLs signées.

### Finance et comptabilisation

- `finance_operations` reste l’unique journal financier : la confirmation d’une dépense crée une dépense liée, et la confirmation d’un paiement crée une recette liée.
- Les liaisons `finance_transport_mission_expense_links` et `finance_transport_payment_links` empêchent les doubles écritures. Une seconde confirmation est idempotente.
- L’annulation d’une dépense confirmée ou d’un paiement confirmé conserve la ligne d’origine et crée une contre-écriture ; aucune suppression financière n’est utilisée.
- Les paiements partiels, acomptes et règlements sont pris en charge. Le surpaiement est bloqué au moment de la saisie et de la confirmation.
- Le résumé financier calculé expose déjà : montant transport, budget, dépenses validées, facturé, encaissé, reste à encaisser, résultat brut, résultat de trésorerie et coût par kilomètre lorsque les deux kilométrages sont valides.

### Cycle de vie et permissions

- Les statuts techniques disponibles sont `DRAFT`, `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `CLOSED` et `CANCELLED` (affiché « Archivée » dans l’interface).
- Les transitions usuelles et les dérogations sont contrôlées dans `set_transport_mission_status` avec audit. La clôture exige les dépenses finalisées, les factures actives réglées et l’absence de solde client, sauf dérogation justifiée.
- Les mutations passent par des RPC `SECURITY DEFINER` contrôlées par permissions. Les tables opérationnelles ne reçoivent pas de `DELETE` direct depuis `authenticated`.

### Interface existante

- La liste propose recherche, filtres par période/statut/client/chauffeur/véhicule, pagination et valeurs financières masquées sans `missions.finance.read`.
- L’assistant de création, les onglets Course, les formulaires de budget/dépense/facture/paiement et les liens Documents/Historique existent déjà.
- Les états de chargement, erreur et liste vide existent dans la liste ; les actions financières affichent une notification après succès ou échec.

## Fonctionnalités incomplètes

### Cycle de conservation

- Aucune RPC dédiée ne permet encore de supprimer une Course `DRAFT` ou une Course `PLANNED` sans dépendance. L’interface propose actuellement uniquement le statut `CANCELLED`/« Archivée ».
- L’interface permet d’archiver n’importe quelle Course non clôturée via une invitation texte. Le choix suppression versus archivage n’est pas explicité suivant l’état et les dépendances.

### Cockpit, historique et expérience

- Le résumé financier est correct côté RPC, mais les KPI principaux n’exposent pas simultanément budget, dépenses, facturé et encaissé. « Résultat encaissé » peut être confondu avec le seul montant encaissé.
- La timeline affiche l’action et la date, mais pas encore l’auteur ou un résumé lisible des valeurs avant/après déjà disponibles dans l’audit.
- Les confirmations destructives reposent encore en partie sur `window.prompt`. Le chargement de la fiche et de la table reste textuel plutôt que sous forme de skeleton neutre.

### Documents de transport

- La relation documentaire est prête et la catégorie `FACTURE` existe.
- Les catégories explicites « Bon de mission », « Bon de sortie », « Bon de livraison » et « Reçu » ne sont pas encore proposées lors de l’envoi. La V1.0 ne génère pas de modèles PDF ; elle permet de classer et téléverser les fichiers réels.

### Alertes

- Les alertes génériques de wallet négatif ou sous seuil existent déjà et restent la référence commune à l’ERP.
- Il n’existe pas encore d’alertes explicites liées à une Course pour : budget dépassé, paiement reçu, facture échue non réglée et passage à l’état terminée.
- Les liaisons explicites de notifications ne couvrent pas encore `transport_missions` ni `transport_invoices`, ce qui empêche une navigation relationnelle complète vers la Course depuis ces alertes.

## Fonctionnalités volontairement hors périmètre V1.0

- Planning, affectations opérationnelles, départs et livraisons.
- Génération, prévisualisation et impression de PDF de bon de mission, bon de sortie, bon de livraison, facture ou reçu. Les fichiers correspondants peuvent être téléversés et classés.
- Gestion multi-factures active par Course : le schéma conserve actuellement une seule facture active par Course, conforme à la contrainte existante.
- Validation ou blocage préventif d’une dépense selon le solde disponible du wallet. La V1.0 conserve la règle ERP existante : le journal peut amener un wallet négatif, qui est signalé par l’alerte centralisée.
- Transactions atomiques entre la création de la Course et tous ses postes de budget depuis l’assistant : l’assistant actuel crée la Course puis ses lignes. Ce point est une dette technique à traiter dans un lot dédié avec une RPC de création groupée.

## Dette technique

1. Les types Supabase sont maintenus dans le dépôt ; toute nouvelle RPC doit être ajoutée au fichier généré localement ou régénérée depuis le schéma distant après application de migration.
2. Le formulaire de création en plusieurs étapes n’est pas transactionnel pour les lignes de budget : en cas d’erreur intermédiaire, une Course brouillon peut rester créée.
3. Les noms de wallets ne sont pas remontés dans le détail d’une dépense ou d’un paiement, uniquement leur identifiant. Ce défaut de présentation n’empêche pas la traçabilité base de données.
4. Le statut technique `CANCELLED` sert d’archivage en interface. Il doit continuer à être présenté comme « Archivée » afin de ne pas introduire un septième statut incompatible avec le schéma existant.

## Risques

- Modifier une Course planifiée peut provoquer à juste titre une violation de chevauchement. Les messages SQL doivent rester compréhensibles côté interface.
- L’archivage d’une Course avec des écritures financières ne doit jamais supprimer ni modifier le journal financier ; il sert uniquement à retirer la Course du flux opérationnel.
- Les alertes de Course ne doivent pas créer de doublons avec la surveillance générique des wallets. La V1.0 distinguera donc l’événement « wallet insuffisant pour une dépense de Course » de l’alerte globale de wallet négatif, avec des clés de déduplication séparées et une liaison vers la Course.
- Le déploiement de toute migration additionnelle doit être validé séparément avant application sur la base de production.

## Recommandations V1.0

1. Ajouter une RPC de suppression strictement limitée aux brouillons et aux Courses planifiées sans dépendance financière ou documentaire, tout en conservant le `DELETE` direct interdit.
2. Préserver `CANCELLED` comme archive métier auditée pour les Courses qui ne sont plus supprimables.
3. Exposer l’ensemble des métriques déjà calculées par la RPC dans le cockpit, sans introduire de nouveaux calculs côté client.
4. Ajouter les quatre catégories documentaires de transport manquantes, sans générer de fichier fictif.
5. Ajouter des alertes relationnelles et dédupliquées pour les événements Course réellement nécessaires à l’exploitation et à la finance.
6. Remplacer les confirmations navigateur par des confirmations accessibles, avec état en cours et message d’erreur visible.
