import { createFileRoute } from "@tanstack/react-router";
import { CommercePosWorkspace } from "@/components/commerce/commerce-pos-workspace";
import { useCurrentUserAccess } from "@/hooks/use-current-user-access";

export const Route = createFileRoute("/_authenticated/commerce/")({ component: CommercePage });
function CommercePage() {
  const access = useCurrentUserAccess();
  if (access.isCashierOnly) {
    return <main className="p-2 sm:p-3 lg:overflow-hidden"><CommercePosWorkspace /></main>;
  }
  return <main className="mx-auto h-full min-h-0 max-w-(--ds-content-max-width) p-3 sm:p-4 xl:p-5"><CommercePosWorkspace /></main>;
}
