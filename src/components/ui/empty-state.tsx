import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card variant="compact" className={`border-dashed p-10 text-center ${className ?? ""}`}>
      <Icon className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 font-medium text-foreground">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}

export function ErrorState({
  title,
  description = "Réessayez dans un instant ou vérifiez votre connexion.",
  onRetry,
  className,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Card variant="information" role="alert" className={`border-destructive/20 bg-destructive/5 p-8 text-center ${className ?? ""}`}>
      <p className="font-medium text-destructive">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Réessayer
        </Button>
      ) : null}
    </Card>
  );
}
