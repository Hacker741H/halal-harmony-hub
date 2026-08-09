# Périmètre Jèko et rattachement des wallets

## Encaissements déjà pris en charge

Le connecteur Jèko est une couche de paiement entrante : il traite uniquement une facture ERP émise, un montant attendu et un wallet ERP choisi à l'avance par un administrateur.

- Les factures de **Courses** peuvent être encaissées par Jèko.
- Les factures de **ventes commerciales** peuvent être encaissées par Jèko. Cela couvre aussi une vente agricole lorsqu'elle a été créée comme vente commerciale et qu'une facture client existe.
- Une même demande Jèko est liée à une facture, un montant, une devise XOF et un wallet déterminés avant le paiement. Le webhook ne peut pas choisir ces valeurs.

Une confirmation Jèko crée le paiement ERP via le moteur existant. Ce moteur produit ensuite une unique écriture dans `finance_operations` et crédite le wallet associé. Le connecteur ne crée jamais lui-même une écriture financière directe.

## Événements volontairement exclus du flux entrant

- Une récolte seule : elle représente une production physique, pas un encaissement client. Elle devient encaissable uniquement après une vente et une facture.
- Les salaires, dépenses, entretiens, achats de véhicules, achats de stock et autres décaissements : ce sont des sorties d'argent, pas des paiements client entrants.
- Un transfert Jèko : il est enregistré et explicitement ignoré par le bridge de facture. Il ne peut pas créditer une facture ou un wallet par inférence.

Ces événements continuent d'utiliser leur processus ERP actuel. Les intégrer à Jèko demandera un futur flux de décaissement spécifique : bénéficiaire vérifié, wallet source, approbation, statut de virement, annulation ou contre-écriture et audit. Il ne faut pas réutiliser le flux d'encaissement client pour les payer.

## Jèko, Wave et les wallets ERP

Jèko peut proposer Wave comme moyen de paiement à un client, mais cela ne signifie pas que Jèko synchronise automatiquement le solde d'un compte Wave Business.

Deux modèles sont possibles :

1. **Règlement Jèko directement vers le compte Wave de l'entreprise** : le magasin Jèko peut être associé au wallet ERP qui représente ce compte Wave.
2. **Règlement temporairement conservé par Jèko avant un virement réel vers Wave** : le magasin Jèko doit être associé à un wallet ERP de transit Jèko. Un transfert explicite vers le wallet Wave ne doit être créé qu'après le virement réellement reçu.

Le bon choix dépend du compte marchand Jèko et de son compte de règlement. Aucun transfert automatique entre le wallet Jèko et le wallet Wave ne doit être supposé.

L'indication historique « Wave Business API en attente » affichée dans l'interface est un état visuel hérité : elle ne correspond pas à une synchronisation Wave active et ne doit pas être interprétée comme le statut du connecteur Jèko.

## Contrôles avant mise en service

1. Vérifier dans le compte Jèko où arrivent effectivement les règlements client.
2. Associer le magasin Jèko au wallet ERP représentant exactement ce compte de règlement.
3. Tester une petite facture sandbox ou de test.
4. Vérifier qu'une seule opération financière et un seul crédit de wallet sont créés pour le paiement.
5. Réconcilier le montant effectivement reçu avec le relevé du compte de règlement.
