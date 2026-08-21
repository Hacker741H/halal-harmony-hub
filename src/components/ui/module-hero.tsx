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
  /**
   * "sidebar" (default) is the original dark, sidebar-tinted command-center
   * treatment used by Pilotage/Centre de contrôle/Vente détail -- unchanged.
   * "surface" is a lighter, primary-tinted treatment for workspaces that
   * want the hero shape (identity + stats + actions) without adopting the
   * dark command-center identity. Omitting this prop reproduces the exact
   * previous output byte-for-byte.
   */
  variant?: "sidebar" | "surface";
  /** Adds the two soft blurred glow orbs used by the "surface" variant. No-op on "sidebar". Defaults to false. */
  glow?: boolean;
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
  variant = "sidebar",
  glow = false,
}: ModuleHeroProps) {
  const isSurface = variant === "surface";

  return (
    <section
      className={cn(
        "relative isolate overflow-hidden rounded-2xl px-5 py-4 shadow-sm sm:px-6 sm:py-4.5",
        isSurface
          ? "border border-primary/15 bg-gradient-to-br from-primary/10 via-surface-elevated to-surface text-foreground shadow-md"
          : "border border-sidebar-border/60 bg-sidebar text-sidebar-foreground",
        className,
      )}
    >
      {isSurface && glow ? (
        <>
          <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-primary/15 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 size-64 rounded-full bg-info/10 blur-3xl" aria-hidden="true" />
        </>
      ) : null}
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]",
              isSurface ? "text-primary" : "text-sidebar-foreground/70",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
                isSurface
                  ? "border-primary/20 bg-primary/10 text-primary"
                  : "border-sidebar-foreground/15 bg-sidebar-foreground/10 text-sidebar-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            {eyebrow}
          </div>
          <h1 className={cn("mt-1.5 truncate text-h2 sm:text-h1", isSurface ? "text-foreground" : "text-sidebar-foreground")}>{title}</h1>
          {description ? (
            <p className={cn("mt-1 max-w-2xl text-sm leading-6", isSurface ? "text-muted-foreground" : "text-sidebar-foreground/65")}>
              {description}
            </p>
          ) : null}
        </div>

        {stats?.length ? (
          <div
            className={cn(
              "flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 lg:border-t-0 lg:border-l lg:pl-5 lg:pt-0",
              isSurface ? "border-border/70" : "border-sidebar-foreground/10",
            )}
          >
            {stats.map((stat, index) => (
              <div key={index} className="text-right">
                <p className={cn("text-[11px] font-medium uppercase tracking-wide", isSurface ? "text-muted-foreground" : "text-sidebar-foreground/55")}>
                  {stat.label}
                </p>
                <p className={cn("mt-0.5 text-sm font-semibold tabular-nums", isSurface ? "text-foreground" : "text-sidebar-foreground")}>
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {actions ? (
          <div
            className={cn(
              "flex shrink-0 flex-wrap items-center gap-2",
              isSurface
                ? ""
                : cn(
                    "rounded-xl bg-sidebar-foreground/[0.08] p-1.5",
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
                  ),
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
