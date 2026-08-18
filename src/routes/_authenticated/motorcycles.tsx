import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/motorcycles")({
  component: MotorcyclesLayout,
});

function MotorcyclesLayout() {
  return <Outlet />;
}
