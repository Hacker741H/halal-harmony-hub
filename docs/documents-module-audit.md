# Audit du module Documents — Lot 12

Date : 29 juillet 2026. Audit effectué avant toute évolution fonctionnelle.

## Schéma existant et source de vérité

La table centrale est `public.documents` : `id`, `nom`, `type`,
`storage_path`, `url`, `date_emission`, `date_expiration`, `archived_at`,
`archived_by`, `created_at` et `updated_at`. Les champs historiques
`entity_type` et `entity_id` sont conservés pour compatibilité ; ils ne seront
pas utilisés pour créer de nouvelles relations.

Les liaisons explicites déjà présentes sont :

- `document_vehicle_links` ;
- `document_motorcycle_links` ;
- `document_driver_links` ;
- `document_employee_links` ;
- `document_farm_links` ;
- `document_contract_links` ;
- liaisons optionnelles aux entretiens véhicule et moto.

Chaque liaison contient une clé étrangère et une contrainte d'unicité. La RPC
existante `create_document_with_relation` crée le document et sa liaison dans
la même transaction. Elle est donc la seule voie de création à réutiliser.

## Sécurité et Storage

- Le bucket `documents` est privé.
- La lecture des métadonnées et des objets passe par les permissions
  `documents.read` et, pour les documents RH/contrat, `documents.sensitive.read`.
- Les liens temporaires sont créés côté serveur par `withSignedDocumentUrls` ;
  aucune URL publique permanente ne doit être affichée.
- L'upload utilise déjà `documents.upload` et compense un échec de création de
  métadonnée par la suppression de l'objet Storage.
- L'archivage existe via `archive_document`. La suppression physique n'existe
  pas encore et devra passer par une RPC sécurisée, jamais par une écriture
  directe dans la table ou Storage.

## Interface et composants réutilisables

| Élément | État | Réutilisation prévue |
| --- | --- | --- |
| Route `/documents` | Placeholder | Remplacer par la bibliothèque paginée. |
| `DocumentUpload` | Fichier, type et dates ; relation imposée par la fiche | Généraliser avec nom, certificat et sélection d'entité. |
| `documents.functions.ts` | Création, archivage, liste par relation, URL signée | Étendre avec liste filtrée, détail, remplacement et suppression. |
| Fiches 360° | Documents déjà branchés pour chauffeur, employé, moto et exploitation ; véhicule/contrat à vérifier | Harmoniser les listes et liens vers la fiche document. |
| Notifications | Alertes d'expiration document déjà générées | Réutiliser les seuils configurables 30/15/7 ; ne pas inventer de documents obligatoires. |

## Écarts et décisions

1. Il n'existe aucune table ou règle décrivant quels documents sont obligatoires
   par type d'entité. L'alerte « document manquant obligatoire » ne sera donc
   pas créée artificiellement dans ce lot ; le modèle de conformité devra être
   validé dans un lot dédié.
2. Les documents historiques ne possèdent parfois qu'un lien polymorphe. Ils
   restent lisibles, mais toute nouvelle écriture passera par une liaison
   explicite.
3. Les catégories demandées sont compatibles avec le champ existant `type` :
   `ASSURANCE`, `CARTE_GRISE`, `PERMIS`, `CONTRAT`, `FACTURE`, `CERTIFICAT`,
   `AUTRE`. Aucun second catalogue de catégories n'est nécessaire.
4. Une recherche plein texte sera initialement effectuée sur `nom` et `type`
   avec index PostgreSQL adapté ; aucun moteur externe n'est requis.

## Plan d'évolution minimal

1. Ajouter des RPC sécurisées pour le détail, la liste paginée, le remplacement
   et la suppression contrôlée.
2. Construire la bibliothèque `/documents` et `/documents/$documentId` à partir
   des Server Functions existantes.
3. Généraliser l'upload et les listes d'onglets Documents, sans dupliquer les
   relations.
4. Ajouter des tests transactionnels des liaisons, de l'archivage/suppression,
   des filtres et de la visibilité RLS.
