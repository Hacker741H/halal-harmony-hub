-- A non-super administrator must never alter the roles of a super administrator.
-- This is enforced in the RPC so it also applies outside the user interface.
CREATE OR REPLACE FUNCTION public.set_user_role(
  p_user_id uuid,
  p_role public.app_role,
  p_assigned boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  target_permissions text[];
  is_super_administrator boolean;
BEGIN
  PERFORM public.permission_require('users.roles.assign');
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Utilisateur introuvable.' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE code = p_role AND is_active) THEN
    RAISE EXCEPTION 'Rôle introuvable ou inactif.' USING ERRCODE = '23503';
  END IF;

  is_super_administrator := public.current_user_has_any_role(ARRAY['super_admin']::public.app_role[]);
  IF NOT is_super_administrator AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Seul un super administrateur peut modifier les rôles d''un super administrateur.' USING ERRCODE = '42501';
  END IF;

  IF NOT is_super_administrator THEN
    IF p_user_id = auth.uid() THEN
      RAISE EXCEPTION 'Vous ne pouvez pas modifier vos propres rôles.' USING ERRCODE = '42501';
    END IF;
    IF p_role IN ('super_admin', 'admin') THEN
      RAISE EXCEPTION 'Vous ne pouvez pas attribuer un rôle administratif protégé.' USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(array_agg(permission_code), ARRAY[]::text[])
    INTO target_permissions FROM public.role_permissions WHERE role = p_role;
    IF NOT public.user_has_all_permissions(target_permissions) THEN
      RAISE EXCEPTION 'Vous ne pouvez pas attribuer une permission que vous ne possédez pas.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_assigned THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (p_user_id, p_role) ON CONFLICT DO NOTHING;
  ELSE
    IF p_role = 'super_admin' AND (
      SELECT count(*) FROM public.user_roles WHERE role = 'super_admin'
    ) <= 1 THEN
      RAISE EXCEPTION 'Le dernier super administrateur ne peut pas être retiré.' USING ERRCODE = '23514';
    END IF;
    DELETE FROM public.user_roles WHERE user_id = p_user_id AND role = p_role;
  END IF;
END;
$function$;
