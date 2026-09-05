import { createFileRoute, redirect } from "@tanstack/react-router";

// Transferts vit désormais comme onglet de /stock-operations -- cette
// redirection garde vivants les signets et liens existants vers cette URL.
export const Route = createFileRoute("/_authenticated/stock-transfers/")({
  beforeLoad: () => {
    throw redirect({ to: "/stock-operations" });
  },
});
