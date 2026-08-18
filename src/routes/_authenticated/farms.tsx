import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/farms")({
  component: FarmsLayout,
});

function FarmsLayout() {
  return <Outlet />;
}
