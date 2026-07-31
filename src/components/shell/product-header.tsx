import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  ChevronDown,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Sun,
  UserRound,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useTheme, type Theme } from "@/components/ui/theme-provider";
import { cn } from "@/lib/utils";
import { ShellBreadcrumbs } from "@/components/shell/shell-breadcrumbs";
import {
  useShellPreferences,
  type ShellDensity,
  type ShellSidebarWidth,
} from "@/components/shell/shell-preferences";

const CommandPalette = React.lazy(async () => {
  const module = await import("@/components/shell/command-palette");
  return { default: module.CommandPalette };
});

interface ProductHeaderProps {
  user: {
    email?: string;
    fullName?: string;
  } | null;
  onSignOut: () => void | Promise<void>;
}

function initialsFor(user: ProductHeaderProps["user"]): string {
  return (user?.fullName ?? user?.email ?? "?")
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function isTheme(value: string): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function isShellDensity(value: string): value is ShellDensity {
  return value === "compact" || value === "standard" || value === "comfortable";
}

function isShellSidebarWidth(value: string): value is ShellSidebarWidth {
  return value === "compact" || value === "comfortable";
}

interface UniversalSearchProps {
  onOpen: () => void;
  placeholder?: string;
  shortcutLabel?: string;
}

/** Interface-only entry point for a future cross-ERP search provider. */
function UniversalSearch({
  onOpen,
  placeholder = "Rechercher dans HALAL ERP",
  shortcutLabel = "⌘ K",
}: UniversalSearchProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hidden h-10 min-w-72 items-center gap-3 rounded-md border border-input bg-surface px-3.5 text-left text-sm text-muted-foreground shadow-xs transition-[border-color,box-shadow,background-color] transition-ui hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 lg:flex"
      aria-label="Ouvrir la recherche universelle"
    >
      <Search className="size-4" aria-hidden="true" />
      <span className="flex-1">{placeholder}</span>
      <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{shortcutLabel}</kbd>
    </button>
  );
}

function QuickActionsMenu() {
  const actions = ["Employé", "Véhicule", "Contrat", "Maintenance", "Paiement"];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="primary" size="sm" className="hidden sm:inline-flex">
          <Plus aria-hidden="true" />
          Créer
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Actions rapides</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {actions.map((action) => (
          <DropdownMenuItem key={action} disabled>
            <Plus aria-hidden="true" />
            <span className="flex-1">Créer {action}</span>
            <span className="text-caption">Bientôt</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActivityCenter() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="relative" aria-label="Ouvrir le centre d’activité">
          <Bell aria-hidden="true" />
          <span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-gold" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="font-semibold">Centre d’activité</p>
            <p className="text-caption">Interface prête à recevoir les alertes ERP.</p>
          </div>
          <Badge variant="neutral" appearance="soft">0 non lue</Badge>
        </div>
        <div className="space-y-4 p-4 text-sm">
          {[
            ["Non lues", "Les nouvelles alertes apparaîtront ici."],
            ["Aujourd’hui", "Aucune activité affichée dans cette interface de fondation."],
            ["Cette semaine", "Les activités récentes seront regroupées ici."],
          ].map(([title, message]) => (
            <section key={title} aria-label={title}>
              <h3 className="text-overline text-muted-foreground">{title}</h3>
              <p className="mt-1.5 rounded-md border border-dashed bg-muted/35 px-3 py-2.5 text-body-sm text-muted-foreground">{message}</p>
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ShellPreferencesMenu() {
  const { theme, setTheme } = useTheme();
  const { density, setDensity, sidebarWidth, setSidebarWidth } = useShellPreferences();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <SlidersHorizontal aria-hidden="true" />
        Préférences du shell
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        <DropdownMenuLabel>Thème</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => { if (isTheme(value)) setTheme(value); }}>
          <DropdownMenuRadioItem value="light"><Sun aria-hidden="true" />Clair</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon aria-hidden="true" />Sombre</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Monitor aria-hidden="true" />Système</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Densité</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={density} onValueChange={(value) => { if (isShellDensity(value)) setDensity(value); }}>
          <DropdownMenuRadioItem value="compact">Compacte</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="standard">Standard</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="comfortable">Confortable</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Sidebar</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sidebarWidth} onValueChange={(value) => { if (isShellSidebarWidth(value)) setSidebarWidth(value); }}>
          <DropdownMenuRadioItem value="compact">Compacte</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="comfortable">Confortable</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ProfileMenu({ user, onSignOut }: ProductHeaderProps) {
  const initials = initialsFor(user);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" className="h-10 gap-2 px-1.5 sm:px-2" aria-label="Ouvrir le menu du profil">
          <Avatar className="size-7 border border-border">
            <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">{initials || "HE"}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 text-left sm:block">
            <span className="block truncate text-xs font-semibold text-foreground">{user?.fullName ?? "Utilisateur"}</span>
            <span className="block truncate text-[11px] font-normal text-muted-foreground">Accès utilisateur</span>
          </span>
          <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>
          <span className="flex items-start gap-3">
            <Avatar className="size-9 border border-border">
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">{initials || "HE"}</AvatarFallback>
            </Avatar>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{user?.fullName ?? "Utilisateur"}</span>
              <span className="block truncate text-caption">{user?.email ?? "Session authentifiée"}</span>
              <span className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Accès utilisateur</span>
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to="/settings"><Settings2 aria-hidden="true" />Paramètres ERP</Link>
          </DropdownMenuItem>
          <ShellPreferencesMenu />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { void onSignOut(); }} className="text-destructive focus:text-destructive">
          <UserRound aria-hidden="true" />
          Déconnexion
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProductHeader({ user, onSignOut }: ProductHeaderProps) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const { density } = useShellPreferences();
  const densityClass = {
    compact: "h-12 px-3 sm:px-5",
    standard: "h-14 px-3 sm:px-6",
    comfortable: "h-16 px-4 sm:px-7",
  }[density];

  return (
    <>
      <header className={cn("sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/88 backdrop-blur-sm transition-[height,padding] transition-ui", densityClass)}>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <SidebarTrigger className="shrink-0" />
          <div className="min-w-0 flex-1"><ShellBreadcrumbs /></div>
        </div>
        <UniversalSearch onOpen={() => setPaletteOpen(true)} />
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <QuickActionsMenu />
          <ActivityCenter />
          <ProfileMenu user={user} onSignOut={onSignOut} />
        </div>
      </header>
      <React.Suspense fallback={null}>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </React.Suspense>
    </>
  );
}

export { ActivityCenter, ProductHeader, QuickActionsMenu, UniversalSearch };
