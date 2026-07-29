import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/contracts")({
  component: ContractsLayout,
});

function ContractsLayout() {
  return <Outlet />;
}
