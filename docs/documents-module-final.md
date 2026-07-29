# Module Documents — architecture et sécurité

`documents` est la source des métadonnées. Les liaisons explicites `document_*_links` relient un document aux véhicules, motos, chauffeurs, employés, exploitations et contrats ; les champs historiques polymorphes sont conservés en lecture seulement.

Le bucket `documents` est privé. Toute consultation passe par une URL signée temporaire, obtenue côté serveur selon les permissions `documents.read` et, pour les dossiers RH/contrat, `documents.sensitive.read`.

Les RPC `archive_document`, `restore_document`, `replace_document_metadata`, `delete_document_metadata` et `get_document_audit_history` appliquent les permissions et utilisent `business_finance_audit` pour la traçabilité.

Storage et PostgreSQL ne partagent pas une transaction. Le remplacement téléverse le nouveau fichier, appelle la RPC de métadonnées, puis supprime l'ancien ; un échec de RPC entraîne la suppression compensatoire du nouveau fichier. Une atomicité inter-systèmes stricte nécessiterait ultérieurement une Edge Function de service.
