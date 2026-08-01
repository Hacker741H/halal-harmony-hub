import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/field")({ component: FieldLayout });

function FieldLayout() {
  return <Outlet />;
}
