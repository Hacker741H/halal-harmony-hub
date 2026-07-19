import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Sparkles } from "lucide-react";

interface ModulePlaceholderProps {
  title: string;
  description: string;
  icon: ReactNode;
  features?: string[];
  notionMapping?: string;
  primaryAction?: string;
}

export function ModulePlaceholder({
  title,
  description,
  icon,
  features = [],
  notionMapping,
  primaryAction = "Nouvel élément",
}: ModulePlaceholderProps) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant">
            {icon}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold-foreground">
            Module actif
          </Badge>
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" />
            {primaryAction}
          </Button>
        </div>
      </header>

      <Card className="border-dashed p-8">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-1 h-5 w-5 text-emerald" />
            <div>
              <h2 className="font-display text-lg font-semibold">Aucune donnée pour le moment</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ce module est connecté à la base de données et prêt à recevoir vos enregistrements.
                Les formulaires de saisie et les vues détaillées seront ajoutés dans la prochaine
                itération.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {features.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Fonctionnalités prévues
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <Card key={f} className="p-4 text-sm">
                <div className="flex items-start gap-2">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald" />
                  <span>{f}</span>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {notionMapping && (
        <Card className="border-emerald/30 bg-emerald/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald">
            Correspondance Notion
          </p>
          <p className="mt-1 font-mono text-sm text-foreground/80">{notionMapping}</p>
        </Card>
      )}
    </div>
  );
}
