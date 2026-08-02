import { createFileRoute } from "@tanstack/react-router";

import { OperationalCourseWorkspace } from "@/components/courses/operational-course-workspace";

export const Route = createFileRoute("/_authenticated/assignments")({ component: AssignmentsPage });

function AssignmentsPage() {
  return <OperationalCourseWorkspace kind="assignments" />;
}
