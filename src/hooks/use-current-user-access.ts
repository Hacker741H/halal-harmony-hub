import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  getCurrentUserIdentity,
  type AppRole,
} from "@/lib/permissions.functions";

const cashierCompatibleRoles = new Set<AppRole>(["caissier", "lecture_seule"]);

/**
 * A cashier account can retain the legacy read-only role, but must not expose
 * any other operational role before the point-of-sale shell is enforced.
 */
export function isCashierOnly(roles: readonly AppRole[] | undefined): boolean {
  if (!roles?.includes("caissier")) return false;
  return roles.every((role) => cashierCompatibleRoles.has(role));
}

export function useCurrentUserAccess(enabled = true) {
  const fetchIdentity = useServerFn(getCurrentUserIdentity);
  const query = useQuery({
    queryKey: ["current-user-identity"],
    queryFn: () => fetchIdentity(),
    enabled,
    staleTime: 60_000,
  });

  return {
    ...query,
    isCashierOnly: isCashierOnly(query.data?.roles),
  };
}
