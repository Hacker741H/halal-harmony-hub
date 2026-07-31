import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none transition-[background-color,border-color,color] transition-ui-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        outline: "border-border bg-transparent text-foreground",
        neutral: "",
        success: "",
        warning: "",
        danger: "",
        info: "",
        premium: "",
      },
      appearance: {
        soft: "",
        solid: "",
        outline: "",
      },
    },
    compoundVariants: [
      { variant: "neutral", appearance: "soft", class: "border-transparent bg-muted text-muted-foreground" },
      { variant: "neutral", appearance: "solid", class: "border-transparent bg-foreground text-background" },
      { variant: "neutral", appearance: "outline", class: "border-border bg-transparent text-foreground" },
      { variant: "success", appearance: "soft", class: "border-success/20 bg-success/10 text-success" },
      { variant: "success", appearance: "solid", class: "border-transparent bg-success text-success-foreground" },
      { variant: "success", appearance: "outline", class: "border-success/40 bg-transparent text-success" },
      { variant: "warning", appearance: "soft", class: "border-warning/20 bg-warning/10 text-warning-foreground" },
      { variant: "warning", appearance: "solid", class: "border-transparent bg-warning text-warning-foreground" },
      { variant: "warning", appearance: "outline", class: "border-warning/45 bg-transparent text-warning-foreground" },
      { variant: "danger", appearance: "soft", class: "border-destructive/20 bg-destructive/10 text-destructive" },
      { variant: "danger", appearance: "solid", class: "border-transparent bg-destructive text-destructive-foreground" },
      { variant: "danger", appearance: "outline", class: "border-destructive/40 bg-transparent text-destructive" },
      { variant: "info", appearance: "soft", class: "border-info/20 bg-info/10 text-info" },
      { variant: "info", appearance: "solid", class: "border-transparent bg-info text-info-foreground" },
      { variant: "info", appearance: "outline", class: "border-info/40 bg-transparent text-info" },
      { variant: "premium", appearance: "soft", class: "border-gold/25 bg-gold/10 text-gold-foreground" },
      { variant: "premium", appearance: "solid", class: "border-transparent bg-gold text-gold-foreground" },
      { variant: "premium", appearance: "outline", class: "border-gold/45 bg-transparent text-gold-foreground" },
    ],
    defaultVariants: {
      variant: "default",
      appearance: "soft",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, appearance, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, appearance }), className)} {...props} />;
}

export { Badge, badgeVariants };
