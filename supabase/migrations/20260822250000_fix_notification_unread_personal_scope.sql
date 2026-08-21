-- Section 25-27 : root cause du compteur qui "reste figé" -- confirme par le
-- code et par les donnees reelles (Phase A). get_notification_summary_counts
-- comptait "unread" sur tout ce qu'un admin peut VOIR (le sien OU tout via
-- role admin/super_admin), alors que mark_all_notifications_read() ne marque
-- que ses propres notifications (user_id = auth.uid()). Un admin ne pouvait
-- jamais ramener le badge a zero : "tout marquer comme lu" ne touche jamais
-- les notifications generees pour d'autres utilisateurs.
--
-- Choix retenu : le badge "non lues" redevient un compteur personnel (ce que
-- "tout marquer comme lu" peut reellement effacer), coherent avec toute
-- interface de notifications standard -- la cloche affiche VOS non-lues, pas
-- celles de tout le monde. On ne touche pas au reste des statistiques
-- (critical/due_in_seven_days/due_in_thirty_days/low_stock/
-- overdue_maintenance) : ce sont des indicateurs de pilotage organisationnel
-- deliberement larges pour un admin, une question differente de "combien de
-- notifications qui me sont personnellement adressees restent non lues".
-- mark_all_notifications_read() n'est pas modifiee : elle etait deja
-- correcte pour ce perimetre personnel.
CREATE OR REPLACE FUNCTION public.get_notification_summary_counts()
 RETURNS TABLE(unread bigint, critical bigint, due_in_seven_days bigint, due_in_thirty_days bigint, low_stock bigint, overdue_maintenance bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE n.status = 'UNREAD' AND n.user_id = v_actor)::bigint,
    count(*) FILTER (WHERE n.severity = 'CRITICAL')::bigint,
    count(*) FILTER (WHERE n.due_date IS NOT NULL AND n.due_date >= current_date AND n.due_date <= current_date + 7)::bigint,
    count(*) FILTER (WHERE n.due_date IS NOT NULL AND n.due_date >= current_date AND n.due_date <= current_date + 30)::bigint,
    count(*) FILTER (WHERE n.type = 'LOW_STOCK')::bigint,
    count(*) FILTER (WHERE n.type LIKE 'MOTORCYCLE_MAINTENANCE%' AND (n.due_date IS NULL OR n.due_date < current_date))::bigint
  FROM public.notifications n
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND (n.user_id = v_actor OR public.has_any_role(v_actor, ARRAY['super_admin', 'admin']::public.app_role[]));
END;
$function$;
