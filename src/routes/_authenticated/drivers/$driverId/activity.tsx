import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { DriverActivityRemuneration } from "@/components/drivers/driver-activity-remuneration";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/drivers/$driverId/activity")({
  component: DriverActivityPage,
});

function DriverActivityPage() {
  const { driverId } = Route.useParams();

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost">
        <Link to="/drivers/$driverId" params={{ driverId }}>
          <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
          Retour au chauffeur
        </Link>
      </Button>
      <DriverActivityRemuneration driverId={driverId} />
    </div>
  );
}
