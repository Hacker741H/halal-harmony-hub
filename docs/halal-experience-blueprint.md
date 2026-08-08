# HALAL Experience Blueprint

## Ambition

HALAL ERP devient une expérience de gestion unifiée pour le transport,
l’agriculture et le commerce. L’interface doit donner une impression de
maîtrise : une personne voit ce qui est réel, comprend ce qui requiert une
décision et peut agir sans chercher dans plusieurs modules.

Le nom de cette expérience est **HALAL Field OS**. Ce n’est pas un nouveau
produit ni une seconde base de données : c’est le langage commun de toutes les
interfaces existantes de l’ERP.

## Les trois contextes d’utilisation

| Contexte | Utilisateur | Besoin dominant | Réponse d’interface |
| --- | --- | --- | --- |
| Pilotage | dirigeant, gestionnaire, finance | comprendre l’entreprise | cockpit, priorités, trésorerie, rentabilité, alertes |
| Opérations | exploitation, transport, stocks | faire avancer le travail | espace de travail, listes denses, actions contextualisées |
| Terrain | chauffeur, agent agricole, commercial | déclarer une réalité rapidement | formulaires courts, confirmation claire, fonctionnement mobile |

## Principes de composition

1. **Un écran possède une promesse.** Le titre, le contexte et l’action
   principale doivent être compris en quelques secondes.
2. **Le réel avant l’esthétique.** Aucun zéro ou indicateur n’est affiché comme
   confirmé lorsque les données sont indisponibles.
3. **Une fiche est un cockpit.** Une Course, un véhicule, une ferme, un client
   ou un chauffeur doit présenter son état, ses relations, ses finances et son
   historique sans ressaisie.
4. **Les montants racontent leur origine.** Toute somme importante doit mener à
   son wallet, son écriture et son événement métier.
5. **Le mobile simplifie sans appauvrir.** Une personne de terrain accomplit sa
   déclaration ; le contrôle et la validation restent visibles et traçables.

## Signature visuelle

- Un canevas ivoire ou charbon profond, avec une profondeur légère plutôt
  qu’un fond plat.
- Le vert HALAL porte l’action et l’identité ; l’or attire l’attention sans
  devenir un code d’alerte ; les couleurs d’état restent sémantiques.
- Les cartes structurent l’information. Les gradients et halos n’apparaissent
  que dans les zones de contexte majeur : cockpit, hero ou action prioritaire.
- L’animation confirme une ouverture, une sélection ou un succès. Elle reste
  inférieure à 180 ms et respecte la réduction des animations.

## Modèle d’écran commun

Chaque module adoptera progressivement cette structure, sans changer ses
requêtes, mutations ou permissions :

1. **Module header** — nom, contexte, compteur réel, action existante.
2. **Bande opérationnelle** — recherche, filtres et résultats déjà disponibles.
3. **Espace de travail** — table dense sur desktop, cartes lisibles sur mobile.
4. **États explicites** — chargement, vide, erreur et données partielles.
5. **Fiche 360°** — résumé, activité, finance, documents, alertes et historique.

## Ordre de transformation

### Vague 1 — socle transversal

- tokens, surfaces, tables, en-têtes, boutons et navigation ;
- cohérence clair, sombre et système ;
- aucun changement métier.

### Vague 2 — espaces qui définissent la perception

- Centre de pilotage ;
- Courses et ses espaces Planning, Affectations, Départs, Livraisons ;
- HALAL Field mobile.

### Vague 3 — actifs, personnes et partenaires

- Véhicules, motos et entretiens ;
- Chauffeurs, employés et rémunération ;
- Clients, contrats et documents.

### Vague 4 — économie et terrain multi-activité

- Wallets et Finance ;
- Fermes, récoltes et stocks ;
- rapports, alertes et paramètres.

## Garde-fous

- Aucun écran ne crée une seconde logique financière ou une seconde source de
  vérité.
- Les formulaires réutilisent les mutations, permissions et validations déjà
  présentes.
- Les actions non autorisées restent protégées par les règles existantes ;
  l’interface ne remplace jamais cette protection.
- Toute vague doit conserver le responsive, le clavier, le focus visible, les
  états de chargement et les validations TypeScript/build.

## Critère de réussite

L’expérience est réussie lorsqu’un dirigeant comprend rapidement la situation,
un opérateur trouve et agit sur une entité sans apprentissage inutile, et un
agent terrain peut déclarer une activité sans ambiguïté sur son téléphone.
