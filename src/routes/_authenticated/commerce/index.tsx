import { createFileRoute } from "@tanstack/react-router";
import { CommercePosWorkspace } from "@/components/commerce/commerce-pos-workspace";

export const Route = createFileRoute("/_authenticated/commerce/")({ component: CommercePage });
function CommercePage() {
  return <main className="mx-auto h-full min-h-0 max-w-(--ds-content-max-width) p-3 sm:p-4 xl:p-5"><CommercePosWorkspace /></main>;
}
