-- The remote vehicles table already contains these identifiers. Keep fresh
-- environments aligned without altering historical rows.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS chassis_number text,
  ADD COLUMN IF NOT EXISTS engine_number text;
