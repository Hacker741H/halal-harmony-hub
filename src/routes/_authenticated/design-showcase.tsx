import { createFileRoute } from "@tanstack/react-router";

import { DesignShowcasePage } from "@/components/design-showcase/design-showcase-page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const isDevelopment = import.meta.env.DEV;

export const Route = createFileRoute("/_authenticated/design-showcase")({
  head: () => ({ meta: [{ title: "Design Showcase — HALAL ERP" }] }),
  component: DesignShowcaseRoute,
});

/**
 * This internal reference is deliberately shipped only in development. It is
 * not linked from the product navigation and production users never receive
 * its demonstration content.
 */
function DesignShowcaseRoute() {
  if (!isDevelopment) {
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center px-4 py-12 sm:px-6">
        <Card variant="information" className="w-full">
          <CardHeader>
            <CardTitle>Référence interne indisponible</CardTitle>
            <CardDescription>Le Design Showcase est réservé à l’environnement de développement.</CardDescription>
          </CardHeader>
          <CardContent className="text-body-sm text-muted-foreground">Aucune donnée métier n’est affichée sur cette route.</CardContent>
        </Card>
      </main>
    );
  }

  return <DesignShowcasePage />;
}
