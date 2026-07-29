-- Internal ERP accounts are created exclusively by a super administrator.
-- Authentication still uses Supabase Auth under the hood; usernames are never
-- exposed as e-mail addresses in the application.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

UPDATE public.profiles AS profile
SET username = NULLIF(split_part(auth_user.email, '@', 1), '')
FROM auth.users AS auth_user
WHERE profile.id = auth_user.id
  AND profile.username IS NULL
  AND auth_user.email LIKE '%@halalco.local';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'username'),
    NULLIF(LOWER(NEW.raw_user_meta_data ->> 'username'), '')
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
      username = COALESCE(EXCLUDED.username, public.profiles.username),
      updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'lecture_seule')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

INSERT INTO public.permissions(code, module, action, description, sensitivity)
VALUES (
  'users.accounts.manage',
  'users',
  'accounts_manage',
  'Créer des comptes internes, réinitialiser leurs mots de passe et activer ou désactiver leurs accès.',
  'CRITICAL'
)
ON CONFLICT (code) DO UPDATE
SET module = EXCLUDED.module,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    sensitivity = EXCLUDED.sensitivity,
    updated_at = now();

ALTER TABLE public.security_audit_log
  DROP CONSTRAINT IF EXISTS security_audit_log_event_type_check;
ALTER TABLE public.security_audit_log
  ADD CONSTRAINT security_audit_log_event_type_check CHECK (event_type IN (
    'ROLE_CHANGE', 'ROLE_PERMISSION_CHANGE', 'DOCUMENT_ARCHIVED', 'DOCUMENT_ORPHAN_CLEANUP',
    'WALLET_CREATED', 'WALLET_UPDATED', 'WALLET_DELETED', 'REPORT_EXPORT',
    'USER_ACCOUNT_CREATED', 'USER_ACCOUNT_ACCESS_CHANGED', 'USER_PASSWORD_RESET'
  ));
