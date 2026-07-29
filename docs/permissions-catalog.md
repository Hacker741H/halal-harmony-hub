# Catalogue des permissions métier

Les permissions sont des codes stables stockés dans `public.permissions`. Toute vérification s'appuie sur `auth.uid()` et l'union des permissions de `public.user_roles`.

| Code | Description / sensibilité | Tables, routes ou RPC principales |
| --- | --- | --- |
| `dashboard.read` | Tableau de bord opérationnel | `/`, `getDashboardStats` |
| `employees.read`, `employees.create`, `employees.update`, `employees.delete` | Données RH ; création et gestion | `employees`, `/employees` |
| `drivers.read`, `drivers.create`, `drivers.update`, `drivers.delete`, `drivers.assign` | Chauffeurs, permis et affectations | `drivers`, affectations chauffeur |
| `vehicles.read`, `vehicles.create`, `vehicles.update`, `vehicles.delete`, `vehicles.assign`, `vehicles.maintenance.manage`, `vehicles.finance.read` | Actifs véhicule et leurs coûts | `vehicles`, entretiens, achats véhicule |
| `motorcycles.read`, `motorcycles.create`, `motorcycles.update`, `motorcycles.delete`, `motorcycles.assign`, `motorcycles.maintenance.manage`, `motorcycles.finance.read` | Actifs moto et leurs coûts | `motorcycles`, entretiens, achats moto |
| `farms.read`, `farms.manage`, `farms.finance.read`, `harvests.manage` | Exploitations, récoltes et finance agricole liée | `farms`, `harvests` |
| `contracts.read`, `contracts.manage` | Contrats et relations | `contracts`, RPC contrat |
| `documents.read`, `documents.upload`, `documents.archive`, `documents.sensitive.read` | Métadonnées, fichiers privés et documents RH | `documents`, Storage privé |
| `finance.read`, `finance.create`, `finance.update`, `finance.cancel`, `finance.export` | Journal financier, annulations et export | `finance_operations`, RPC finance |
| `wallets.read`, `wallets.manage` | Wallets et seuils | `wallets`, RPC wallet |
| `salaries.read`, `salaries.pay`, `salaries.export` | Salaires et paiements sensibles | `salary_payments`, RPC salaire |
| `stocks.read`, `stocks.manage`, `stocks.finance.read` | Articles, mouvements et coûts de stock | `inventory_items`, `stock_movements` |
| `notifications.read`, `notifications.manage`, `notifications.settings.manage` | Centre d'alertes et règles | `notifications`, paramètres alertes |
| `reports.read`, `reports.finance`, `reports.hr`, `reports.operations`, `reports.stocks`, `reports.export`, `reports.share` | Rapports et exports | RPC reporting, `saved_reports` |
| `settings.read`, `settings.manage` | Configuration ERP | `company_settings`, paramètres |
| `roles.read`, `roles.manage`, `users.roles.assign` | Catalogue, droits et attribution des rôles | `roles`, `permissions`, `role_permissions`, `user_roles` |
| `security.audit.read` | Journal de sécurité | `security_audit_log` |

`super_admin` est un rôle système : il possède implicitement toutes les permissions et reste nécessaire aux actions de sécurité irréversibles. Les contrôles de dernier super-administrateur et d'attribution de `super_admin` restent donc explicitement réservés à ce rôle.
