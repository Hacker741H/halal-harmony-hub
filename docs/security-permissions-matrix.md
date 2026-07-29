# Matrice de permissions ERP

Date : 28 juillet 2026. Cette matrice reflète uniquement les rôles réellement présents dans `public.app_role`.

## Correspondance avec les rôles demandés

| Besoin métier | Rôle actuel retenu | Limite actuelle |
| --- | --- | --- |
| Administrateur | `super_admin`, `admin` | `super_admin` et `admin` sont équivalents dans les politiques existantes ; une séparation plus fine n'est pas encore définie. |
| Gestionnaire | `gestionnaire` | couvre actuellement Opérations, une partie RH, Stocks et Exploitations ; il n'existe pas de rôles distincts. |
| Finance | `comptable` | accès aux finances, wallets, salaires nécessaires et rapports financiers. |
| Ressources humaines | `gestionnaire` | rôle RH dédié absent ; risque de sur-autorisation transversale. |
| Opérations | `gestionnaire` | rôle dédié absent. |
| Stocks | `gestionnaire` | rôle dédié absent. |
| Utilisateur standard | `chauffeur`, `employe`, `lecture_seule` | accès limité à son profil, ses notifications et, si une relation utilisateur existe, sa propre fiche. |

## Droits cible du lot 10

Légende : **C** = complet par règles/RPC, **L** = lecture, **M** = mutation via RPC métier, **P** = propre fiche/notification seulement, **—** = refusé.

| Module / donnée | Super admin / Admin | Gestionnaire | Comptable | Chauffeur / Employé / Lecture seule |
| --- | --- | --- | --- | --- |
| Profils et rôles | C | L opérationnelle minimale | L minimale | P |
| Employés et chauffeurs | C | C | L minimale nécessaire aux paiements | P si relation utilisateur |
| Permis, contrats, documents RH | C | C | — sauf référence de paiement nécessaire | — |
| Véhicules, motos, affectations, entretiens | C | C/M | L sans mutation pour contexte de coût | P seulement si affectation future explicitement reliée |
| Exploitations et récoltes | C | C/M | L pour réconciliation financière | — |
| Wallets | C/M | — | C/M | — |
| Finance et liens financiers | C/M | — | C/M | — |
| Salaires et paiements | C/M | — | C/M | — |
| Stocks et mouvements | C/M | C/M | L coûts/réconciliation | — |
| Tables historiques | L audit | — | L audit | — |
| Notifications | toutes visibles | notifications visibles | notifications visibles | propres notifications |
| Paramètres, alertes, scheduler | C | L exploitation + exécution autorisée existante | L paramètres financiers | — |
| Rapports et exports | C | rapports opérationnels sans données financières | rapports finance et trésorerie | — |
| Rapports enregistrés personnels | C | C selon rapport autorisé | C selon rapport autorisé | — |
| Rapports partagés / modèles | C | L si rapport autorisé | L si rapport autorisé | — |
| Journal d'audit sécurité | C | — | L audit financier | — |

## Principes appliqués par la base

1. La source du rôle est exclusivement `public.user_roles` lue avec `auth.uid()` dans des helpers SQL sécurisés. Aucun rôle transmis par le navigateur n'est accepté.
2. Les mutations financières, de salaire, d'affectation, d'entretien et de stock sont exécutées par les RPC atomiques existantes ; une politique RLS ne doit pas autoriser une écriture directe équivalente.
3. Une décision d'interface ne constitue jamais une permission : chaque lecture, mutation, RPC et export est protégé côté Supabase.
4. Les documents restent privés dans Storage ; l'autorisation de lecture du document et l'URL signée doivent être obtenues avec le JWT de l'utilisateur autorisé.
5. L'accès d'un utilisateur standard ne s'étend pas à une autre entité par modification d'URL ou d'identifiant de requête.

## Décisions en attente de validation métier

- Créer des rôles dédiés `rh`, `operations` et `stocks`, ou une table de permissions par module, est nécessaire pour appliquer la matrice métier demandée au niveau le plus fin. Ce lot ne les crée pas sans décision explicite, afin de ne pas redéfinir l'organisation existante.
- Les liens `employees.user_id` / `drivers.employee_id` ne couvrent pas encore systématiquement tous les comptes. Tant que ce backfill n'est pas validé, les droits « propre fiche » restent volontairement restrictifs.
