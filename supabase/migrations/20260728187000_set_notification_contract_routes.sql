-- Contract detail routes already exist. Keep notification navigation relational
-- by deriving the route from the explicit notification_contract_links row.
CREATE OR REPLACE FUNCTION public.tg_set_notification_contract_route()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $set_notification_contract_route$
BEGIN
  UPDATE public.notifications
  SET entity_route = '/contracts/' || NEW.contract_id::text
  WHERE id = NEW.notification_id
    AND type = 'CONTRACT_EXPIRY';
  RETURN NEW;
END
$set_notification_contract_route$;

DROP TRIGGER IF EXISTS trg_set_notification_contract_route ON public.notification_contract_links;
CREATE TRIGGER trg_set_notification_contract_route
  AFTER INSERT ON public.notification_contract_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_notification_contract_route();

UPDATE public.notifications n
SET entity_route = '/contracts/' || l.contract_id::text
FROM public.notification_contract_links l
WHERE l.notification_id = n.id
  AND n.type = 'CONTRACT_EXPIRY';
