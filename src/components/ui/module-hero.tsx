import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface ModuleHeroStat {
  label: string;
  value: ReactNode;
}

interface ModuleHeroProps {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description?: string;
  stats?: readonly ModuleHeroStat[];
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * A compact presentational header shared by operational ERP workspaces.
 * Density is deliberate: this is a title bar with an optional stat strip,
 * not a decorative banner -- real content should start right below it.
 */
export function ModuleHero({
  icon: Icon,
  eyebrow,
  title,
  description,
  stats,
  actions,
  children,
  className,
}: ModuleHeroProps) {
  return (
    <section
      className={cn(
        "relative isolate overflow-hidden rounded-2xl border border-sidebar-border/60 bg-sidebar px-5 py-4 text-sidebar-foreground shadow-sm sm:px-6 sm:py-4.5",
        className,
      )}
    >
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/70">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sidebar-foreground/15 bg-sidebar-foreground/10 text-sidebar-foreground">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            {eyebrow}
          </div>
          <h1 className="mt-1.5 truncate text-h2 text-sidebar-foreground sm:text-h1">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-sidebar-foreground/65">{description}</p>
          ) : null}
        </div>

        {stats?.length ? (
          <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-sidebar-foreground/10 pt-3 lg:border-t-0 lg:border-l lg:pl-5 lg:pt-0">
            {stats.map((stat, index) => (
              <div key={index} className="text-right">
                <p className="text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/55">{stat.label}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-sidebar-foreground">{stat.value}</p>
              </div>
            ))}
          </div>
        ) : null}

        {actions ? (
          <div
            className={cn(
              "flex shrink-0 flex-wrap items-center gap-2 rounded-xl bg-sidebar-foreground/[0.08] p-1.5",
              // Only recolor buttons that don't already carry their own
              // meaning-bearing variant. Forcing every button to the same
              // white pill made a destructive action (e.g. "Annuler" on a
              // récolte) render identically to the primary action next to
              // it -- the two were indistinguishable at a glance.
              "[&>button:not([data-variant=destructive]):not([data-variant=danger])]:border-transparent",
              "[&>button:not([data-variant=destructive]):not([data-variant=danger])]:bg-sidebar-foreground",
              "[&>button:not([data-variant=destructive]):not([data-variant=danger])]:text-sidebar",
              "[&>button:not([data-variant=destructive]):not([data-variant=danger])]:shadow-sm",
              "[&>button:not([data-variant=destructive]):not([data-variant=danger]):hover]:opacity-90",
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
      {children ? <div className="relative mt-4">{children}</div> : null}
    </section>
  );
}
