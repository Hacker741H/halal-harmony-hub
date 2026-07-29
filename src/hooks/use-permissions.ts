import { useQuery } from "@tanstack/react-query";

import { getCurrentPermissions } from "@/lib/permissions.functions";

export function usePermissions() {
  const query = useQuery({
    queryKey: ["current-permissions"],
    queryFn: () => getCurrentPermissions(),
    staleTime: 60_000,
  });
  const permissions = new Set(query.data ?? []);

  return {
    ...query,
    permissions,
    can: (permission: string) => permissions.has(permission),
    canAny: (requested: readonly string[]) => requested.some((permission) => permissions.has(permission)),
    canAll: (requested: readonly string[]) => requested.every((permission) => permissions.has(permission)),
  };
}
