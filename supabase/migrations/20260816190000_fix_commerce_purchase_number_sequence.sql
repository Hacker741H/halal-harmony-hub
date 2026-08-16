-- GFC V1 Phase 3D -- fixes a bug in the just-applied migration
-- 20260816170000, caught immediately by the mandatory E2E test before any
-- frontend work: _internal_next_commerce_purchase_number stripped ALL
-- non-digit characters from 'ACH-20260816-0001', which also swallows the
-- date's own digits ('202608160001'), overflowing a 32-bit int on the
-- very first purchase of any day. Fixed by extracting only the third
-- dash-separated segment (the sequence itself), never touching the date.
--
-- Same regexp_replace(...,'\D','','g') pattern was also used by
-- _internal_next_commerce_supplier_number ('FRN-2026-00001' -> stripping
-- non-digits yields '202600001', merging the year into the sequence) --
-- does not overflow int4 at this width, but silently produces a
-- nonsensical, ever-growing "sequence" instead of resetting per year.
-- Fixed the same way, before it was ever exercised twice.

CREATE OR REPLACE FUNCTION public._internal_next_commerce_purchase_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT 'ACH-' || to_char(now(), 'YYYYMMDD') || '-' || lpad((
    COALESCE((
      SELECT max(NULLIF(split_part(purchase_number, '-', 3), '')::int)
      FROM public.commerce_purchases
      WHERE purchase_number LIKE 'ACH-' || to_char(now(), 'YYYYMMDD') || '-%'
    ), 0) + 1
  )::text, 4, '0');
$function$;

CREATE OR REPLACE FUNCTION public._internal_next_commerce_supplier_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT 'FRN-' || to_char(now(), 'YYYY') || '-' || lpad((
    COALESCE((
      SELECT max(NULLIF(split_part(supplier_number, '-', 3), '')::int)
      FROM public.commerce_suppliers
      WHERE supplier_number LIKE 'FRN-' || to_char(now(), 'YYYY') || '-%'
    ), 0) + 1
  )::text, 5, '0');
$function$;
