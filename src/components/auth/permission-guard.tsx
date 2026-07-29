import type { ReactNode } from "react";

import { usePermissions } from "@/hooks/use-permissions";

interface PermissionGuardProps {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function Can({ permission, children, fallback = null }: PermissionGuardProps) {
  const { can, isLoading } = usePermissions();
  if (isLoading || !can(permission)) return <>{fallback}</>;
  return <>{children}</>;
}

export function PermissionGuard({ permission, children, fallback }: PermissionGuardProps) {
  const { can, isLoading } = usePermissions();
  if (isLoading) return <p className="text-sm text-muted-foreground">Vérification des permissions…</p>;
  if (!can(permission)) {
    return <>{fallback ?? <p className="text-sm text-destructive">Vous n’avez pas la permission d’accéder à cette section.</p>}</>;
  }
  return <>{children}</>;
}

export const RequirePermission = PermissionGuard;
