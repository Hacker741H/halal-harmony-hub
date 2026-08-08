import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/sales")({ component: SalesLayout });

function SalesLayout() {
  return <Outlet />;
}
