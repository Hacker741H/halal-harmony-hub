-- Préproduction : un super-administrateur dispose de l'ensemble du catalogue
-- de permissions. Cette reprise ajoute seulement les permissions absentes.
INSERT INTO public.role_permissions (role, permission_code)
SELECT 'super_admin'::public.app_role, permission.code
FROM public.permissions AS permission
ON CONFLICT (role, permission_code) DO NOTHING;
