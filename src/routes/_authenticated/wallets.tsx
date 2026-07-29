import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/wallets")({ component: WalletsLayout });

function WalletsLayout() {
  return <Outlet />;
}
