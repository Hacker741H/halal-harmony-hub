# État initial TypeScript — LOT 3

Date : 28 juillet 2026
Commande : `npx tsc --noEmit`
Résultat : **78 erreurs**.

Les erreurs proviennent principalement d'anciennes Server Functions TanStack Start
sans `.validator()`. Sans validateur, leur contrat infère `data: undefined`, alors
que les formulaires et mutations leur transmettent déjà `{ data: ... }`.

| Module | Fichiers et lignes | Cause | Correction prévue |
| --- | --- | --- | --- |
| Chauffeurs | `src/components/drivers/driver-form.tsx:71,82`; `src/lib/drivers.functions.ts:47,73,103`; `src/routes/_authenticated/drivers.tsx:64` | Contrats de création, modification et suppression non validés. | Ajouter des schémas Zod locaux et `.validator()` aux trois mutations, puis laisser les appels existants transmettre `{ data }`. |
| Employés | `src/components/employees/employee-form.tsx:60,69`; `src/lib/employees.functions.ts:35,61,91` | Même signature TanStack Start obsolète. | Normaliser les trois mutations avec schémas Zod. |
| Motos | `src/components/motorcycles/motorcycle-form.tsx:113,120`; `src/components/motorcycles/motorcycle-maintenance-form.tsx:88,95`; `src/routes/_authenticated/maintenance.tsx:318`; `src/routes/_authenticated/motorcycles.tsx:81`; `src/routes/_authenticated/motorcycles/$motorcycleId.tsx:92,105,577` | Server Functions non validées et interface du formulaire d'entretien incompatible avec l'appel `onCancel`. | Normaliser motos et entretiens; réconcilier `onCancel` comme prop requise. |
| Exploitations | `src/components/farms/farm-form.tsx:106,115`; `src/lib/farms.functions.ts:35,61,91,115`; `src/routes/_authenticated/farms.tsx:76`; `src/routes/_authenticated/farms/$farmId.tsx:88,99,110,144,164,452,612,642,668,678` | Fonctions non validées et valeurs de requêtes Supabase inférées de façon insuffisante dans les réductions. | Ajouter les validateurs; typer les résultats de requête et les réductions avec les types Supabase. |
| Récoltes | `src/components/harvest/harvest-form.tsx:114,121`; `src/lib/harvests.functions.ts:43,71,97,127` | Fonctions non validées (dont la requête par exploitation). | Ajouter les validateurs d'identifiant et de payload. |
| Wallets | `src/components/wallet-form.tsx:80,89`; `src/lib/wallet.functions.ts:36,62,92`; `src/routes/_authenticated/wallets.tsx:88` | Mutations non validées. | Ajouter les validateurs et conserver le format `{ data }`. |
| Stocks | `src/components/stocks/stock-form.tsx:82,91`; `src/lib/stocks.functions.ts:34,53,83`; `src/routes/_authenticated/stocks.tsx:75` | Mutations non validées. | Ajouter les validateurs et conserver le format `{ data }`. |
| Finances | `src/components/finance-form.tsx:145,156`; `src/components/finance/forms/RevenueForm.tsx:141,148`; `src/components/finance/forms/TransferForm.tsx:140,152`; `src/components/expenses/expense-form.tsx:64,71`; `src/lib/finance.functions.ts:65,112,117,132,187`; `src/lib/expenses.functions.ts:43,71,97,127`; `src/routes/_authenticated/finance.tsx:142` | Mutations et requêtes historiques non validées; la destination d'un transfert est lue à un mauvais niveau du payload. | Normaliser les validateurs sans migrer les modèles; corriger l'accès à `operation.destination_wallet_id`. |
| Autres | Aucun. | — | — |

Ce document est un état de départ : les numéros de ligne seront naturellement amenés
à évoluer pendant les corrections.
