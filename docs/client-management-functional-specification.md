# CRM-01 — Spécification fonctionnelle : Référentiel Clients

**Statut :** conception fonctionnelle uniquement. Ce document ne crée ni migration, ni écran, ni route, ni RPC, ni permission.
**Référence :** [MT-01 — Missions de transport](transport-missions-functional-specification.md) et [MT-02 — Design technique des missions](transport-missions-technical-design.md).
**Principe directeur :** un client existe une seule fois dans HALAL ERP. Les missions, factures, paiements et documents le référencent par clé étrangère ; ils ne recopient pas sa fiche.

## 1. Objectifs

Le référentiel Clients fournit le point d’entrée commercial unique des transports facturés. Il remplace l’usage d’un nom libre dans une opération financière comme preuve de l’identité d’un client.

Il résout les problèmes suivants :

- retrouver l’ensemble des missions, factures, paiements et documents d’un client sans ressaisie ;
- éviter la création de plusieurs fiches pour une même organisation ou personne ;
- distinguer une créance facturée d’un encaissement réellement reçu ;
- rendre la rentabilité client explicable à partir des missions et écritures liées ;
- préparer une facturation fiable sans transformer le référentiel Client en second journal financier.

Le référentiel s’intègre aux modules existants sans les remplacer : Véhicules et Chauffeurs restent les référentiels d’exécution, Wallets et `finance_operations` restent les sources de trésorerie, Documents reste responsable des fichiers privés, et les Missions deviennent le lien commercial et opérationnel.

## 2. Modèle métier

### Client

Un Client est une personne physique ou une organisation qui commande ou règle une prestation de transport. Il possède un numéro Client unique, une identité affichée, des coordonnées et, selon le pays, des informations légales de facturation.

Les champs fonctionnels prévus sont :

| Domaine | Données |
|---|---|
| Identification | numéro Client, type `Personne physique` ou `Organisation`, nom affiché, raison sociale lorsque distincte. |
| Informations légales | type d’identifiant configurable par pays et valeur associée ; exemples possibles : NINEA, RCCM ou identifiant local. |
| Coordonnées | adresse, ville, pays, téléphone, e-mail. |
| Contact | nom, téléphone et e-mail du contact opérationnel ou de facturation lorsque nécessaire. |
| Gestion | statut actif/archivé et notes internes. |

NINEA et RCCM ne sont pas rendus obligatoires de manière universelle : leur type, caractère obligatoire et validation doivent dépendre du pays et de la politique validée par le métier. Le client n’est pas supprimé s’il a des relations historiques ; il est archivé.

### Relations explicites

```text
Client 1 ──── n Missions
Client 1 ──── n Factures
Facture 1 ──── n Paiements
Client 1 ──── n Documents via liaison explicite
Mission 1 ──── 0..1 Facture active
Mission 1 ──── n Dépenses ──── 0..1 finance_operations EXPENSE
Paiement confirmé 1 ──── 1 finance_operations REVENUE
```

- une Mission référence `client_id` ;
- une Facture référence le même `client_id`, contrôlé contre la mission à son émission ;
- un Paiement atteint le Client via `paiement → facture → mission → client` ; il ne copie pas un nom de client ;
- un Document client est relié au Client par une table de liaison explicite, sans `entity_type/entity_id` ;
- une Facture émise peut stocker un instantané légal minimal du Client. Cet instantané est figé pour le document commercial, mais ne remplace jamais la fiche Client maître.

## 3. Cycle de vie Client

| Statut | Signification | Règle |
|---|---|---|
| **Actif** | Client utilisable pour une nouvelle mission et une nouvelle facture. | État par défaut après création autorisée. |
| **Archivé** | Client conservé pour l’historique, mais non sélectionnable pour une nouvelle mission ou facture. | Les missions, factures, paiements et documents existants restent accessibles selon les droits. |

La suppression physique n’est permise que pour une fiche brouillon sans aucune mission, facture, paiement, document ou audit lié, et seulement si cette règle est explicitement retenue dans le futur. La règle cible est l’archivage afin de préserver la traçabilité commerciale et financière.

## 4. Fiche Client future

La future fiche Client est une vue relationnelle, sans copier les données issues des autres modules.

### Informations

- numéro Client, identité, type, statut et coordonnées ;
- informations légales configurables par pays ;
- contact opérationnel ou de facturation ;
- notes internes et événements d’archivage/restauration ;
- liens vers les documents directement rattachés au Client.

### Missions

- missions du client, avec numéro, statut, trajet, véhicule, chauffeur et dates ;
- lien vers la fiche Mission ;
- aucune saisie redondante du véhicule, du chauffeur ou de la marchandise dans le Client.

### Factures et paiements

- facture active ou historique par mission, numéro, montant, échéance, statut et solde ;
- paiements prévus, reçus, confirmés ou annulés ;
- lien vers le wallet uniquement pour les utilisateurs autorisés ;
- aucun mouvement de wallet déclenché depuis la fiche Client sans paiement confirmé.

### Documents

- documents contractuels, fiscaux ou commerciaux liés explicitement au Client ;
- Storage privé, URL signée temporaire, archivage et permissions du module Documents existant ;
- absence de bucket public ou d’URL permanente publique.

### Activité et historique

- création et modification de la fiche ;
- archivage/restauration ;
- création ou changement de lien vers une mission, facture ou document lorsque l’audit existant le permet ;
- aucun détail bancaire, secret ou document sensible dans les métadonnées d’historique.

### Indicateurs calculés

Les indicateurs suivants sont calculés depuis les tables source. Ils ne doivent jamais être enregistrés comme colonnes mises à jour manuellement :

| Indicateur | Règle de calcul |
|---|---|
| Total facturé | Somme des montants des factures non annulées du Client. |
| Total encaissé | Somme des paiements confirmés, nette des remboursements client confirmés. |
| Solde à recevoir | Factures non annulées − avoirs confirmés − paiements confirmés nets. |
| Nombre de missions | Missions non annulées ; les brouillons restent identifiables comme tels. |
| Rentabilité totale | Somme des résultats bruts des missions terminées ou clôturées : montant de transport hors taxes − dépenses payées. |
| Dernière mission | Mission la plus récente selon départ réel, départ planifié puis création. |
| Dernier paiement | Dernier paiement confirmé. |

Les taxes collectées ne font pas partie de la rentabilité. Le résultat de trésorerie client peut être présenté séparément comme `encaissements nets − dépenses payées`, avec son caractère courant clairement indiqué.

## 5. Intégration au moteur financier des missions

Le Client ne modifie jamais directement `wallets.balance` et ne crée jamais une `finance_operation` sur la seule base de son identité.

```text
Mission avec montant de transport prévu
        ↓
Facture unique active (créance, sans mouvement de wallet)
        ↓
Paiement confirmé
        ↓
finance_operations.REVENUE + lien explicite au paiement
        ↓
Recalcul officiel du wallet
```

Toutes les dépenses d’une mission sont rattachées à cette mission et à un wallet, puis deviennent une opération `EXPENSE` seulement à leur paiement. Elles participent à la rentabilité Client par la relation Mission, sans inscrire une dépense isolée directement sur le Client.

Une mission peut être terminée avec une facture impayée. Elle ne peut être clôturée que lorsque toutes ses dépenses sont validées et que le solde Client de la mission est nul, sauf dérogation Administrateur motivée et auditée.

## 6. Budget prévisionnel de mission

Avant le départ, les rôles autorisés peuvent prévoir le coût de la mission par catégorie : carburant, péage, repas, hébergement, réparation, entretien exceptionnel, frais de route ou divers.

- une ligne de budget ne contient ni wallet ni opération financière ;
- les dépenses réelles correspondent aux dépenses de mission `Payée` ;
- l’écart par catégorie et total est `dépenses réelles − budget prévu` ; un dépassement est donc positif ;
- le budget est une référence de pilotage et ne modifie ni le montant facturé, ni le montant encaissé, ni le résultat brut ;
- une révision après le départ doit être justifiée et auditée pour préserver la base de comparaison initiale.

## 7. Permissions futures

Ces permissions sont proposées, sans modifier le catalogue actuel :

| Permission | Rôle |
|---|---|
| `clients.read` | Consulter les fiches Client et les relations autorisées. |
| `clients.create` | Créer une fiche Client. |
| `clients.update` | Modifier les données maître non archivées. |
| `clients.archive` | Archiver ou restaurer une fiche selon les règles. |
| `clients.documents.manage` | Lier, téléverser ou archiver les documents Client autorisés. |
| `clients.finance.read` | Voir les montants et indicateurs financiers autorisés. |
| `clients.reports.read` | Voir les rapports Client agrégés autorisés. |

Opérations sélectionne et consulte le Client pour créer une mission, sans confirmer les dépenses ou paiements. Finance confirme les dépenses, émet les factures et confirme les paiements. Administrateur traite les dérogations, annulations et corrections. Lecture seule ne peut que consulter les informations qui lui sont autorisées.

## 8. Rapports futurs

- clients par montant facturé, encaissé et en attente ;
- clients avec factures échues ou solde à recevoir ;
- rentabilité de gestion par Client, uniquement depuis les relations explicites ;
- nombre, statut et montant des missions par Client ;
- évolution mensuelle des encaissements ;
- liste des Clients archivés ayant un solde ou des documents à conserver.

Ces rapports doivent filtrer les factures, paiements, avoirs et opérations annulées selon les conventions du journal financier. Ils ne doivent pas appeler un total de Client « bénéfice comptable ».

## 9. Risques et dépendances

1. les règles pays pour NINEA/RCCM, taxes, devise et contenu légal de facture restent à valider ;
2. la détection de doublons Client doit être assistée et non automatique tant que les règles d’identité ne sont pas définies ;
3. les rôles autorisés à voir coordonnées, identifiants légaux, factures et montants doivent être confirmés dans la matrice de permissions ;
4. les corrections (avoirs, remboursements) doivent garder une relation explicite et ne jamais effacer une facture ou un paiement confirmés ;
5. les agrégats doivent être calculés côté PostgreSQL ou par vue/RPC sécurisée, sans charger l’historique complet dans le navigateur.

## 10. Roadmap proposée

### CRM-01 — Référentiel Client et contrat documentaire

- créer le modèle Client, ses contraintes, ses relations documentaires et son audit ;
- mettre en place les permissions/RLS et tests de non-duplication ;
- ne pas reprendre automatiquement les valeurs textuelles historiques.

### CRM-02 — Espace Client 360°

- créer liste, recherche, archivage et fiche Client ;
- afficher missions, factures, paiements, documents et indicateurs calculés ;
- appliquer les permissions par section et l’accès signé aux documents.

### MT-02 — Modèle transactionnel des missions

- créer Missions, budgets, dépenses, facture unique active, paiements et liens financiers ;
- sécuriser les clôtures, chevauchements, corrections et séquences.

### MT-03 à MT-06 — Services, interface, facturation puis intégration 360°

- déployer les RPC transactionnelles avant les formulaires ;
- créer l’espace Missions, la facturation/paiements et enfin les rapports/alertes liés.

## Questions métier restantes

1. Quel est le pays principal et quelles règles déterminent les identifiants légaux obligatoires par type de Client ?
2. Quelles coordonnées doivent être obligatoires pour créer un Client actif ?
3. Faut-il détecter les doublons par nom, téléphone, e-mail, identifiant légal ou une combinaison validée ?
4. Qui peut archiver/restaurer un Client ayant des missions ou factures en cours ?
5. Le contact opérationnel et le contact facturation peuvent-ils être distincts et, si oui, faut-il gérer plusieurs contacts ?
6. Quel traitement fiscal et quelles règles de devise s’appliquent au montant de transport et aux factures ?
7. Quelle visibilité des indicateurs financiers est autorisée pour Opérations, Lecture seule et les rôles commerciaux futurs ?
