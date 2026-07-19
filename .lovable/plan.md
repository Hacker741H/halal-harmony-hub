
# Plan — HALAL ERP v2 (production-ready)

Big change, so here's exactly what I'll do before I touch code. Nothing gets recreated — I build on top of what's already there.

## 1. Full French translation
- Sidebar, top bar, dashboard, every module page, 404 / error screens, buttons, badges, empty states.
- Add a small `formatXOF()` / `formatDate()` / `formatNumber()` helper module using `fr-FR` locale + `XOF` currency (no decimals, "FCFA" suffix).
- HTML `lang="fr"`, all `<head>` titles/descriptions rewritten in French.
- Keep the existing dark-green / emerald / white / gold palette and the current dashboard layout — only the strings and the KPI wiring change.

## 2. Enable Lovable Cloud + database schema
Enable Cloud, then one migration creating the full relational schema. Every table gets RLS + GRANTs. All tables carry a `notion_page_id text unique` + `notion_last_synced_at timestamptz` + `notion_workspace_id text` so a future Notion sync can upsert without schema changes.

Tables (public schema):
- `profiles` (id → auth.users, full_name, phone, avatar_url, locale)
- `app_role` enum: `super_admin`, `admin`, `gestionnaire`, `comptable`, `chauffeur`, `employe`, `lecture_seule`
- `user_roles` (user_id, role) + `has_role()` security-definer function
- `employees` (matricule, nom, prenom, poste, date_embauche, statut, salaire_base, user_id nullable)
- `drivers` (employee_id, numero_permis, categorie_permis, date_expiration_permis, statut)
- `motorcycles` (immatriculation, marque, modele, annee, statut, driver_id nullable)
- `vehicles` (immatriculation, marque, modele, type, annee, statut, driver_id nullable)
- `farms` (nom, localisation, superficie_ha, type_culture, statut)
- `contracts` (reference, type, partie, date_debut, date_fin, montant, statut, entity_type, entity_id)
- `expenses` (date, categorie, montant, description, entity_type, entity_id, paid_by)
- `revenues` (date, source, montant, description, entity_type, entity_id)
- `payments` (date, type: entrant/sortant, montant, methode, reference, contract_id nullable)
- `inventory_items` (sku, nom, categorie, unite, stock_actuel, seuil_alerte)
- `inventory_movements` (item_id, type: entree/sortie, quantite, date, motif)
- `documents` (nom, type, entity_type, entity_id, url, date_emission, date_expiration)
- `maintenances` (entity_type: moto/vehicule, entity_id, date, type, cout, kilometrage, prestataire, notes)
- `notifications` (user_id, type, titre, message, lu, created_at)
- `company_settings` (singleton: nom, devise=XOF, timezone, adresse, logo_url, notion_token nullable)

Polymorphic links use `entity_type` + `entity_id` (uuid). Indexes on all FKs and on `date`/`date_expiration` columns. RLS: authenticated read on operational tables, write gated by `has_role()` for admin/gestionnaire/comptable per module.

## 3. Authentication
- `/auth` route: sign in + sign up (email/password), French copy, redirects to `/`.
- `_authenticated/` layout gate (integration-managed) protects every module route.
- Signup trigger auto-creates `profiles` row + assigns default `lecture_seule` role.
- Top bar shows real user name/initials + sign-out menu.
- A `/parametres/utilisateurs` sub-page for admins to assign roles.

## 4. Live dashboard
Replace the hard-coded KPI arrays with a `useDashboardStats()` hook backed by a `getDashboardStats` server function that runs SQL aggregates (sum recettes du jour/mois, dépenses du mois, bénéfice, counts of motos/véhicules/employés/chauffeurs actifs/exploitations, count of documents expirant < 30j, last 10 activity rows from an `activity_log` view union). Upcoming expirations list reads `documents` where `date_expiration` between now and +30d.

## 5. Notion sync layer (architecture only, no calls)
- `src/lib/notion/` folder with:
  - `types.ts` — mapping types (`NotionPropertyMap`, `NotionDatabaseMapping`).
  - `mappings.ts` — one mapping per module declaring Notion property → local column (used later by the importer).
  - `sync-adapter.ts` — stub `upsertFromNotion(table, rows)` that already handles `notion_page_id` conflict resolution against the DB but is not wired to any API yet.
- `company_settings.notion_token` + a `notion_database_mappings` table (module_key, notion_database_id, last_synced_at) so admins can later paste IDs from the settings page.
- Settings page gets a "Synchronisation Notion" section that is visible but disabled with a "Bientôt disponible" badge.

## 6. Clean architecture touches
- `src/lib/format.ts`, `src/lib/i18n-fr.ts` (module labels), `src/hooks/use-auth.ts`, `src/hooks/use-role.ts`.
- Split each module route into `route file` + `feature component` under `src/features/<module>/` so future CRUD screens plug in cleanly.
- Keep every module page functional now (empty state + "Nouveau …" button wired to a placeholder dialog) so the shell is production-shaped even before full CRUD lands.

## What I am NOT doing in this pass
- No full CRUD forms for every one of the 17 modules — that's the next iteration. Each page renders a real list from the DB (empty at first) with the create button stubbed, so nothing is fake.
- No live Notion API calls, no Wave, no PDF/Excel export, no mobile app.
- No visual redesign.

## Technical notes (for reference)
- Stack stays TanStack Start + Supabase (Lovable Cloud). Server fns in `src/lib/*.functions.ts`, admin ops behind `requireSupabaseAuth` + `has_role` check.
- Roles stored in dedicated `user_roles` table (never on profile) with `has_role()` security-definer to avoid RLS recursion.
- All money columns `numeric(14,2)`; UI formats as `1 245 000 FCFA`.

Reply "go" (or tweak anything) and I'll start with enabling Cloud + the migration, then auth, then the French pass + live dashboard.
