import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Car,
  FileSignature,
  LayoutDashboard,
  Settings,
  UserRoundPlus,
  UsersRound,
  WalletCards,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

type CommandRoute =
  | "/"
  | "/employees"
  | "/drivers"
  | "/vehicles"
  | "/maintenance"
  | "/contracts"
  | "/wallets"
  | "/notifications"
  | "/settings";

interface PaletteItem {
  id: string;
  group: "Navigation" | "Actions rapides";
  label: string;
  description: string;
  icon: LucideIcon;
  to?: CommandRoute;
  disabled?: boolean;
}

const paletteItems: readonly PaletteItem[] = [
  { id: "dashboard", group: "Navigation", label: "Centre de pilotage", description: "Vue d’ensemble de l’activité", icon: LayoutDashboard, to: "/" },
  { id: "employees", group: "Navigation", label: "Employés", description: "Accéder à la liste des employés", icon: UsersRound, to: "/employees" },
  { id: "drivers", group: "Navigation", label: "Chauffeurs", description: "Accéder à la liste des chauffeurs", icon: UserRoundPlus, to: "/drivers" },
  { id: "vehicles", group: "Navigation", label: "Véhicules", description: "Accéder au parc automobile", icon: Car, to: "/vehicles" },
  { id: "maintenance", group: "Navigation", label: "Maintenance", description: "Accéder aux entretiens", icon: Wrench, to: "/maintenance" },
  { id: "wallets", group: "Navigation", label: "Wallets", description: "Consulter la trésorerie", icon: WalletCards, to: "/wallets" },
  { id: "notifications", group: "Navigation", label: "Alertes", description: "Ouvrir le centre de notifications", icon: Bell, to: "/notifications" },
  { id: "settings", group: "Navigation", label: "Paramètres", description: "Ouvrir les préférences ERP", icon: Settings, to: "/settings" },
  { id: "new-employee", group: "Actions rapides", label: "Créer un employé", description: "Action à connecter à un formulaire existant", icon: UsersRound, disabled: true },
  { id: "new-vehicle", group: "Actions rapides", label: "Créer un véhicule", description: "Action à connecter à un formulaire existant", icon: Car, disabled: true },
  { id: "new-contract", group: "Actions rapides", label: "Créer un contrat", description: "Action à connecter à un formulaire existant", icon: FileSignature, disabled: true },
  { id: "new-maintenance", group: "Actions rapides", label: "Créer une maintenance", description: "Action à connecter à un formulaire existant", icon: Wrench, disabled: true },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Navigation and actions are deliberately simulated in this foundation. No
 * entity query or mutation is executed from the palette.
 */
function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  const renderGroup = (group: PaletteItem["group"]) => {
    const items = paletteItems.filter((item) => item.group === group);
    return (
      <CommandGroup heading={group}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <CommandItem
              key={item.id}
              value={`${item.label} ${item.description}`}
              disabled={item.disabled}
              onSelect={() => {
                if (!item.to) return;
                void navigate({ to: item.to });
                onOpenChange(false);
              }}
            >
              <Icon aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.label}</span>
                <span className="block truncate text-caption">{item.description}</span>
              </span>
              {item.disabled ? <CommandShortcut>Bientôt</CommandShortcut> : null}
            </CommandItem>
          );
        })}
      </CommandGroup>
    );
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Rechercher une page ou une action…" />
      <CommandList>
        <CommandEmpty>Aucune action correspondante.</CommandEmpty>
        {renderGroup("Navigation")}
        <CommandSeparator />
        {renderGroup("Actions rapides")}
      </CommandList>
    </CommandDialog>
  );
}

export { CommandPalette };
