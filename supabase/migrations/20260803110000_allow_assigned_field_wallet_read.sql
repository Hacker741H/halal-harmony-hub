-- HALAL Field: a collaborator may view only the wallet explicitly assigned
-- to them for field reporting. This does not grant access to other wallets
-- or to finance operations.

DROP POLICY IF EXISTS wallets_read ON public.wallets;

CREATE POLICY wallets_read ON public.wallets
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission('wallets.read')
    OR (
      public.user_has_permission('field.wallets.read')
      AND EXISTS (
        SELECT 1
        FROM public.field_wallet_assignments AS assignment
        WHERE assignment.wallet_id = wallets.id
          AND assignment.user_id = auth.uid()
          AND assignment.is_active = true
      )
    )
  );
