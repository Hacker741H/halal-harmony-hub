-- Reuse the existing audit journal for relational events while preserving its
-- financial actions. No audit rows are modified or removed.
ALTER TABLE public.business_finance_audit
  DROP CONSTRAINT IF EXISTS business_finance_audit_action_check;
ALTER TABLE public.business_finance_audit
  ADD CONSTRAINT business_finance_audit_action_check
  CHECK (action = ANY (ARRAY['CREATE', 'UPDATE', 'CANCEL', 'DELETE', 'CLOSE', 'ARCHIVE']));
