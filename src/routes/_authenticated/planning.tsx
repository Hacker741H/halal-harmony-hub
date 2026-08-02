import { createFileRoute } from "@tanstack/react-router";

import { OperationalCourseWorkspace } from "@/components/courses/operational-course-workspace";

export const Route = createFileRoute("/_authenticated/planning")({ component: PlanningPage });

function PlanningPage() {
  return <OperationalCourseWorkspace kind="planning" />;
}
