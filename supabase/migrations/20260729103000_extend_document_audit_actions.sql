ALTER TABLE public.business_finance_audit DROP CONSTRAINT IF EXISTS business_finance_audit_action_check;
ALTER TABLE public.business_finance_audit ADD CONSTRAINT business_finance_audit_action_check
CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'CANCEL', 'ARCHIVE', 'RESTORE', 'REPLACE', 'ASSIGN', 'CLOSE', 'UNASSIGN'));
