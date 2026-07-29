-- Lot 11: extend the existing role enum before permission records reference it.
-- Kept in its own migration because PostgreSQL requires newly added enum values
-- to be committed before they are used by seeded rows in a later migration.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'rh';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'operations';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'stocks';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'exploitations';
