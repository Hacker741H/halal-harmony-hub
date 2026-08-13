-- POS-05 confirmations are distinct from generic updates and remain explicit
-- in the shared immutable audit trail. Existing rows and actions are kept.
ALTER TABLE public.business_finance_audit
  DROP CONSTRAINT IF EXISTS business_finance_audit_action_check;
ALTER TABLE public.business_finance_audit
  ADD CONSTRAINT business_finance_audit_action_check
  CHECK (action = ANY (ARRAY[
    'CREATE', 'UPDATE', 'CANCEL', 'DELETE', 'CLOSE', 'ARCHIVE', 'RESTORE',
    'REPLACE', 'ASSIGN', 'UNASSIGN', 'MERGE', 'DEPARTURE', 'DELIVERY',
    'CORRECT', 'CONFIRM'
  ]));
