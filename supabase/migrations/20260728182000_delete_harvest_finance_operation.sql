-- Deleting a harvest must remove its generated revenue. The previous version
-- merely cancelled that revenue, which left it visible in the finance module.

CREATE OR REPLACE FUNCTION public.delete_harvest_with_finance(p_harvest_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $delete_harvest$
DECLARE
  v_harvest public.harvests;
  v_operation public.finance_operations;
BEGIN
  PERFORM public.business_finance_require_write_role();

  SELECT * INTO v_harvest
  FROM public.harvests
  WHERE id = p_harvest_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = 'P0002';
  END IF;

  -- Remove the explicit link first because it intentionally restricts the
  -- deletion of its finance operation. `harvest_id` also catches legacy rows
  -- created before the explicit-link table existed.
  DELETE FROM public.finance_harvest_links
  WHERE harvest_id = p_harvest_id;

  FOR v_operation IN
    DELETE FROM public.finance_operations
    WHERE harvest_id = p_harvest_id
    RETURNING *
  LOOP
    PERFORM public.update_wallet_balance(v_operation.wallet_id);
  END LOOP;

  DELETE FROM public.harvests WHERE id = p_harvest_id;

  PERFORM public.business_finance_audit_event(
    'HARVEST', p_harvest_id, NULL, 'DELETE', to_jsonb(v_harvest), NULL
  );

  RETURN true;
END;
$delete_harvest$;
