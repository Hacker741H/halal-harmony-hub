# Tests RLS et sécurité

Le script [test-security-rls.sql](../scripts/test-security-rls.sql) vérifie, dans des transactions annulées :

1. l'absence de politique `USING (true)` ou `WITH CHECK (true)` sur les ressources sensibles ;
2. l'absence d'exécution `anon` sur les fonctions `SECURITY DEFINER` ;
3. l'absence de politique d'écriture sur les archives `revenues`, `expenses`, `payments` et `stocks` ;
4. le statut privé du bucket `documents` ;
5. la résolution du rôle depuis `auth.uid()` pour un super administrateur ;
6. le refus de lecture financière et de mutation directe pour un utilisateur `lecture_seule`.

## Comptes disponibles lors du lot

La base distante contient actuellement un seul compte de test, auquel sont attribués à la fois `super_admin` et `lecture_seule`. Les vérifications administrateur sont donc exécutables, mais elles ne prouvent pas les refus d'un utilisateur standard : le scénario `lecture_seule` du script est volontairement ignoré tant qu'un compte portant uniquement ce rôle n'existe pas. Aucun compte `comptable`, `gestionnaire`, `chauffeur` ou `employe` n'est disponible. Leur création pour les tests nécessite une action métier hors du périmètre de ce lot, puis leur retrait après test.

## Scénarios multi-rôles restants

| Rôle | Autorisé | Refusé à confirmer |
| --- | --- | --- |
| `comptable` | journal financier, wallets, paiements salariaux, rapports finance | documents RH, modifications directes de finance_operations |
| `gestionnaire` | véhicules, motos, affectations, stocks, documents métier | wallets, salaires, lecture directe du journal financier |
| `chauffeur` / `employe` | profil et notifications propres | fiches d'autrui, salaires, wallets, exports |
| `lecture_seule` | profil et notifications propres | finance, archives, Storage privé, RPC métier |

## Recette multi-rôles du lot 11

Les scripts suivants utilisent l'API Admin exclusivement côté serveur :

- `npm run security:provision-users` crée ou normalise des comptes isolés ;
- `npm run security:test-users` ouvre de vraies sessions Supabase et vérifie les accès et refus par rôle ;
- `npm run security:cleanup-users` supprime seulement les comptes préfixés `security-test-` ;
- `npm run security:cleanup-orphan-documents -- --dry-run` inventorie les objets Storage orphelins. L'application exige une confirmation d'environnement supplémentaire.

Ils exigent `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`ALLOW_SECURITY_TEST_USERS=true` et un mot de passe de test transmis au
processus. Ces variables serveur étaient absentes pendant ce lot : **aucun
compte distinct n'a été créé et aucun résultat de session réelle n'est
revendiqué**.

## Tests manuels requis

- vérifier qu'une URL publique historique de document ne répond plus, puis ouvrir le même document depuis une fiche 360° autorisée et constater une URL signée temporaire ;
- avec un gestionnaire, créer un véhicule ou un entretien et vérifier que l'écriture automatique fonctionne sans permettre la création directe d'une opération financière ;
- avec un comptable, créer, modifier et supprimer une opération via les RPC Finance, puis vérifier le wallet ;
- avec un compte lecture seule, appeler directement les tables et RPC depuis la console Supabase : la base doit refuser les données ou l'opération ;
- vérifier qu'un rapport partagé ne peut être créé que par un administrateur et qu'un CSV Finance crée une ligne `REPORT_EXPORT` dans `security_audit_log`.
