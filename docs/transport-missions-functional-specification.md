# MT-01 — Spécification fonctionnelle : Missions de transport

**Statut :** conception fonctionnelle — aucune migration, route, permission ou logique applicative n’est créée par ce lot.
**Périmètre :** opérations de transport facturées à un client.
**Principe directeur :** une mission est le centre de coût et de revenu d’une opération de transport ; `finance_operations` reste le journal financier unique.

## Décisions métier validées

Les règles suivantes sont validées et prévalent sur toute formulation antérieure de ce document :

| Sujet | Décision validée |
|---|---|
| Fin de mission | Une mission peut passer à **Terminée** avec une facture impayée ou sans facture émise. |
| Clôture | Une mission ne peut passer à **Clôturée** que lorsque toutes ses dépenses sont validées et que son solde client est nul. |
| Dérogation | Une dérogation administrateur est possible pour une clôture avec solde client non nul ou un chevauchement. Elle exige une justification, un administrateur autorisé et une trace d’audit. |
| Encaissements | Les acomptes et les paiements partiels sont autorisés. Le surpaiement est bloqué par défaut. |
| Facturation | Une mission possède au plus une facture active. Une facture annulée reste historisée ; son remplacement éventuel est un nouveau document lié, soumis à la procédure de correction. |
| Corrections | Les avoirs, remboursements et corrections utilisent des objets et opérations liés, traçables et auditables. Aucun historique financier n’est supprimé. |
| Taxes | Les taxes sont facultatives et configurables. Une mission ou facture sans taxe est valide. |
| Kilométrage | Les kilométrages de départ et d’arrivée sont enregistrés. Le coût par kilomètre n’est calculé que si les deux valeurs sont présentes, numériques et cohérentes. |
| Budget mission | Avant le départ, la mission peut comporter un budget prévisionnel par catégorie de dépense. Ce budget n’est ni une dépense, ni une écriture financière ; il sert uniquement à comparer le prévu aux dépenses réellement payées. |
| Chevauchements | Les chevauchements de mission d’un même véhicule ou chauffeur sont bloqués par défaut, sauf dérogation administrateur auditée. |
| Rôles | Opérations crée les missions et saisit les dépenses ; Finance confirme les dépenses, émet les factures et confirme les paiements ; Administrateur gère dérogations, annulations et corrections ; Lecture seule consulte uniquement. |

## 1. Objectifs

### Pourquoi ce module existe

Aujourd’hui, HALAL ERP gère déjà les actifs roulants, les chauffeurs, les wallets, les dépenses, les recettes, les documents et les contrats. Il manque cependant un objet métier qui relie une prestation de transport à son exécution et à son résultat économique. Sans cet objet :

- les coûts de carburant, de péage ou de route ne peuvent pas être attribués de façon fiable à une course ;
- une recette peut connaître le nom libre d’un client, mais pas nécessairement son origine opérationnelle ;
- les factures, encaissements partiels et soldes clients ne sont pas traçables de bout en bout ;
- la rentabilité d’un véhicule, d’un chauffeur ou d’un client ne peut pas être calculée sans hypothèses.

Le module **Missions de transport** doit donc fournir une unité opérationnelle unique allant de la préparation du transport à la clôture financière.

### Problèmes résolus

1. Une dépense de mission est créée une seule fois, dans la mission, puis écrit une seule opération financière contrôlée.
2. Une recette provient d’un encaissement confirmé, rattaché à une facture puis à une mission ; la facture seule n’est pas une entrée de trésorerie.
3. Les utilisateurs retrouvent sans ressaisie le véhicule, le chauffeur, les documents, les factures, les paiements et l’historique d’une mission.
4. La comptabilité et les opérations partagent la même lecture, avec des données adaptées à leurs permissions.

### Intégration dans l’ERP

Le module réutilisera les référentiels existants :

| Référentiel existant | Rôle dans une mission |
|---|---|
| `vehicles` | Véhicule effectivement affecté au transport ; ses données d’identification, statut et kilométrage ne sont pas recopiés. |
| `drivers` → `employees` | Chauffeur exécutant ; identité et coordonnées restent portées par les tables existantes. |
| `driver_vehicle_assignments` | Historique des affectations ; il sert à vérifier une affectation cohérente, sans remplacer l’affectation opérationnelle de la mission. |
| `wallets` | Source du wallet payé ou crédité. Le solde n’est jamais modifié directement. |
| `finance_operations` | Journal financier unique des dépenses payées et des encaissements confirmés. |
| `documents` et tables de liaison explicites | Fichiers privés, URL signées et cycle d’archivage existants. |
| `contracts` | Contrats éventuellement associés au client, au chauffeur ou au véhicule selon les liens existants et futurs. |
| `business_finance_audit` | Journal d’historique réutilisable pour les événements métier et financiers. |

Les tables historiques `revenues`, `expenses` et `payments` ne doivent pas être utilisées pour les nouvelles missions.

---

## 2. Modèle métier cible

Les noms techniques ci-dessous sont des **propositions de modèle futur**. Ils ne constituent pas une migration pour MT-01.

### Mission

Une **Mission** représente une prestation de transport identifiable, de son planning jusqu’à sa clôture. Elle possède un numéro métier unique, un statut, des informations de transport, un client, un véhicule, un chauffeur et des relations vers ses charges, factures, paiements, documents et événements d’historique.

La mission est la source de vérité de son contexte opérationnel. Elle ne duplique ni le nom du véhicule, ni l’immatriculation, ni l’identité du chauffeur.

### Client

Il n’existe pas actuellement de table client dédiée. `finance_operations.client` est un champ textuel historique et ne peut pas servir de référentiel client : il ne garantit ni l’unicité, ni les coordonnées, ni les relations.

Le modèle cible devra introduire un référentiel unique, par exemple `transport_clients`, avec au minimum une identité légale ou commerciale, un statut et les coordonnées utiles à la facturation. Une mission et une facture pointent vers `client_id`.

**Exception légale documentée :** une facture émise peut conserver un instantané immuable des informations de facturation du client (nom légal, adresse, identifiant fiscal si requis). Cet instantané ne remplace jamais la fiche Client.

### Véhicule

Une mission référence un unique `vehicle_id` lors de son exécution. Elle conserve, dans son historique, le véhicule réellement affecté ; changer le véhicule avant le départ doit rester traçable. Une mission terminée ne doit pas voir son historique réécrit si le véhicule change ultérieurement de statut ou d’affectation.

### Chauffeur

Une mission référence un unique `driver_id` pour son exécution initiale. Le chauffeur est déjà relié à un employé éventuel via `drivers.employee_id`. La mission affiche les données utiles en lecture, sans recopier nom, téléphone ou permis.

Le remplacement d’un chauffeur après le départ doit être un événement d’historique explicite, avec date, motif et auteur.

### Wallet

Chaque dépense de mission possède un wallet prévu ou payé ; chaque paiement client confirmé possède un wallet de réception. Le wallet est toujours une clé étrangère, jamais un libellé ou un solde saisi manuellement.

### Dépense de mission

Une dépense de mission est un objet métier distinct de l’écriture financière : il porte son statut, sa catégorie, sa mission et son wallet. Lorsqu’elle devient **payée**, elle crée ou met à jour une unique opération `EXPENSE` dans `finance_operations`.

### Facture

Une facture représente une créance client émise pour une mission. Une mission peut avoir zéro ou une facture active. Une facture annulée reste disponible pour l’audit ; une éventuelle facture de remplacement ne peut être créée qu’à travers une procédure Finance/Administrateur traçable. Une facture n’est pas une recette : elle crée une attente de paiement, pas un mouvement de wallet.

### Paiement client

Un paiement est un encaissement prévu, reçu ou confirmé pour une facture. Une facture peut être payée totalement, partiellement et en plusieurs fois. Un paiement confirmé crée une unique opération `REVENUE` dans `finance_operations`.

### Document

Les documents restent dans `documents`, avec Storage privé et URLs signées temporaires. Les relations futures devront être explicites, par exemple :

- `document_transport_mission_links(document_id, mission_id)` ;
- `document_transport_invoice_links(document_id, invoice_id)`.

Il ne faut pas créer de lien générique `entity_type + entity_id` pour les nouvelles relations. Les relations historiques polymorphes existantes restent hors périmètre de ce lot.

### Historique

L’historique doit réutiliser `business_finance_audit`, déjà utilisé pour conserver action, valeur avant/après, date, auteur, source et opération financière éventuelle. Les sources futures peuvent être typées, par exemple `TRANSPORT_MISSION`, `TRANSPORT_EXPENSE`, `TRANSPORT_INVOICE` et `TRANSPORT_PAYMENT`.

### Relations essentielles

```text
Client 1 ──── n Missions
Mission 1 ──── 1 Véhicule exécutant
Mission 1 ──── 1 Chauffeur exécutant
Mission 1 ──── n Lignes de budget prévisionnel
Mission 1 ──── n Dépenses de mission ──── 0..1 Opération EXPENSE
Mission 1 ──── 0..1 Facture active ──── n Paiements ──── 0..1 Opération REVENUE
Mission 1 ──── n Documents
Facture 1 ──── n Documents
Mission / Dépense / Facture / Paiement 1 ──── n Événements d’historique
```

Pour préserver la traçabilité et éviter les liens génériques comme source principale, le modèle financier recommandé est :

```text
finance_transport_mission_expense_links
  mission_expense_id UNIQUE → transport_mission_expenses.id
  operation_id      UNIQUE → finance_operations.id

finance_transport_payment_links
  payment_id        UNIQUE → transport_invoice_payments.id
  operation_id      UNIQUE → finance_operations.id
```

Ces liens explicites remplacent, pour le nouveau domaine, l’usage de `finance_links.module + module_record_id` comme relation métier principale. Le lien générique existant reste compatible avec les domaines historiques, mais ne suffit pas au contrôle de cohérence attendu ici.

---

## 3. Cycle de vie et transitions autorisées

### Statuts de mission

| Statut | Signification | Transitions autorisées |
|---|---|---|
| **Brouillon** | Préparation incomplète ; aucune exécution déclarée. | → Planifiée ; → Annulée. |
| **Planifiée** | Client, trajet, véhicule et chauffeur prévus sont contrôlables. | → Brouillon pour correction ; → En cours au départ ; → Annulée avant départ. |
| **En cours** | Le transport a démarré. | → Terminée au retour ; → Annulée uniquement via une annulation motivée et contrôlée. |
| **Terminée** | Exécution terminée ; dépenses, kilométrage réel et éléments de facturation peuvent être finalisés. | → Clôturée ; → En cours uniquement par réouverture autorisée et historisée. |
| **Clôturée** | Dossier opérationnel et financier figé pour la gestion courante. | Accessible seulement lorsque dépenses validées et solde client nul, ou via dérogation administrateur auditée ; aucune transition standard ensuite. |
| **Annulée** | Mission non réalisée ou arrêtée. | Pas de reprise directe ; une nouvelle mission ou un clonage contrôlé doit être créé. |

**Règles de passage :**

- Le passage à **Planifiée** exige au minimum un client, un trajet de départ/destination, une marchandise ou prestation décrite, un véhicule et un chauffeur prévus. Les chevauchements actifs pour le véhicule ou le chauffeur sont bloqués, sauf dérogation administrateur motivée et auditée.
- Le passage à **En cours** enregistre date/heure réelle de départ et confirme que le véhicule et le chauffeur sont utilisables.
- Le passage à **Terminée** enregistre date/heure réelle de retour ainsi que les kilométrages de départ et d’arrivée. Le kilométrage d’arrivée doit être supérieur ou égal au kilométrage de départ.
- Le passage à **Clôturée** exige que toutes les dépenses soient validées et que le solde client soit nul. Une mission **Terminée** peut en revanche conserver une facture impayée. Une clôture dérogatoire exige une justification administrateur enregistrée dans l’historique.
- L’annulation ne supprime jamais les dépenses ou recettes confirmées. Toute compensation financière doit être conduite par le service financier central et rester auditée.

Pour la clôture, une dépense est considérée comme **validée** lorsqu’elle est `Payée` ou `Annulée` selon une décision Finance ou Administrateur auditée. Une dépense `Prévue` ou `Engagée` empêche donc la clôture standard.

### Statuts de facture

| Statut | Signification | Transitions autorisées |
|---|---|---|
| **Brouillon** | Projet modifiable ; aucun numéro définitif ni PDF officiel. | → Émise ; → Annulée. |
| **Émise** | Facture numérotée et remise ou disponible au client. | → Partiellement payée ; → Payée ; → Annulée seulement s’il n’existe aucun paiement confirmé. |
| **Partiellement payée** | Au moins un paiement confirmé, mais solde restant strictement positif. | → Partiellement payée lors d’un nouvel encaissement ; → Payée ; → Annulée uniquement via procédure d’avoir/remboursement à définir. |
| **Payée** | Somme des paiements confirmés égale au montant dû. | Aucun retour standard ; correction par avoir ou remboursement contrôlé futur. |
| **Annulée** | Document commercial rendu sans effet. | Pas de réactivation ; une nouvelle facture doit être créée si nécessaire. |

Une facture doit rester une créance. Son montant ne doit jamais être compté comme recette tant qu’aucun paiement n’est confirmé.

### Statuts de paiement

| Statut | Signification | Transitions autorisées |
|---|---|---|
| **Prévu** | Échéance ou promesse d’encaissement, sans fonds reçus. | → Reçu ; → Annulé. |
| **Reçu** | Encaissement signalé, à vérifier (preuve, montant, wallet, référence). | → Confirmé ; → Annulé si aucune écriture financière n’a été validée. |
| **Confirmé** | Encaissement reconnu dans le wallet ; une recette finance existe. | → Annulé uniquement par procédure de correction ou remboursement contrôlée. |
| **Annulé** | Paiement sans effet financier ou dont l’effet a été compensé. | Pas de réactivation ; recréer un paiement distinct. |

Le passage **Reçu → Confirmé** est le seul passage standard qui crée une recette. Il doit être atomique avec la création/mise à jour du lien financier et le recalcul du wallet.

### Statuts de dépense

| Statut | Signification | Transitions autorisées |
|---|---|---|
| **Prévue** | Budget ou estimation de mission ; aucun mouvement financier. | → Engagée ; → Annulée. |
| **Engagée** | Coût validé ou dû, mais non payé par un wallet. | → Payée ; → Annulée. |
| **Payée** | Décaissement réalisé ; une opération `EXPENSE` liée existe. | → Annulée uniquement par correction financière contrôlée. |
| **Annulée** | Dépense rendue sans effet ou compensée. | Pas de réactivation ; créer une nouvelle dépense si nécessaire. |

Un passage à **Payée** doit être atomique : dépense métier, opération `EXPENSE`, lien explicite, audit et recalcul du wallet. Une dépense déjà payée ne doit jamais produire une deuxième écriture en cas de modification ou de nouvelle tentative réseau.

---

## 4. Fiche Mission — contenu fonctionnel

La fiche Mission est organisée en onglets ; elle présente des relations et non des copies des référentiels.

### Informations

- identifiant / numéro de mission ;
- statut et dates de création, planification, départ, retour, clôture et annulation ;
- client sélectionné et contact de mission lorsque le modèle Client l’autorise ;
- montant de transport prévu de la prestation ;
- référence client, référence interne et observations ;
- responsable de création et dernière modification.

### Transport

- lieu et date/heure de départ prévus et réels ;
- lieu et date/heure de destination prévus et réels ;
- marchandise ou nature de la prestation ;
- quantité, unité et contraintes de transport, lorsque le métier les confirme ;
- véhicule lié, avec lien vers sa fiche ;
- chauffeur lié, avec lien vers sa fiche ;
- kilométrage départ/retour et distance calculée seulement si ces données sont renseignées ;
- événements de changement d’affectation pendant la mission.

### Finance

- montant de transport prévu, hors taxes lorsque les taxes sont applicables ;
- budget prévisionnel par catégorie et écart avec les dépenses réelles ;
- dépenses de mission regroupées par statut, catégorie et wallet ;
- facture active éventuelle et son solde ;
- paiements prévus, reçus et confirmés ;
- opérations financières liées, en lecture selon la permission `finance.read` ;
- aucun contrôle qui permette une édition directe de `wallets.balance`.

### Documents

- documents liés à la mission ;
- factures PDF ou justificatifs rattachés à une facture ;
- bons de livraison, lettres de voiture, justificatifs de péage/carburant ou autres pièces ;
- téléchargement par URL signée temporaire et actions conformes au cycle documentaire existant.

### Historique

- création et changement de statut ;
- changements de client, véhicule, chauffeur, trajet ou montant de transport prévu ;
- création, modification, annulation et paiement des dépenses ;
- émission, annulation et règlement des factures ;
- événements de documents ;
- auteur, date, données avant/après non sensibles et lien vers l’opération financière lorsqu’elle existe.

### Rentabilité

- montant de transport prévu ;
- montant facturé et montant encaissé ;
- solde client ;
- budget total, dépenses payées et écart budget/réel ;
- résultat brut de mission et résultat de trésorerie actuel ;
- statut de calcul et avertissements de données incomplètes.

L’onglet ne doit jamais afficher une valeur fictive lorsque le client, les paiements ou dépenses attendues sont absents.

---

## 5. Dépenses de mission

### Données minimales

Chaque dépense doit obligatoirement être liée à :

1. une `mission_id` ;
2. un `wallet_id` ;
3. une catégorie ;
4. un montant strictement positif ;
5. une date et un statut.

Catégories initiales proposées : **Carburant**, **Péage**, **Repas**, **Hébergement**, **Réparation**, **Entretien exceptionnel**, **Frais de route**, **Divers**. Elles devront être validées par le métier avant d’être figées dans un référentiel ou une règle de validation.

Les champs complémentaires possibles sont : fournisseur, référence, mode de paiement, description, justificatif documentaire, date prévue, date de paiement et auteur.

### Règles financières

- Une dépense **Prévue** ou **Engagée** ne modifie pas le wallet.
- Une dépense **Payée** crée une seule opération `finance_operations.type = EXPENSE` avec le même montant, wallet, date, catégorie, référence et description appropriée.
- Le wallet est recalculé exclusivement par le mécanisme officiel existant (`update_wallet_balance`/service financier), jamais par une mise à jour directe de `wallets.balance`.
- Si le montant, la date ou le wallet change après paiement, l’opération existante est modifiée dans la même transaction et les deux wallets sont recalculés si le wallet a changé.
- La suppression physique d’une dépense payée est interdite dans le flux normal. Une annulation doit préserver l’audit et appliquer la stratégie de correction financière validée.

### Garantie anti-doublon

La relation `mission_expense_id UNIQUE ↔ operation_id UNIQUE` garantit qu’un même paiement de dépense ne crée jamais plusieurs opérations financières, même après une relance de formulaire ou de RPC.

### Budget prévisionnel de mission

Avant le départ, l’utilisateur autorisé peut estimer le coût de la mission par les mêmes catégories que les dépenses réelles. Une ligne de budget contient uniquement une catégorie, un montant prévu et une note éventuelle ; elle n’a ni wallet, ni justificatif de paiement, ni opération dans `finance_operations`.

- le **budget total** est la somme des lignes prévues ; il n’est jamais saisi ni stocké comme total indépendant ;
- la **dépense réelle** est la somme des dépenses `Payée` de la mission ; les dépenses prévues ou engagées restent visibles séparément mais ne sont pas assimilées à un décaissement ;
- l’**écart budget/réel** est `dépenses réelles − budget prévu` : un écart positif signale un dépassement, un écart négatif une consommation inférieure au budget ;
- la comparaison est possible par catégorie et pour le total ; une catégorie sans budget reste affichée comme « non budgétée », sans être assimilée à zéro validé ;
- le budget de référence est saisi avant le départ. Toute révision après le passage à **En cours** doit être motivée et auditée afin de ne pas effacer la prévision initiale.

Le budget est un outil de pilotage. Il ne réserve pas de fonds, ne modifie pas le solde d’un wallet et ne change pas le calcul des recettes ou de la rentabilité.

---

## 6. Recettes et encaissements

### Chaîne de revenu

```text
Montant de transport prévu
        ↓
Facture unique active émise
        ↓
Paiement(s) client(s)
        ↓
Paiement confirmé
        ↓
Opération REVENUE dans le wallet
```

### Règles

- Le montant de transport prévu est une estimation commerciale ; il ne crée aucune opération financière.
- Une mission ne possède qu’une facture active ; les paiements partiels et acomptes sont rattachés à cette facture.
- Une facture émise exprime une créance ; elle n’augmente ni le wallet ni les recettes encaissées.
- Un paiement peut être inférieur au solde de la facture, égal au solde, ou faire partie d’une série de paiements.
- La somme des paiements **confirmés** détermine le statut de facture : `0` → Émise, `0 < total < montant dû` → Partiellement payée, `total = montant dû` → Payée.
- Un surpaiement est refusé par défaut. Les acomptes et paiements partiels sont admis tant que la somme confirmée reste inférieure ou égale au solde exigible.
- Seul le paiement confirmé produit une opération `REVENUE` et crédite un wallet.
- L’opération de recette est explicitement liée au paiement ; elle peut atteindre la mission par `paiement → facture → mission` sans recopier l’identité du client.

---

## 7. Facturation

Une facture active concerne une seule mission et une mission ne peut avoir qu’une facture active. Une facture annulée demeure historique ; elle ne doit pas être supprimée ni réutilisée. Toute correction ou facture de remplacement reste liée à la mission et à l’original selon une procédure auditée.

### Contenu fonctionnel d’une facture

- numéro unique, généré selon une règle de numérotation à définir ;
- client lié et instantané légal au moment de l’émission ;
- mission liée ;
- véhicule et chauffeur de la mission, affichés comme contexte d’exécution ;
- départ, destination, dates et marchandise/prestation ;
- montant hors taxes, taxes facultatives configurables, total et devise **si** le régime fiscal applicable est défini ;
- montant déjà encaissé, solde restant et échéance ;
- statut ;
- référence client ;
- PDF, impression et historique des émissions / annulations ;
- documents associés (bon de livraison, preuve de transport, justificatifs).

### PDF et impression

Le PDF est un rendu de facture, pas une nouvelle source de vérité. Il doit être généré à partir d’une facture émise, conservé dans le Storage privé existant et lié explicitement à la facture. Toute réimpression ou régénération doit être auditée.

Les taxes sont facultatives et devront être configurables. Les paramètres de taux, de devise multiple et de signature électronique doivent être validés avant de rendre un PDF opposable ou comptable.

---

## 8. Rentabilité

Les indicateurs suivants sont autorisés sans hypothèse supplémentaire :

| Indicateur | Formule | Commentaire |
|---|---|---|
| Montant de transport | montant commercial de service prévu, hors taxes lorsque des taxes sont applicables | Indicateur commercial ; il ne crée aucun mouvement financier. Les taxes collectées ne constituent pas une marge. |
| Montant facturé | montant total de la facture active non annulée | Créance générée ; non encaissée par défaut. |
| Montant encaissé | somme des paiements confirmés liés aux factures de la mission | Réconciliable avec les opérations `REVENUE` explicitement liées. |
| Solde client | montant facturé − avoirs confirmés − paiements confirmés nets | Nul pour la clôture standard ; ne doit jamais devenir négatif sans correction autorisée. |
| Total dépenses | somme des dépenses de mission `Payée` | Réconciliable avec les opérations `EXPENSE` liées. |
| Budget prévisionnel | somme des lignes de budget | Outil de comparaison, sans effet financier. |
| Écart budget/réel | total dépenses − budget prévisionnel | Positif = dépassement ; non calculé si aucun budget n’est renseigné. |
| Résultat brut | montant de transport hors taxes − total dépenses | Résultat de gestion de la mission ; il ne transforme pas ce résultat en recette. |
| Résultat de trésorerie actuel | montant encaissé net − total dépenses | Mesure des flux réellement encaissés et décaissés à date. |
| Coût par kilomètre | total dépenses ÷ (kilométrage arrivée − kilométrage départ) | Calculé uniquement lorsque les deux relevés sont valides et que la distance est strictement positive. |

Un **résultat net** ne doit pas être calculé ni présenté comme un résultat comptable tant que les taxes, amortissements, salaires indirects, coûts fixes, provisions et règles comptables ne sont pas formalisés. Si le métier souhaite l’afficher, sa formule doit être validée dans un lot dédié.

---

## 9. Impact sur les modules existants

| Module | Réutilisé | Extension future | Inchangé |
|---|---|---|---|
| Véhicules | Référentiel, fiche, statut, kilométrage, entretiens et opérations financières existantes. | Onglet Missions / filtre des missions liées ; contrôle d’indisponibilité selon règle validée. | CRUD véhicule, achat, entretien et historique existants. |
| Chauffeurs | `drivers`, profil employé, permis, affectations et fiches 360°. | Onglet Missions et historique des exécutions. | Informations personnelles, contrats et salaires. |
| Clients | Futur référentiel Client, relations explicites et indicateurs calculés. | Fiche 360° client : missions, facture active/historique, paiements, documents et rentabilité calculée. | Les données personnelles ou légales ne sont pas copiées dans les missions ni les opérations financières. |
| Wallets | Wallet sélectionné et recalcul officiel. | Affichage des opérations liées à une mission depuis le journal. | Formule de solde et règles de recalcul. |
| Finance | `finance_operations`, service financier, audit et transactions sécurisées. | Liens explicites mission/dépense/paiement et filtres de centre de coût. | Journal unique ; aucune création dans les tables financières historiques. |
| Documents | Storage privé, cycle de vie, URL signées et `EntityDocumentsTab`. | Relations explicites Mission et Facture. | RLS, bucket privé et RPC documentaire existants. |
| Rapports | Filtres, exports et réconciliation avec le journal financier. | Rapports de mission, client, véhicule et chauffeur avec relations explicites. | Règles d’accès aux données financières. |
| Notifications | Moteur d’alertes, déduplication, rôles et centre existants. | Alertes de départ proche, mission en retard, facture échue ou paiement attendu après validation métier. | Paramètres et alertes existantes hors mission. |
| Contrats | Relations explicites et fiche de contrat existantes. | Lien optionnel entre client/mission et contrat commercial, si le métier le confirme. | Contrats RH, véhicules, motos et exploitations actuels. |

---

## 10. Workflows opérationnels

### 10.1 Création et exécution d’une mission

1. L’utilisateur autorisé crée un **Brouillon**.
2. Il sélectionne le client existant, décrit la prestation, la marchandise, le départ, la destination et le montant de transport prévu.
3. Il sélectionne le véhicule et le chauffeur ; les informations maîtres apparaissent en lecture seule.
4. Avant le départ, il peut saisir le budget estimé par catégorie ; ces lignes n’ont aucun effet sur le wallet ou le journal financier.
5. Le système bloque les chevauchements pour le véhicule et le chauffeur, sauf dérogation administrateur justifiée et auditée, puis la mission devient **Planifiée**.
6. Au départ, l’utilisateur enregistre l’heure réelle ; la mission devient **En cours**.
7. Les dépenses prévues, engagées ou payées sont ajoutées depuis la fiche, toujours avec mission, wallet et catégorie.
8. Au retour, l’utilisateur enregistre les informations réelles disponibles ; la mission devient **Terminée**.
9. La facture unique active est préparée puis émise ; les paiements sont saisis comme prévus, reçus et confirmés.
10. Lorsque les contrôles de clôture sont satisfaits, la mission devient **Clôturée**.

### 10.2 Paiement d’une dépense

1. Le rôle **Opérations** crée ou saisit une dépense mission avec catégorie, montant, date et wallet.
2. Tant qu’elle est prévue ou engagée, aucune écriture finance n’est produite.
3. Le rôle **Finance** confirme le paiement ; une RPC métier atomique crée/met à jour la dépense, l’opération `EXPENSE`, le lien explicite et l’audit.
4. Le mécanisme officiel recalcule le wallet.
5. La fiche Mission, le wallet et Finance affichent la même opération selon les permissions.

### 10.3 Facturation et encaissement

1. Le rôle **Finance** prépare une facture en brouillon à partir de la mission terminée.
2. Le rôle **Finance** l’émet, attribue le numéro définitif, fige les informations légales nécessaires et produit le PDF selon les règles validées.
3. Un paiement est saisi avec la facture, le montant, le wallet de réception, la date et la référence.
4. Le passage à **Reçu** ne modifie pas le wallet.
5. Le rôle **Finance** effectue le passage à **Confirmé**, qui crée une unique recette `REVENUE`, le lien de paiement, l’audit et le recalcul du wallet.
6. Le solde de la facture et son statut sont recalculés à partir des paiements confirmés.

### 10.4 Annulation et correction

1. Une mission sans effet financier peut être annulée avec un motif.
2. Une dépense payée ou un paiement confirmé ne peut pas disparaître par suppression directe.
3. Une action autorisée déclenche une correction financière atomique et historisée, selon la convention de correction à valider.
4. L’objet métier devient annulé uniquement après succès de cette correction.
5. L’historique conserve le motif, l’auteur, la date et les liens financiers concernés.

---

## 11. Permissions futures

Ces codes sont proposés pour le futur catalogue ; ils ne modifient pas les permissions actuelles.

| Permission | Autorise |
|---|---|
| `missions.read` | Lire les missions et leurs données opérationnelles autorisées. |
| `missions.create` | Créer des brouillons. |
| `missions.update` | Modifier les missions non clôturées selon les règles de statut. |
| `missions.dispatch` | Planifier, affecter véhicule/chauffeur et déclarer départ/retour. |
| `missions.close` | Clôturer une mission après contrôles. |
| `missions.cancel` | Annuler une mission selon la procédure contrôlée. |
| `missions.expenses.manage` | Créer et gérer les dépenses de mission ; les écritures financières restent contrôlées côté serveur. |
| `missions.invoice` | Préparer, émettre ou annuler une facture dans les limites retenues. |
| `missions.payments` | Saisir, confirmer ou annuler des paiements client. |
| `missions.documents.manage` | Lier, téléverser ou archiver des documents de mission autorisés. |
| `missions.finance.read` | Consulter les montants et opérations de mission. |
| `missions.delete` | Supprimer uniquement un brouillon sans effet lié, si cette règle est retenue. |
| `missions.reports.read` | Consulter les rapports agrégés autorisés. |

Les contrôles devront être appliqués dans les RPC et RLS futures, pas seulement masqués dans React. Les rôles existants (`super_admin`, `admin`, `comptable`, `operations`, `gestionnaire`, `lecture_seule`, etc.) recevront des ensembles de permissions après une matrice métier validée.

### Répartition validée par rôle

| Rôle | Périmètre validé |
|---|---|
| **Opérations** | Consulte, crée et met à jour les missions dans son périmètre opérationnel ; affecte véhicule/chauffeur et saisit les dépenses. Il ne confirme pas les dépenses, n’émet pas de facture et ne confirme pas d’encaissement. |
| **Finance** | Consulte les données financières autorisées, confirme les dépenses, émet les factures, confirme les paiements et clôture les missions lorsque les règles standard sont remplies. |
| **Administrateur** | Gère les dérogations, annulations et corrections, avec justification obligatoire et audit. Il peut exercer les actions standard nécessaires à ces contrôles. |
| **Lecture seule** | Consulte uniquement les données auxquelles `missions.read` lui donne accès ; aucune création, modification, confirmation, export sensible ou dérogation. |

---

## 12. Rapports futurs

Les rapports suivants ne doivent être produits qu’après création des relations explicites et réconciliation avec `finance_operations` :

- missions les plus rentables selon résultat brut de trésorerie ;
- rentabilité par véhicule, uniquement avec revenus et dépenses explicitement liés aux missions de ce véhicule ;
- rentabilité par chauffeur, selon les missions exécutées et sans indicateur subjectif de performance ;
- rentabilité par client, sur facturé, encaissé, dépenses et résultat ;
- montant facturé, encaissé et en attente par période ;
- factures émises, partiellement réglées, impayées et échues ;
- dépenses par catégorie, client, véhicule, chauffeur et mission ;
- rentabilité mensuelle de gestion ;
- coût moyen par kilomètre uniquement si kilométrage départ/retour fiable et distance strictement positive.

Les transferts internes de wallet doivent rester neutres pour le résultat de mission. Les opérations annulées sont exclues selon la convention financière existante.

---

## 13. Risques, dépendances et règles de cohérence

### Dépendances identifiées

1. **Référentiel Client absent.** Une table client dédiée, ses RLS et ses permissions sont nécessaires avant toute mission réelle.
2. **Facture et paiement dédiés absents.** Les tables historiques `payments` et le champ texte `finance_operations.client` ne répondent pas au besoin de facture multi-paiements.
3. **Relations financières explicites.** Les liens doivent être ajoutés sans remplacer les liens véhicules/motos validés ni utiliser `finance_links` comme seule preuve métier.
4. **Transactions PostgreSQL/RPC.** Les transitions payées ou confirmées doivent être atomiques entre domaine métier, finance, audit et wallets.
5. **Documents.** Les tables de liaison explicites pour Mission et Facture doivent respecter le cycle Storage compensatoire existant.
6. **RLS et catalogue de permissions.** Les nouveaux objets impliquent informations clients et montants financiers sensibles.
7. **Numérotation et fiscalité.** Numéro de facture, devise, taxes, avoirs et exigence légale doivent être décidés avant le PDF officiel.

### Risques de double comptabilisation

- considérer une facture émise comme une recette ;
- créer une nouvelle opération à chaque mise à jour d’une dépense ou d’un paiement ;
- accepter deux confirmations du même paiement après relance réseau ;
- annuler une dépense payée sans compenser son effet sur le wallet ;
- inclure un transfert interne dans le revenu ou la dépense d’une mission ;
- relier une écriture uniquement par une description ou un texte de référence.

### Règles de cohérence à imposer ultérieurement

- un paiement confirmé ne dépasse pas le solde de facture sans règle d’avance explicite ;
- une facture ne concerne qu’une mission dans la première version ;
- une dépense de mission appartient à une seule mission ;
- toute opération financière de mission est reliée à une dépense ou à un paiement, jamais seulement à `module_id` textuel ;
- une mission clôturée ne peut pas être modifiée silencieusement ;
- les statuts dérivés de facture sont recalculés, pas saisis librement ;
- un véhicule et un chauffeur ne peuvent pas être affectés à des missions qui se chevauchent, sauf dérogation administrateur justifiée et auditée ;
- la suppression n’est permise que pour les brouillons sans lien financier, documentaire ou facturation irréversible.

---

## 14. Roadmap proposée

Chaque lot reste indépendant, avec validation de build, typecheck, RLS et tests de réconciliation avant passage au suivant.

### CRM-01 — Référentiel Clients

- créer le référentiel Client unique, ses données légales et coordonnées configurables par pays ;
- ajouter relations explicites Client ↔ Mission, Facture, Paiement et Document ;
- fournir les indicateurs client calculés, sans stocker de compteurs ou de solde dérivé.

### CRM-02 — Espace Client et sécurité

- créer la fiche Client et ses vues relationnelles ;
- appliquer les permissions/RLS Clients et les documents privés ;
- tester les relations, l’archivage et la non-duplication des identités client.

### MT-02 — Modèle de données et sécurité des missions

- créer les tables Mission, Budget prévisionnel, Dépense de mission, Facture, Paiement et liens explicites ;
- ajouter les lignes de budget prévisionnel et le contrôle d’une facture active par mission ;
- ajouter clés étrangères, index, RLS, permissions et stratégie de rollback ;
- ne créer encore aucune interface complète.

### MT-03 — Service transactionnel Mission / Finance

- créer les RPC spécifiques et idempotentes pour dépenses payées et paiements confirmés ;
- lier finance, audit et recalcul wallet ;
- écrire les tests SQL de double exécution, changement de wallet, correction et rollback ;
- réconcilier les totaux avec `finance_operations`.

### MT-04 — Espace opérationnel Missions

- créer liste, filtres, création contrôlée et fiche Mission ;
- intégrer sélection véhicule/chauffeur/client et statuts ;
- afficher dépenses, documents et historique réutilisables ;
- ne pas dupliquer les interfaces des modules existants.

### MT-05 — Facturation et paiements

- créer brouillon/émission/annulation contrôlée de facture ;
- gérer paiements multiples, partiels et confirmation ;
- générer PDF/impression seulement après validation légale et Storage privé ;
- tester les droits Finance / Opérations / Lecture seule.

### MT-06 — Intégration 360°, alertes et rapports

- ajouter les relations de mission aux fiches Véhicule, Chauffeur, Client et Finance ;
- étendre de manière ciblée les alertes d’échéance, de départ et d’impayé ;
- ajouter les rapports de gestion réconciliables, drill-down et exports autorisés ;
- mesurer les performances et ajouter seulement les index démontrés nécessaires.

---

## Questions métier à valider avant le développement

1. Quels champs Client sont obligatoires selon le pays, notamment les identifiants légaux configurables tels que NINEA/RCCM ?
2. Une mission peut-elle utiliser plusieurs véhicules ou chauffeurs, ou faut-il découper ce cas en missions liées ?
3. Quelle durée de dérogation et quels motifs normalisés doivent être imposés pour un chevauchement véhicule/chauffeur ?
4. Quelles données de marchandise sont obligatoires : poids, volume, quantité, unité, valeur, conditions particulières ?
5. Le kilométrage départ/retour est-il disponible et suffisamment fiable pour un coût au kilomètre ?
6. Quels cas d’avances clients, de remises ou de surpaiement doivent être pris en charge au-delà des acomptes et paiements partiels validés ?
7. Quelle est la règle légale de numérotation, de TVA, de devise et de conservation des factures pour l’organisation ?
8. Quelles dépenses doivent être obligatoirement justifiées par un document ?
9. Le budget de référence est-il figé au départ, et quel processus de révision motivée faut-il appliquer après le départ ?
10. Quelle procédure comptable précise est retenue pour un avoir, un remboursement client ou un remboursement fournisseur ?
11. Quels périmètres financiers exacts restent visibles pour Opérations et Lecture seule ?
12. Quelles alertes de mission sont réellement souhaitées et à quels seuils : départ imminent, retard, absence de preuve de livraison, facture échue, paiement en attente ?

Tant que ces réponses ne sont pas validées, les flux concernés doivent rester documentés et non implémentés plutôt que d’être déduits de manière risquée.
