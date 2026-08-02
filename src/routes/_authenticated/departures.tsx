import { createFileRoute } from "@tanstack/react-router";

import { OperationalCourseWorkspace } from "@/components/courses/operational-course-workspace";

export const Route = createFileRoute("/_authenticated/departures")({ component: DeparturesPage });

function DeparturesPage() {
  return <OperationalCourseWorkspace kind="departures" />;
}
