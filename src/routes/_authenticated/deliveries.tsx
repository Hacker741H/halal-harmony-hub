import { createFileRoute } from "@tanstack/react-router";

import { OperationalCourseWorkspace } from "@/components/courses/operational-course-workspace";

export const Route = createFileRoute("/_authenticated/deliveries")({ component: DeliveriesPage });

function DeliveriesPage() {
  return <OperationalCourseWorkspace kind="deliveries" />;
}
