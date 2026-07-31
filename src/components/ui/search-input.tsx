import * as React from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchInputProps extends Omit<React.ComponentProps<typeof Input>, "className" | "type"> {
  className?: string;
  inputClassName?: string;
  label?: string;
  onClear?: () => void;
}

/** Search field styling shared by future list and command surfaces. */
const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, inputClassName, label = "Rechercher", onClear, value, ...props }, ref) => (
    <label className={cn("relative block", className)}>
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        ref={ref}
        type="search"
        value={value}
        className={cn("pl-9", onClear && value ? "pr-10" : undefined, inputClassName)}
        {...props}
      />
      {onClear && value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onClick={onClear}
          aria-label="Effacer la recherche"
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </label>
  ),
);
SearchInput.displayName = "SearchInput";

export { SearchInput };
