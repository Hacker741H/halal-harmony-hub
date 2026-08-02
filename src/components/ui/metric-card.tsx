import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type MetricTone = "primary" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<MetricTone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning-foreground",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
};

interface MetricCardProps {
  label: string;
  value: string | number;
  description: string;
  icon: LucideIcon;
  tone?: MetricTone;
  className?: string;
}

/** A visual-only metric card for module summaries. */
export function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone = "primary",
  className,
}: MetricCardProps) {
  return (
    <Card
      variant="kpi"
      className={cn(
        "group overflow-hidden transition-[border-color,box-shadow,transform] transition-ui hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md",
        className,
      )}
    >
      <CardContent className="flex min-h-36 flex-col justify-between gap-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", toneClasses[tone])}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>
        <div className="space-y-1">
          <p
            className="break-words text-2xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere] sm:text-3xl"
            title={String(value)}
          >
            {value}
          </p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
