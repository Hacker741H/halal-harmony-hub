import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Bell,
  Bike,
  Building2,
  Car,
  CalendarClock,
  ClipboardCheck,
  CreditCard,
  FileSignature,
  FileText,
  LayoutDashboard,
  Leaf,
  MapPinned,
  Package,
  PackageCheck,
  Settings,
  ShieldCheck,
  Smartphone,
  Store,
  Sprout,
  TrendingDown,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useShellPreferences } from "@/components/shell/shell-preferences";
import { usePermissions } from "@/hooks/use-permissions";
import { getCommercePosLocations, getCommercePosWorkspace, type CommercePosWorkspace } from "@/lib/commerce-pos.functions";
import { getNotificationSummary } from "@/lib/notifications.functions";
import { cn } from "@/lib/utils";

type NavigationRoute =
  | "/"
  | "/employees"
  | "/drivers"
  | "/clients"
  | "/courses"
  | "/planning"
  | "/assignments"
  | "/departures"
  | "/deliveries"
  | "/vehicles"
  | "/motorcycles"
  | "/maintenance"
  | "/farms"
  | "/contracts"
  | "/stocks"
  | "/sales"
  | "/commerce"
  | "/wallets"
  | "/finance"
  | "/revenues"
  | "/expenses"
  | "/payments"
  | "/reports"
  | "/documents"
  | "/notifications"
  | "/settings"
  | "/roles"
  | "/field";

interface NavigationItem {
  title: string;
  url?: NavigationRoute;
  icon: LucideIcon;
  disabled?: boolean;
  permission?: string;
}

interface NavigationGroup {
  label: string;
  items: readonly NavigationItem[];
}

const navigationGroups: readonly NavigationGroup[] = [
  {
    label: "Pilotage",
    items: [
      { title: "Centre de pilotage", url: "/", icon: LayoutDashboard },
      { title: "Activité", url: "/finance", icon: Activity },
      { title: "Alertes", url: "/notifications", icon: Bell },
    ],
  },
  {
    label: "Ressources",
    items: [
      { title: "Clients", url: "/clients", icon: Building2 },
      { title: "Employés", url: "/employees", icon: Users },
      { title: "Chauffeurs", url: "/drivers", icon: UserCog },
    ],
  },
  {
    label: "Mobilité",
    items: [
      { title: "Véhicules", url: "/vehicles", icon: Car },
      { title: "Motos", url: "/motorcycles", icon: Bike },
      { title: "Maintenance", url: "/maintenance", icon: Wrench },
    ],
  },
  {
    label: "EXPLOITATION",
    items: [
      { title: "Courses", url: "/courses", icon: Truck },
      { title: "Planning", url: "/planning", icon: CalendarClock, permission: "planning.read" },
      { title: "Affectations", url: "/assignments", icon: ClipboardCheck, permission: "assignments.read" },
      { title: "Départs", url: "/departures", icon: MapPinned, permission: "departures.read" },
      { title: "Livraisons", url: "/deliveries", icon: PackageCheck, permission: "deliveries.read" },
    ],
  },
  {
    label: "Terrain",
    items: [
      { title: "HALAL Field", url: "/field", icon: Smartphone, permission: "field.reports.read" },
    ],
  },
  {
    label: "Commerce",
    items: [
      { title: "Magasin & caisse", url: "/commerce", icon: Store, permission: "commerce.pos.read" },
      { title: "Ventes & créances", url: "/sales", icon: PackageCheck, permission: "sales.read" },
      { title: "Stocks", url: "/stocks", icon: Package },
    ],
  },
  {
    label: "Agriculture & stocks",
    items: [
      { title: "Fermes", url: "/farms", icon: Sprout },
      { title: "Contrats", url: "/contracts", icon: FileSignature },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Wallets", url: "/wallets", icon: Wallet },
      { title: "Finance", url: "/finance", icon: Wallet },
      { title: "Revenus", url: "/revenues", icon: TrendingUp },
      { title: "Dépenses", url: "/expenses", icon: TrendingDown },
      { title: "Paiements", url: "/payments", icon: CreditCard },
      { title: "Rapports", url: "/reports", icon: BarChart3 },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Documents", url: "/documents", icon: FileText },
      { title: "Notifications", url: "/notifications", icon: Bell },
      { title: "Paramètres", url: "/settings", icon: Settings },
      { title: "Rôles", url: "/roles", icon: ShieldCheck },
    ],
  },
];

interface AppSidebarProps {
  cashierMode?: boolean;
}

export function AppSidebar({ cashierMode = false }: AppSidebarProps) {
  const { state } = useSidebar();
  const { density } = useShellPreferences();
  const { can } = usePermissions();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const { data: notificationSummary } = useQuery({
    queryKey: ["notification-summary"],
    queryFn: () => getNotificationSummary(),
    enabled: !cashierMode,
    refetchInterval: 60_000,
  });
  const unreadNotifications = notificationSummary?.unread ?? 0;
  const cashierLocationsQuery = useQuery({
    queryKey: ["commerce-pos-locations"],
    queryFn: () => getCommercePosLocations(),
    enabled: cashierMode,
  });
  const cashierLocationId = cashierLocationsQuery.data?.[0]?.id ?? "";
  const cashierWorkspaceQuery = useQuery({
    queryKey: ["commerce-pos-workspace", cashierLocationId],
    queryFn: () => getCommercePosWorkspace({ data: { locationId: cashierLocationId } }),
    enabled: cashierMode && Boolean(cashierLocationId),
  });
  const isActive = (url: NavigationRoute) => (url === "/" ? pathname === "/" : pathname.startsWith(url));
  const groupSpacing = density === "compact" ? "gap-0.5" : density === "comfortable" ? "gap-2" : "gap-1";
  const visibleNavigationGroups = cashierMode
    ? [{ label: "CAISSE", items: [{ title: "Vente au comptoir", url: "/commerce" as const, icon: Store, permission: "commerce.pos.read" }] }]
    : navigationGroups;

  return (
    <Sidebar variant="inset" collapsible="icon" className="border-0 bg-transparent">
      <SidebarHeader className="border-b border-sidebar-border/75 px-3 py-4">
        <div className="flex items-center gap-3 px-1">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-primary shadow-md">
            <Leaf className="size-5 text-primary-foreground" aria-hidden="true" />
          </div>
          {!collapsed ? (
            <div className="min-w-0 animate-fade-in">
              <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">HALAL ERP</p>
              <p className="truncate text-overline text-sidebar-foreground/55">Famille Keita</p>
            </div>
          ) : null}
        </div>
      </SidebarHeader>

      <SidebarContent className={cn("px-3 py-4", groupSpacing)}>
        {visibleNavigationGroups.map((group) => {
          const visibleItems = group.items.filter((item) => !item.permission || can(item.permission));
          if (visibleItems.length === 0) return null;
          return <SidebarGroup key={group.label} className="p-0">
            {!collapsed ? (
              <SidebarGroupLabel className="h-auto px-2 pb-2 pt-3 text-overline text-sidebar-foreground/45">
                {group.label}
              </SidebarGroupLabel>
            ) : null}
            <SidebarGroupContent>
              <SidebarMenu className={groupSpacing}>
                {visibleItems.map((item) => (
                  <SidebarMenuItem key={`${group.label}-${item.title}`}>
                    {item.disabled ? <div className="flex h-10 items-center gap-3 rounded-xl px-3 text-sidebar-foreground/45" aria-disabled="true">
                      <item.icon className="size-4 shrink-0" aria-hidden="true" />
                      {!collapsed ? <><span className="truncate">{item.title}</span><span className="ml-auto rounded-full border border-sidebar-border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide">Bientôt disponible</span></> : null}
                    </div> : <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url!)}
                      tooltip={item.title}
                      className="h-10 rounded-xl px-3 text-sidebar-foreground/74 transition-[background-color,color,transform,box-shadow] transition-ui-fast hover:translate-x-0.5 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-primary data-[active=true]:font-semibold data-[active=true]:text-sidebar-primary-foreground data-[active=true]:shadow-md group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-3"
                    >
                      <Link to={item.url!} className="flex items-center gap-3">
                        <item.icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.title}</span>
                        {item.url === "/notifications" && unreadNotifications > 0 ? (
                          <span
                            className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-gold px-1.5 py-0.5 text-overline text-gold-foreground"
                            aria-label={`${unreadNotifications} notifications non lues`}
                          >
                            {unreadNotifications > 99 ? "99+" : unreadNotifications}
                          </span>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
            {cashierMode && group.label === "CAISSE" && !collapsed ? <CashierArticleShortcuts items={cashierWorkspaceQuery.data?.items ?? []} isPending={cashierLocationsQuery.isPending || cashierWorkspaceQuery.isPending} /> : null}
          </SidebarGroup>;
        })}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/75 p-3">
        {!collapsed ? (
          <div className="rounded-md bg-sidebar-accent/50 px-2.5 py-2 text-caption text-sidebar-foreground/60">
            <span className="font-medium text-sidebar-foreground/80">HALAL ERP</span>
            <span className="mx-1.5">·</span>
            {cashierMode ? "Poste de caisse" : "HALAL Field OS"}
          </div>
        ) : null}
      </SidebarFooter>
    </Sidebar>
  );
}

function CashierArticleShortcuts({ items, isPending }: { items: CommercePosWorkspace["items"]; isPending: boolean }) {
  return (
    <div className="mt-4 border-t border-sidebar-border/75 pt-4">
      <p className="px-2 text-overline text-sidebar-foreground/45">Articles en rayon</p>
      {isPending ? <div className="mt-2 space-y-2 px-2"><div className="h-9 animate-pulse rounded-lg bg-sidebar-accent/60" /><div className="h-9 animate-pulse rounded-lg bg-sidebar-accent/60" /></div> : null}
      {!isPending && items.length === 0 ? <p className="mt-2 px-2 text-caption leading-5 text-sidebar-foreground/55">Aucun article disponible.</p> : null}
      {!isPending && items.length > 0 ? <div className="mt-2 max-h-72 space-y-1 overflow-y-auto px-1 pr-1">
        {items.map((item) => {
          const available = item.quantity > 0;
          return <button
            key={item.id}
            type="button"
            disabled={!available}
            onClick={() => window.dispatchEvent(new CustomEvent("commerce:add-item", { detail: { itemId: item.id } }))}
            className="group flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-[background-color,color] duration-150 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={`${available ? "Ajouter" : "Indisponible"} ${item.name} au panier`}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-primary"><Package className="size-3.5" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-caption font-semibold text-sidebar-foreground">{item.name}</span><span className="block truncate text-[10px] text-sidebar-foreground/55">{item.salePrice === null ? "Prix à saisir" : `${item.salePrice.toLocaleString("fr-FR")} FCFA`} · {available ? `${item.quantity} en rayon` : "Rupture"}</span></span>
            <span className="text-sidebar-foreground/40 transition-colors group-hover:text-sidebar-primary">+</span>
          </button>;
        })}
      </div> : null}
    </div>
  );
}
