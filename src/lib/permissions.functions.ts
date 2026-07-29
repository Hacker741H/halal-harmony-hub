import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export const APP_ROLE_VALUES = [
  "super_admin",
  "admin",
  "comptable",
  "rh",
  "operations",
  "stocks",
  "exploitations",
  "gestionnaire",
  "chauffeur",
  "employe",
  "lecture_seule",
] as const satisfies readonly AppRole[];

const appRoleSchema = z.enum(APP_ROLE_VALUES);
const uuidSchema = z.string().uuid();

const permissionSchema = z.object({
  code: z.string().min(3),
  module: z.string().min(1),
  action: z.string().min(1),
  description: z.string().min(1),
  sensitivity: z.enum(["STANDARD", "SENSITIVE", "CRITICAL"]),
});

const roleSchema = z.object({
  code: appRoleSchema,
  label: z.string().min(1),
  description: z.string(),
  is_system: z.boolean(),
  is_active: z.boolean(),
  user_count: z.number().int().nonnegative(),
  permission_codes: z.array(z.string()),
});

const userSchema = z.object({
  user_id: uuidSchema,
  full_name: z.string().nullable(),
  roles: z.array(appRoleSchema),
});

const internalAccountSchema = z.object({
  userId: uuidSchema,
  username: z.string().min(3).max(40),
  fullName: z.string().nullable(),
  roles: z.array(appRoleSchema),
  active: z.boolean(),
});

const currentUserIdentitySchema = z.object({
  fullName: z.string().nullable(),
  username: z.string().min(1),
  roles: z.array(appRoleSchema),
});

const internalAccountInputSchema = z.object({
  username: z.string().trim().regex(/^[a-z0-9._-]{3,40}$/i),
  fullName: z.string().trim().min(2).max(120),
  password: z.string().min(8).max(128),
  role: appRoleSchema,
}).strict();

const updateInternalAccountSchema = z.object({
  userId: uuidSchema,
  username: z.string().trim().regex(/^[a-z0-9._-]{3,40}$/i),
  fullName: z.string().trim().min(2).max(120),
  roles: z.array(appRoleSchema).min(1).max(APP_ROLE_VALUES.length),
}).strict();

const administrationSchema = z.object({
  roles: z.array(roleSchema),
  permissions: z.array(permissionSchema),
  users: z.array(userSchema),
});

export type PermissionDefinition = z.infer<typeof permissionSchema>;
export type PermissionRole = z.infer<typeof roleSchema>;
export type PermissionUser = z.infer<typeof userSchema>;
export type PermissionAdministration = z.infer<typeof administrationSchema>;
export type InternalAccount = z.infer<typeof internalAccountSchema>;
export type CurrentUserIdentity = z.infer<typeof currentUserIdentitySchema>;

async function requireAccountManager(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data: isSuperAdmin, error } = await context.supabase.rpc("current_user_has_any_role", {
    p_roles: ["super_admin"],
  });
  if (error) throw error;
  if (!isSuperAdmin) throw new Error("Seul le super administrateur peut gérer les accès aux comptes.");
}

async function recordAccountAudit(
  actorUserId: string,
  eventType: "USER_ACCOUNT_CREATED" | "USER_ACCOUNT_ACCESS_CHANGED" | "USER_PASSWORD_RESET",
  targetUserId: string,
  metadata: Record<string, unknown>,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("security_audit_log").insert({
    actor_user_id: actorUserId,
    event_type: eventType,
    resource_type: "USER_ACCOUNT",
    resource_id: targetUserId,
    metadata: metadata as unknown as Json,
  });
  if (error) throw error;
}

export async function getPermissionCodesForClient(
  supabase: SupabaseClient<Database>,
): Promise<string[]> {
  const { data, error } = await supabase.rpc("current_user_permissions");
  if (error) throw error;
  return (data ?? []).map((row) => row.permission_code);
}

export const getCurrentPermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => getPermissionCodesForClient(context.supabase));

export const getCurrentUserIdentity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CurrentUserIdentity> => {
    const [{ data: profile, error: profileError }, { data: roleRows, error: rolesError }] = await Promise.all([
      context.supabase.from("profiles").select("full_name, username").eq("id", context.userId).maybeSingle(),
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
    ]);
    if (profileError) throw profileError;
    if (rolesError) throw rolesError;
    const metadata = context.user.user_metadata as { full_name?: string; username?: string } | undefined;
    return currentUserIdentitySchema.parse({
      fullName: profile?.full_name ?? metadata?.full_name ?? null,
      username: profile?.username ?? metadata?.username ?? context.user.email?.split("@")[0] ?? "utilisateur",
      roles: (roleRows ?? []).map((row) => row.role),
    });
  });

export const getPermissionAdministration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PermissionAdministration> => {
    const { data, error } = await context.supabase.rpc("get_permission_administration");
    if (error) throw error;
    return administrationSchema.parse(data);
  });

export const saveRolePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z
      .object({ role: appRoleSchema, permissionCodes: z.array(z.string().min(3)).max(200) })
      .strict(),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("set_role_permissions", {
      p_role: data.role,
      p_permission_codes: [...new Set(data.permissionCodes)].sort(),
    });
    if (error) throw error;
  });

export const saveUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ userId: uuidSchema, role: appRoleSchema, assigned: z.boolean() }).strict())
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("set_user_role", {
      p_user_id: data.userId,
      p_role: data.role,
      p_assigned: data.assigned,
    });
    if (error) throw error;
  });

export const getInternalAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InternalAccount[]> => {
    await requireAccountManager(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: authData, error: authError }, { data: profiles, error: profilesError }, { data: userRoles, error: rolesError }] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      supabaseAdmin.from("profiles").select("id, full_name, username"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
    ]);
    if (authError) throw authError;
    if (profilesError) throw profilesError;
    if (rolesError) throw rolesError;

    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const rolesByUser = new Map<string, AppRole[]>();
    for (const row of userRoles ?? []) {
      rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) ?? []), row.role]);
    }

    return (authData.users ?? []).map((user) => internalAccountSchema.parse({
      userId: user.id,
      username: profileById.get(user.id)?.username ?? user.user_metadata?.username ?? user.email?.split("@")[0] ?? "utilisateur",
      fullName: profileById.get(user.id)?.full_name ?? user.user_metadata?.full_name ?? null,
      roles: rolesByUser.get(user.id) ?? [],
      active: !user.banned_until || new Date(user.banned_until).getTime() <= Date.now(),
    })).sort((left, right) => left.username.localeCompare(right.username));
  });

export const createInternalAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(internalAccountInputSchema)
  .handler(async ({ context, data }) => {
    await requireAccountManager(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const username = data.username.toLowerCase();
    const email = `${username}@halalco.local`;
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { username, full_name: data.fullName },
    });
    if (createError) throw createError;
    if (!created.user) throw new Error("Le compte n’a pas pu être créé.");

    try {
      const { error: removeDefaultRoleError } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", created.user.id)
        .eq("role", "lecture_seule");
      if (removeDefaultRoleError) throw removeDefaultRoleError;
      const { error: assignRoleError } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: created.user.id, role: data.role });
      if (assignRoleError) throw assignRoleError;
      await recordAccountAudit(context.userId, "USER_ACCOUNT_CREATED", created.user.id, { username, role: data.role });
    } catch (error) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw error;
    }
  });

export const setInternalAccountActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ userId: uuidSchema, active: z.boolean() }).strict())
  .handler(async ({ context, data }) => {
    await requireAccountManager(context);
    if (data.userId === context.userId && !data.active) throw new Error("Vous ne pouvez pas désactiver votre propre accès.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.active ? "none" : "876000h",
    });
    if (error) throw error;
    await recordAccountAudit(context.userId, "USER_ACCOUNT_ACCESS_CHANGED", data.userId, { active: data.active });
  });

export const updateInternalAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updateInternalAccountSchema)
  .handler(async ({ context, data }) => {
    await requireAccountManager(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const username = data.username.toLowerCase();
    const roles = [...new Set(data.roles)];

    const { data: targetUser, error: targetUserError } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (targetUserError) throw targetUserError;
    if (!targetUser.user) throw new Error("Ce compte utilisateur n'existe plus.");

    const { data: usernameOwner, error: usernameOwnerError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("username", username)
      .neq("id", data.userId)
      .maybeSingle();
    if (usernameOwnerError) throw usernameOwnerError;
    if (usernameOwner) throw new Error("Ce nom d'utilisateur est déjà utilisé.");

    const { data: currentRoleRows, error: currentRolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    if (currentRolesError) throw currentRolesError;
    const currentRoles = (currentRoleRows ?? []).map((row) => row.role);
    if (currentRoles.includes("super_admin") && !roles.includes("super_admin")) {
      const { count, error: superAdminCountError } = await supabaseAdmin
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "super_admin");
      if (superAdminCountError) throw superAdminCountError;
      if ((count ?? 0) <= 1) throw new Error("Le dernier super administrateur doit conserver ce rôle.");
    }

    const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      email: `${username}@halalco.local`,
      email_confirm: true,
      user_metadata: {
        ...(targetUser.user.user_metadata ?? {}),
        username,
        full_name: data.fullName,
      },
    });
    if (authUpdateError) throw authUpdateError;

    const { error: profileUpdateError } = await supabaseAdmin
      .from("profiles")
      .update({ full_name: data.fullName, username })
      .eq("id", data.userId);
    if (profileUpdateError) throw profileUpdateError;

    const { error: removeRolesError } = await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    if (removeRolesError) throw removeRolesError;
    const { error: assignRolesError } = await supabaseAdmin
      .from("user_roles")
      .insert(roles.map((role) => ({ user_id: data.userId, role })));
    if (assignRolesError) throw assignRolesError;

    await recordAccountAudit(context.userId, "USER_ACCOUNT_ACCESS_CHANGED", data.userId, {
      username,
      fullName: data.fullName,
      roles,
    });
  });

export const resetInternalAccountPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ userId: uuidSchema, password: z.string().min(8).max(128) }).strict())
  .handler(async ({ context, data }) => {
    await requireAccountManager(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: data.password });
    if (error) throw error;
    await recordAccountAudit(context.userId, "USER_PASSWORD_RESET", data.userId, {});
  });
