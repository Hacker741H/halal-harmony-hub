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
  | "/payments"
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
  { id: "new-employee", group: "Actions rapides", label: "Nouvel employé", description: "Ouvrir le formulaire existant", icon: UsersRound },
  { id: "new-vehicle", group: "Actions rapides", label: "Nouveau véhicule", description: "Ouvrir le formulaire existant", icon: Car },
  { id: "new-contract", group: "Actions rapides", label: "Nouveau contrat", description: "Ouvrir le formulaire existant", icon: FileSignature },
  { id: "new-maintenance", group: "Actions rapides", label: "Nouvel entretien véhicule", description: "Ouvrir le formulaire existant", icon: Wrench },
  { id: "new-motorcycle-maintenance", group: "Actions rapides", label: "Nouvel entretien moto", description: "Ouvrir le formulaire existant", icon: Wrench },
  { id: "new-payment", group: "Actions rapides", label: "Nouveau versement", description: "Ouvrir le formulaire existant", icon: WalletCards },
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

  const selectItem = (item: PaletteItem) => {
    switch (item.id) {
      case "new-employee":
        void navigate({ to: "/employees", search: { create: "true" } });
        break;
      case "new-vehicle":
        void navigate({ to: "/vehicles", search: { create: "true" } });
        break;
      case "new-contract":
        void navigate({ to: "/contracts", search: { create: "true" } });
        break;
      case "new-maintenance":
        void navigate({ to: "/maintenance", search: { create: "vehicle" } });
        break;
      case "new-motorcycle-maintenance":
        void navigate({ to: "/maintenance", search: { create: "motorcycle" } });
        break;
      case "new-payment":
        void navigate({ to: "/payments", search: { create: "true" } });
        break;
      default:
        if (item.to) void navigate({ to: item.to });
    }
    onOpenChange(false);
  };

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
              onSelect={() => selectItem(item)}
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
