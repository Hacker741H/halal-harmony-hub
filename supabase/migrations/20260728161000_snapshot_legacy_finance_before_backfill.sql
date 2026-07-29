-- Lot 4: take the immutable, pre-backfill snapshot. The function returns the
-- same run when replayed, so applying this statement again cannot overwrite a
-- previously captured backup.
SELECT public.create_legacy_finance_snapshot('legacy_finance_v1');
