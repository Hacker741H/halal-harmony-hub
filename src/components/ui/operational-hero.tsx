import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type OperationalHeroStatTone = "neutral" | "success" | "warning" | "danger" | "info";

interface OperationalHeroStat {
  label: string;
  value: ReactNode;
  /** Only rendered on the "deep" variant, where each stat gets its own tinted pill. */
  tone?: OperationalHeroStatTone;
}

interface OperationalHeroProps {
  icon: LucideIcon;
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** The single most useful existing number for this module -- shown large, first. */
  primaryStat?: OperationalHeroStat;
  /** 0-2 supporting numbers, shown smaller next to the primary stat. */
  secondaryStats?: readonly OperationalHeroStat[];
  actions?: ReactNode;
  className?: string;
  /**
   * "tinted" (default) is the original light, primary-tinted banner -- unchanged.
   * "deep" reuses the exact dark sidebar-green surface ModuleHero uses for
   * Dashboard/Control Center, with each stat rendered as its own tone-tinted
   * pill. Reserved for screens validated against the real product reference.
   */
  variant?: "tinted" | "deep";
}

const deepPillClasses: Record<OperationalHeroStatTone, string> = {
  neutral: "border-sidebar-foreground/10 bg-sidebar-foreground/[0.06]",
  success: "border-sidebar-primary/30 bg-sidebar-primary/15",
  warning: "border-warning/30 bg-warning/15",
  danger: "border-destructive/30 bg-destructive/15",
  info: "border-info/30 bg-info/15",
};

const deepLabelClasses: Record<OperationalHeroStatTone, string> = {
  neutral: "text-sidebar-foreground/70",
  success: "text-sidebar-primary",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
};

/**
 * A light, primary-tinted identity banner for standard operational screens
 * (Clients, Vehicules, Wallets, ...). Sits deliberately between PageHeader
 * (no surface, no stats -- currently too weightless to read as "premium")
 * and ModuleHero (dark sidebar surface, reserved for command centers):
 * same identity-first layout language -- icon + eyebrow + title first,
 * then the number that matters, then actions -- on its own sober, bounded,
 * lightly-tinted surface rather than either of those two treatments.
 */
export function OperationalHero({
  icon: Icon,
  eyebrow,
  title,
  description,
  primaryStat,
  secondaryStats,
  actions,
  className,
  variant = "tinted",
}: OperationalHeroProps) {
  if (variant === "deep") {
    const stats = [primaryStat, ...(secondaryStats ?? [])].filter((stat): stat is OperationalHeroStat => Boolean(stat));

    return (
      <section
        className={cn(
          "relative overflow-hidden rounded-2xl border border-sidebar-border/60 bg-sidebar px-5 py-4 text-sidebar-foreground shadow-sm sm:px-6 sm:py-4.5",
          className,
        )}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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

          {stats.length ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {stats.map((stat, index) => (
                <div
                  key={index}
                  className={cn("rounded-xl border px-3.5 py-2 text-right", deepPillClasses[stat.tone ?? "neutral"])}
                >
                  <p className={cn("text-[11px] font-semibold uppercase tracking-wide", deepLabelClasses[stat.tone ?? "neutral"])}>
                    {stat.label}
                  </p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums text-sidebar-foreground sm:text-2xl">{stat.value}</p>
                </div>
              ))}
            </div>
          ) : null}

          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.06] via-surface to-surface px-5 py-4 shadow-sm sm:px-6 sm:py-4.5",
        className,
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            {eyebrow}
          </div>
          <h1 className="mt-1.5 truncate text-h2 text-foreground sm:text-h1">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </div>

        {primaryStat ? (
          <div className="flex shrink-0 items-center gap-6 border-t border-primary/10 pt-3 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0">
            <div className="text-right">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{primaryStat.label}</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground sm:text-3xl">{primaryStat.value}</p>
            </div>
            {secondaryStats?.map((stat, index) => (
              <div key={index} className="text-right">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{stat.label}</p>
                <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{stat.value}</p>
              </div>
            ))}
          </div>
        ) : null}

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </section>
  );
}
