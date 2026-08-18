import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Bike,
  Building2,
  Car,
  ClipboardList,
  Contact,
  CreditCard,
  FileSignature,
  FileText,
  LayoutDashboard,
  Leaf,
  Package,
  PackageCheck,
  Radar,
  Settings,
  ShieldCheck,
  ShoppingCart,
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
import { getNotificationSummary } from "@/lib/notifications.functions";
import { cn } from "@/lib/utils";

type NavigationRoute =
  | "/"
  | "/control-center"
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
  | "/suppliers"
  | "/purchases"
  | "/inventory-counts"
  | "/stock-transfers"
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
      { title: "Centre de contrôle", url: "/control-center", icon: Radar },
      { title: "Alertes", url: "/notifications", icon: Bell },
    ],
  },
  {
    label: "Ressources",
    items: [
      { title: "Clients", url: "/clients", icon: Building2, permission: "clients.read" },
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
      { title: "Fournisseurs", url: "/suppliers", icon: Contact, permission: "suppliers.read" },
      { title: "Achats & dettes", url: "/purchases", icon: ShoppingCart, permission: "purchases.read" },
      { title: "Inventaires", url: "/inventory-counts", icon: ClipboardList, permission: "inventory.counts.read" },
      { title: "Transferts", url: "/stock-transfers", icon: ArrowLeftRight, permission: "transfers.read" },
    ],
  },
  {
    label: "Agriculture & stocks",
    items: [
      { title: "Fermes", url: "/farms", icon: Sprout },
      { title: "Contrats", url: "/contracts", icon: FileSignature },
      { title: "Stocks", url: "/stocks", icon: Package, permission: "stocks.read" },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Wallets", url: "/wallets", icon: Wallet, permission: "wallets.read" },
      { title: "Finance", url: "/finance", icon: Wallet, permission: "finance.read" },
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

export function AppSidebar() {
  const { state } = useSidebar();
  const { density } = useShellPreferences();
  const { can } = usePermissions();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const { data: notificationSummary } = useQuery({
    queryKey: ["notification-summary"],
    queryFn: () => getNotificationSummary(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const unreadNotifications = notificationSummary?.unread ?? 0;
  const isActive = (url: NavigationRoute) => (url === "/" ? pathname === "/" : pathname.startsWith(url));
  const groupSpacing = density === "compact" ? "gap-0.5" : density === "comfortable" ? "gap-2" : "gap-1";
  const visibleNavigationGroups = navigationGroups;

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
          </SidebarGroup>;
        })}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/75 p-3">
        {!collapsed ? (
          <div className="rounded-md bg-sidebar-accent/50 px-2.5 py-2 text-caption text-sidebar-foreground/60">
            <span className="font-medium text-sidebar-foreground/80">HALAL ERP</span>
            <span className="mx-1.5">·</span>
            Famille Keita
          </div>
        ) : null}
      </SidebarFooter>
    </Sidebar>
  );
}
