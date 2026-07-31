import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  keywords?: string[];
  disabled?: boolean;
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  renderOption?: (option: ComboboxOption) => React.ReactNode;
}

/**
 * Generic, controlled search selector for future forms. It only returns an
 * identifier, keeping entity data in the source that owns it.
 */
function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Sélectionner une option",
  searchPlaceholder = "Rechercher…",
  emptyLabel = "Aucun résultat.",
  disabled = false,
  className,
  triggerClassName,
  renderOption,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const selectedOption = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !selectedOption && "text-muted-foreground", triggerClassName)}
        >
          <span className="truncate">{selectedOption?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-(--radix-popover-trigger-width) min-w-64 p-0", className)} align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList id={listId}>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={[option.label, option.description, ...(option.keywords ?? [])].filter(Boolean).join(" ")}
                  disabled={option.disabled}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("size-4", value === option.value ? "opacity-100" : "opacity-0")}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    {renderOption ? renderOption(option) : (
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate">{option.label}</span>
                        {option.description ? <span className="truncate text-caption">{option.description}</span> : null}
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const Autocomplete = Combobox;

export { Autocomplete, Combobox };
