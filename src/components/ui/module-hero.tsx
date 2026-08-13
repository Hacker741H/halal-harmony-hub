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
        "relative isolate overflow-hidden rounded-[2rem] border border-primary/30 bg-[#042b1d] p-6 text-white shadow-lg shadow-primary/10 sm:p-8",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_88%_8%,rgba(16,185,129,.42),transparent_30%),radial-gradient(circle_at_3%_100%,rgba(45,212,191,.16),transparent_28%),linear-gradient(115deg,rgba(255,255,255,.07)_1px,transparent_1px),linear-gradient(25deg,rgba(255,255,255,.035)_1px,transparent_1px)] bg-[length:auto,auto,28px_28px,28px_28px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald/20 blur-3xl"
      />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-emerald-200 shadow-xs">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            {eyebrow}
          </div>
          <div className="space-y-1.5">
            <h1 className="text-h1 text-white">{title}</h1>
            <p className="max-w-2xl text-sm leading-6 text-emerald-50/75 sm:text-base">
              {description}
            </p>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.08] p-2 backdrop-blur-sm [&>button]:border-transparent [&>button]:bg-white [&>button]:text-primary [&>button]:shadow-sm [&>button:hover]:bg-emerald-50">{actions}</div> : null}
      </div>
      {children ? <div className="relative mt-6">{children}</div> : null}
    </section>
  );
}
