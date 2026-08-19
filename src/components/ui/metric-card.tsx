import type { LucideIcon } from "lucide-react";

import { Card, cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type MetricTone = "primary" | "success" | "warning" | "danger" | "info" | "neutral";

const toneClasses: Record<MetricTone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning-foreground",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  neutral: "bg-muted text-muted-foreground",
};

interface MetricCardProps {
  label: string;
  value: string | number;
  description: string;
  icon: LucideIcon;
  tone?: MetricTone;
  onClick?: () => void;
  className?: string;
}

/** A compact metric tile for module summaries -- content-sized, not padded
 * out to a fixed height, and interactive only when it needs to be. */
export function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone = "primary",
  onClick,
  className,
}: MetricCardProps) {
  const content = (
    <>
      <div className={cn("absolute inset-x-0 top-0 h-0.5", toneClasses[tone])} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <p className="text-label text-muted-foreground">{label}</p>
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", toneClasses[tone])}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl" title={String(value)}>
        {value}
      </p>
      <p className="mt-1 truncate text-caption" title={description}>{description}</p>
    </>
  );
  const sharedClassName = cn(
    "relative overflow-hidden p-4 text-left transition-[border-color,box-shadow] transition-ui-fast hover:border-primary/25 hover:shadow-sm",
    className,
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(cardVariants({ variant: "kpi" }), sharedClassName, "w-full")}>
        {content}
      </button>
    );
  }

  return (
    <Card variant="kpi" className={sharedClassName}>
      {content}
    </Card>
  );
}
