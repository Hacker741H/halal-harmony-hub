import { createFileRoute } from "@tanstack/react-router";

import { FieldReportWorkspace } from "@/components/field/field-workspace";

export const Route = createFileRoute("/_authenticated/field/$reportId")({
  component: FieldReportRoute,
});

function FieldReportRoute() {
  const { reportId } = Route.useParams();
  return <FieldReportWorkspace reportId={reportId} />;
}
