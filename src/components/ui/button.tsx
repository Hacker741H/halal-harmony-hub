import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold cursor-pointer transition-[background-color,border-color,color,box-shadow,transform] transition-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-[var(--ds-opacity-disabled)] disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-primary text-primary-foreground shadow-sm hover:-translate-y-px hover:shadow-md active:translate-y-px active:shadow-xs",
        primary:
          "bg-gradient-primary text-primary-foreground shadow-sm hover:-translate-y-px hover:shadow-md active:translate-y-px active:shadow-xs",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 active:translate-y-px active:shadow-none",
        danger:
          "bg-danger text-danger-foreground shadow-xs hover:bg-danger/90 active:translate-y-px active:shadow-none",
        outline:
          "border border-input bg-surface text-foreground shadow-xs hover:-translate-y-px hover:border-primary/25 hover:bg-surface-hover hover:text-accent-foreground active:translate-y-px",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80 active:translate-y-px active:shadow-none",
        success:
          "bg-success text-success-foreground shadow-xs hover:bg-success/90 active:translate-y-px active:shadow-none",
        ghost: "hover:bg-surface-hover hover:text-accent-foreground active:bg-accent/80",
        link: "text-primary underline-offset-4 hover:underline",
        floating:
          "bg-gradient-primary text-primary-foreground shadow-md hover:-translate-y-px hover:shadow-lg active:translate-y-px active:shadow-sm",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-5 text-base",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8",
        "icon-lg": "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  loadingLabel?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingLabel = "Chargement",
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";

    if (asChild) {
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          data-variant={variant ?? "default"}
          aria-busy={loading || undefined}
          {...props}
        >
          {children}
        </Comp>
      );
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        data-variant={variant ?? "default"}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
        {children}
        {loading ? <span className="sr-only">{loadingLabel}</span> : null}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
