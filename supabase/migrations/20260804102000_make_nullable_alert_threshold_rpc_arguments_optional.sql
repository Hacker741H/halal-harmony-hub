-- Keeps the existing nullable threshold behavior while making the RPC contract
-- explicit for generated TypeScript clients. No data, RLS policy, or role changes.

CREATE OR REPLACE FUNCTION public.save_notification_alert_rule(
  p_alert_type text,
  p_enabled boolean,
  p_default_severity text,
  p_due_days integer[],
  p_severity_schedule jsonb,
  p_threshold numeric DEFAULT NULL,
  p_recipient_roles public.app_role[] DEFAULT NULL
)
RETURNS public.notification_alert_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $save_notification_alert_rule$
DECLARE
  v_before public.notification_alert_rules;
  v_after public.notification_alert_rules;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Vous n’êtes pas autorisé à modifier les règles d’alerte.';
  END IF;
  IF p_default_severity NOT IN ('INFO', 'WARNING', 'CRITICAL') THEN
    RAISE EXCEPTION 'Gravité invalide.';
  END IF;
  IF jsonb_typeof(p_severity_schedule) <> 'object' THEN
    RAISE EXCEPTION 'Planning de gravité invalide.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_due_days, ARRAY[]::integer[])) AS day_value
    WHERE day_value < 0 OR day_value > 365
  ) THEN
    RAISE EXCEPTION 'Les délais doivent être compris entre 0 et 365 jours.';
  END IF;
  IF p_threshold IS NOT NULL AND p_threshold < 0 THEN
    RAISE EXCEPTION 'Le seuil ne peut pas être négatif.';
  END IF;
  IF cardinality(COALESCE(p_recipient_roles, ARRAY[]::public.app_role[])) = 0 THEN
    RAISE EXCEPTION 'Au moins un rôle destinataire est requis.';
  END IF;

  SELECT * INTO v_before FROM public.notification_alert_rules
  WHERE alert_type = p_alert_type FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Règle d’alerte inconnue.';
  END IF;

  UPDATE public.notification_alert_rules
  SET enabled = p_enabled,
      default_severity = p_default_severity,
      due_days = ARRAY(SELECT DISTINCT day_value FROM unnest(COALESCE(p_due_days, ARRAY[]::integer[])) AS day_value ORDER BY day_value DESC),
      severity_schedule = p_severity_schedule,
      threshold = p_threshold,
      recipient_roles = p_recipient_roles,
      updated_by = auth.uid()
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  INSERT INTO public.notification_settings_audit(setting_key, entity_type, entity_id, before_value, after_value, performed_by)
  VALUES ('notification_alert_rule.' || p_alert_type, 'notification_alert_rule', v_before.id, to_jsonb(v_before), to_jsonb(v_after), auth.uid());
  RETURN v_after;
END
$save_notification_alert_rule$;

CREATE OR REPLACE FUNCTION public.set_wallet_alert_threshold(
  p_wallet_id uuid,
  p_alert_threshold numeric DEFAULT NULL
)
RETURNS public.wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $set_wallet_alert_threshold$
DECLARE
  v_before public.wallets;
  v_after public.wallets;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]) THEN
    RAISE EXCEPTION 'Vous n’êtes pas autorisé à modifier le seuil de ce wallet.';
  END IF;
  IF p_alert_threshold IS NOT NULL AND p_alert_threshold < 0 THEN
    RAISE EXCEPTION 'Le seuil ne peut pas être négatif.';
  END IF;
  SELECT * INTO v_before FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet introuvable.'; END IF;
  UPDATE public.wallets SET alert_threshold = p_alert_threshold WHERE id = p_wallet_id RETURNING * INTO v_after;
  INSERT INTO public.notification_settings_audit(setting_key, entity_type, entity_id, before_value, after_value, performed_by)
  VALUES ('wallet.alert_threshold', 'wallet', p_wallet_id, to_jsonb(v_before), to_jsonb(v_after), auth.uid());
  RETURN v_after;
END
$set_wallet_alert_threshold$;

REVOKE ALL ON FUNCTION public.save_notification_alert_rule(text, boolean, text, integer[], jsonb, numeric, public.app_role[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_wallet_alert_threshold(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_notification_alert_rule(text, boolean, text, integer[], jsonb, numeric, public.app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_wallet_alert_threshold(uuid, numeric) TO authenticated;
