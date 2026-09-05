import { createFileRoute, redirect } from "@tanstack/react-router";

// Inventaires vit désormais comme onglet de /stock-operations -- cette
// redirection garde vivants les signets et liens existants vers cette URL.
export const Route = createFileRoute("/_authenticated/inventory-counts/")({
  beforeLoad: () => {
    throw redirect({ to: "/stock-operations" });
  },
});
