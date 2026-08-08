# Audit — cycle commercial commun

Date : 4 août 2026
Périmètre : ventes, factures, encaissements et créances pour le transport, l'agriculture et le commerce.

## Ce qui est déjà opérationnel

### Référentiel client

`transport_clients` est le référentiel client unique déjà utilisé par les Courses. Malgré son nom historique, ses données (numéro client, contacts, statut, archivage, détection et fusion des doublons) sont réutilisables pour toutes les activités. Il ne faut pas créer une deuxième table de clients.

### Transport

Les Courses possèdent déjà un cycle complet et sécurisé :

- une Course est reliée à un client ;
- `transport_invoices` porte les factures de Course ;
- `transport_invoice_payments` accepte les acomptes et règlements partiels ;
- seules les confirmations de paiement créent des recettes dans `finance_operations` ;
- les liens `finance_transport_payment_links` empêchent le double crédit d'un wallet ;
- une Course ne se clôture pas tant que les dépenses, factures et paiements ne sont pas cohérents.

Ce mécanisme doit rester intact. Le remplacer par un autre système de facturation créerait deux journaux ou deux sources de vérité.

### Agriculture

Les récoltes sont liées aux exploitations et peuvent déjà être valorisées dans le journal financier. Elles n'ont toutefois pas encore de cycle commercial client complet : facture, paiements partiels, échéance et reste à encaisser.

### Commerce et stocks

`inventory_items` / `stock_movements` permettent déjà des mouvements de type `SALE`. Une vente de stock financière est aujourd'hui un encaissement immédiat : elle choisit un wallet et crée son opération financière. Elle n'enregistre pas encore systématiquement un client, une facture ou une créance.

### Finance et wallets

`finance_operations` est le journal financier unique. Un paiement confirmé doit être relié à une seule écriture de recette et ne doit jamais modifier un solde de wallet directement.

## Écart à combler

Le produit dispose de trois situations distinctes :

| Activité | Client | Facture | Paiement partiel | Créance |
| --- | --- | --- | --- | --- |
| Course | Oui | Oui | Oui | Oui |
| Récolte agricole | Partiel | Non | Non | Non |
| Vente de stock | Facultatif / texte | Non | Non | Non |

Le manque n'est donc pas un nouveau journal financier. C'est un **cycle commercial générique**, capable de représenter une vente à crédit sans casser le cycle spécifique, déjà complet, des Courses.

## Principes retenus

1. `finance_operations` reste l'unique source des flux financiers confirmés.
2. Un client est toujours une ligne de `transport_clients` ; aucune copie de nom, téléphone ou adresse dans les nouvelles ventes.
3. Une facture n'est pas un encaissement. Elle crée une créance ; seul un paiement confirmé crédite un wallet.
4. Les paiements partiels sont autorisés ; le surpaiement est bloqué par défaut.
5. Les annulations et corrections conservent l'historique et passent par des opérations liées, jamais par la suppression d'un encaissement confirmé.
6. La TVA est optionnelle, à `0 %` par défaut tant qu'un réglage métier ne l'active pas.
7. Les ventes transport déjà existantes restent dans leurs tables spécialisées. Elles doivent être agrégées dans les futurs écrans de créances, pas migrées sans besoin démontré.

## Modèle cible proposé

Le cycle commun doit être introduit progressivement pour les ventes agricoles et commerciales :

```text
Client
  └─ Vente commerciale
       ├─ lignes de vente (article, récolte ou prestation)
       ├─ facture
       │    └─ paiement(s)
       │         └─ finance_operations
       └─ document(s)
```

Les liens avec une récolte ou un article de stock doivent être explicites par clés étrangères ou tables de liaison dédiées. Une description libre ne suffit pas pour calculer une marge ou reconstituer l'origine d'une vente.

## Lots recommandés

### CC-01 — Fondation commerciale

- définir le modèle SQL localement, sans toucher aux tables historiques ;
- créer ventes, lignes, factures, paiements et liens financiers explicites ;
- sécuriser les RPC transactionnelles, la prévention des doublons et la RLS ;
- ajouter les permissions commerciales ;
- prévoir les tests de réconciliation avec `finance_operations`.

### CC-02 — Espace Ventes et créances

- liste des ventes, factures et paiements ;
- filtres par client, statut, échéance et activité ;
- fiche client enrichie : facturé, encaissé, dû, échéances ;
- aucun montant financier visible sans permission dédiée.

### CC-03 — Ventes agricoles

- rattacher explicitement une vente à une récolte et à une exploitation ;
- distinguer quantité récoltée, quantité vendue et montant encaissé ;
- calculer une marge de gestion à partir des relations existantes.

### CC-04 — Ventes de marchandises

- rattacher les lignes à `inventory_items` ;
- réserver puis déduire le stock selon le statut choisi ;
- empêcher les doubles sorties de stock et les doubles recettes ;
- conserver les mouvements historiques existants.

### CC-05 — Pilotage commercial

- balance clients et échéancier des créances ;
- encaissements attendus ;
- ventes et marge par activité, client, produit et exploitation ;
- relances et alertes d'impayés.

## Risques à maîtriser avant toute migration

- ne pas utiliser `transport_invoices` comme une facture générique : elle exige une Course ;
- ne pas faire d'une sortie de stock un encaissement automatique lorsqu'une vente est à crédit ;
- ne pas compter une récolte non vendue comme une recette ;
- ne pas laisser deux modules créer une recette pour le même paiement ;
- ne pas modifier manuellement le solde d'un wallet ;
- ne pas masquer les créances ou les montants financiers par simple logique d'interface : les permissions doivent être appliquées côté base et RPC.

## Première décision d'implémentation

Le premier développement doit être CC-01, mais sa migration ne sera proposée qu'après conception technique détaillée et tests de non-régression des Courses. Les Courses resteront le flux de référence pour le transport ; le nouveau cycle couvrira en premier les ventes agricoles et les marchandises.
