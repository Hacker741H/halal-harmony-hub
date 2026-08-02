import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface ModuleHeroProps {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** A presentational header shared by operational ERP workspaces. */
export function ModuleHero({
  icon: Icon,
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: ModuleHeroProps) {
  return (
    <section
      className={cn(
        "relative isolate overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-surface-elevated to-surface p-5 shadow-md sm:p-7",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/15 blur-3xl"
      />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            {eyebrow}
          </div>
          <div className="space-y-1.5">
            <h1 className="text-h1 text-foreground">{title}</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              {description}
            </p>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="relative mt-6">{children}</div> : null}
    </section>
  );
}
