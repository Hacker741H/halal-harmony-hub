-- CORRECTIF COURSES (audit ciblé) : get_transport_mission_history
-- (20260731130000_add_transport_courses.sql) échouait systématiquement --
-- SQLSTATE 42702, "column reference \"id\" is ambiguous" -- reproduit en
-- guaranteed-rollback contre la production, pour tout rôle (admin,
-- gestionnaire) et toute Course (avec ou sans dépense) : c'est un bug de
-- planification (résolu à la compilation de la requête, pas selon les
-- données), donc 100% déterministe, jamais intermittent.
--
-- Cause exacte : la fonction est RETURNS TABLE(id uuid, ...). En PL/pgSQL,
-- les colonnes d'un RETURNS TABLE deviennent des variables implicites dans
-- tout le corps de la fonction. Trois sous-requêtes internes référençaient
-- un `id` non qualifié (SELECT id FROM ... WHERE mission_id=p_mission_id) :
-- Postgres ne peut pas distinguer cet `id` de la variable de sortie de la
-- fonction, d'où l'ambiguïté.
--
-- CREATE OR REPLACE FUNCTION avec la même signature préserve
-- automatiquement les GRANT/REVOKE déjà en place -- aucune permission, aucun
-- grant, aucune règle métier touchée ; seuls les 3 sous-SELECT gagnent un
-- alias de table explicite (e/i/p) pour lever l'ambiguïté.
CREATE OR REPLACE FUNCTION public.get_transport_mission_history(p_mission_id uuid)
RETURNS TABLE(id uuid,source_type text,source_id uuid,action text,created_at timestamptz,performed_by uuid,before_value jsonb,after_value jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  PERFORM public.permission_require('missions.read');
  RETURN QUERY SELECT audit.id,audit.source_type,audit.source_id,audit.action,audit.created_at,audit.performed_by,audit.before_value,audit.after_value
  FROM public.business_finance_audit audit
  WHERE (audit.source_type='COURSE' AND audit.source_id=p_mission_id)
     OR (audit.source_type='COURSE_EXPENSE' AND audit.source_id IN (SELECT e.id FROM public.transport_mission_expenses e WHERE e.mission_id=p_mission_id))
     OR (audit.source_type='COURSE_INVOICE' AND audit.source_id IN (SELECT i.id FROM public.transport_invoices i WHERE i.mission_id=p_mission_id))
     OR (audit.source_type='COURSE_PAYMENT' AND audit.source_id IN (SELECT p.id FROM public.transport_invoice_payments p WHERE p.mission_id=p_mission_id))
  ORDER BY audit.created_at DESC;
END;
$$;
