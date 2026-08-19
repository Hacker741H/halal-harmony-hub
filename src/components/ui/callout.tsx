import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type CalloutTone = "info" | "success" | "warning" | "danger";

const toneClasses: Record<CalloutTone, string> = {
  info: "border-info/20 bg-info/[0.06] text-info",
  success: "border-success/20 bg-success/[0.06] text-success",
  warning: "border-warning/25 bg-warning/[0.08] text-warning-foreground",
  danger: "border-destructive/20 bg-destructive/[0.06] text-destructive",
};

interface CalloutProps {
  tone?: CalloutTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}

/** Shared inline banner for transitory/contextual state -- the Caisse's
 * "rounded-xl border-{ton}/20 bg-{ton}/[0.06]" formula, named once so it
 * stops being re-styled by hand at every call site. */
export function Callout({ tone = "info", icon: Icon, children, className }: CalloutProps) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border px-4 py-2.5 text-sm", toneClasses[tone], className)} role={tone === "danger" ? "alert" : undefined}>
      {Icon ? <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
