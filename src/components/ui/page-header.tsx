import * as React from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

/** A layout-only page heading for future screen migrations. */
function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  children,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={cn("flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between", className)}
      {...props}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? <p className="text-overline text-primary">{eyebrow}</p> : null}
        <h1 className="text-h1 text-foreground">{title}</h1>
        {description ? <p className="max-w-2xl text-body-sm text-muted-foreground">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

const PageHeaderActions = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-wrap items-center gap-2", className)} {...props} />
);
PageHeaderActions.displayName = "PageHeaderActions";

export { PageHeader, PageHeaderActions };
