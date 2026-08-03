-- HALAL Field: revoke a wallet assignment without deleting the wallet or its history.
-- The existing assignment row is retained for auditability and can be reactivated
-- later through assign_field_wallet.

CREATE OR REPLACE FUNCTION public.revoke_field_wallet_assignment(p_assignment_id uuid)
RETURNS public.field_wallet_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $revoke_field_wallet_assignment$
DECLARE
  v_before public.field_wallet_assignments;
  v_after public.field_wallet_assignments;
BEGIN
  PERFORM public.permission_require('field.wallets.assign');

  SELECT *
  INTO v_before
  FROM public.field_wallet_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;

  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'Affectation de wallet terrain introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_before.is_active THEN
    RAISE EXCEPTION 'Cette affectation est déjà retirée.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.field_wallet_assignments
  SET is_active = false,
      revoked_at = now(),
      updated_at = now()
  WHERE id = p_assignment_id
  RETURNING * INTO v_after;

  PERFORM public.business_finance_audit_event(
    'FIELD_WALLET_ASSIGNMENT',
    v_after.id,
    NULL,
    'REVOKE',
    to_jsonb(v_before),
    to_jsonb(v_after)
  );

  RETURN v_after;
END;
$revoke_field_wallet_assignment$;

REVOKE ALL ON FUNCTION public.revoke_field_wallet_assignment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_field_wallet_assignment(uuid) TO authenticated;
