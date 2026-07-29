import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage } from "@/components/documents/documents-page";

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({ meta: [{ title: "Documents — HALAL ERP" }] }),
  component: DocumentsPage,
});
