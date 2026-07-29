# Tests — paramètres d’alertes et planification (Lot 8)

## Tests SQL exécutés

Commande exécutée le 28 juillet 2026 :

```powershell
npx supabase db query --linked --file scripts/test-alert-settings-scheduler.sql
```

Résultat : succès (transaction terminée par `ROLLBACK`, aucune donnée de test conservée).

Le script vérifie :

1. la modification historisée d’un délai, d’une gravité et de destinataires ;
2. la désactivation d’une règle et l’absence d’alerte ;
3. l’application du palier de gravité configuré ;
4. deux générations consécutives, sérialisées et sans doublon ;
5. le seuil global wallet et sa surcharge par wallet ;
6. le seuil explicite de stock et la résolution après correction ;
7. le journal `notification_generation_runs` ;
8. le calcul `initial_balance + journal` après deux recalculs ;
9. une entrée de déclencheur invalide, rejetée proprement ;
10. les règles RLS des notifications et du journal d’exécution ;
11. la présence du job planifié.

La concurrence réelle est protégée par un verrou transactionnel PostgreSQL (`pg_advisory_xact_lock`). Le test couvre deux appels successifs; le verrou sérialise également deux appels simultanés, qui ne peuvent donc pas insérer le même couple de déduplication en parallèle.

## Tests Edge Function exécutés

| Cas | Résultat |
| --- | --- |
| Déploiement `generate-notifications` | Réussi, fonction active sur le projet lié |
| POST sans secret | `401 Non autorisé` |
| POST avec le secret serveur | `200`, exécution `SCHEDULED` réussie, aucun doublon créé |
| Appel de test par `pg_net` avec les secrets Vault | `200`, réponse de l’Edge Function et exécution journalisée |
| Job cron quotidien | Actif : `halal-erp-generate-notifications`, `0 6 * * *` |

Le test autorisé ne journalise ni le secret ni les données personnelles. Les réponses ne contiennent que l’identifiant d’exécution et les compteurs.

## Tests manuels à effectuer dans l’ERP

Ils nécessitent une session authentifiée dans l’application :

1. ouvrir **Paramètres** ;
2. modifier un délai et une gravité, puis enregistrer ;
3. désactiver puis réactiver une règle ;
4. modifier le seuil d’un wallet et d’un article ;
5. lancer **Actualiser les alertes** ;
6. vérifier le badge, le journal et l’état de santé ;
7. vérifier les restrictions avec un rôle non administrateur ;
8. modifier l’heure ou le fuseau, puis confirmer que le job est resynchronisé.

Ces tests d’interface n’ont pas été exécutés automatiquement : la session du navigateur de test n’était pas authentifiée dans l’ERP.
