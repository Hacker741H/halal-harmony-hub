-- A POS draft is identified client-side by a random session id.  The existing
-- sale RPC persists that identifier as POS:<session-id> in commercial_sales.reference.
-- This index makes a retry or a concurrent duplicate request harmless: PostgreSQL
-- accepts at most one ticket for one point of sale and one draft session.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.commercial_sales
    WHERE reference LIKE 'POS:%'
    GROUP BY business_location_id, reference
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Impossible d''activer l''idempotence POS : des references POS dupliquees existent deja.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS commercial_sales_pos_session_reference_unique
  ON public.commercial_sales (business_location_id, reference)
  WHERE reference LIKE 'POS:%';

COMMENT ON INDEX public.commercial_sales_pos_session_reference_unique IS
  'Prevents duplicate POS sales for the same persisted client-side draft session.';
