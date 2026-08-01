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
import { getNotificationSummary } from "@/lib/notifications.functions";
import { cn } from "@/lib/utils";

type NavigationRoute =
  | "/"
  | "/employees"
  | "/drivers"
  | "/clients"
  | "/courses"
  | "/vehicles"
  | "/motorcycles"
  | "/maintenance"
  | "/farms"
  | "/contracts"
  | "/stocks"
  | "/wallets"
  | "/finance"
  | "/revenues"
  | "/expenses"
  | "/payments"
  | "/reports"
  | "/documents"
  | "/notifications"
  | "/settings"
  | "/roles";

interface NavigationItem {
  title: string;
  url?: NavigationRoute;
  icon: LucideIcon;
  disabled?: boolean;
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
      { title: "Planning", icon: CalendarClock, disabled: true },
      { title: "Affectations", icon: ClipboardCheck, disabled: true },
      { title: "Départs", icon: MapPinned, disabled: true },
      { title: "Livraisons", icon: PackageCheck, disabled: true },
    ],
  },
  {
    label: "Agriculture & stocks",
    items: [
      { title: "Fermes", url: "/farms", icon: Sprout },
      { title: "Contrats", url: "/contracts", icon: FileSignature },
      { title: "Stocks", url: "/stocks", icon: Package },
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

export function AppSidebar() {
  const { state } = useSidebar();
  const { density } = useShellPreferences();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const { data: notificationSummary } = useQuery({
    queryKey: ["notification-summary"],
    queryFn: () => getNotificationSummary(),
    refetchInterval: 60_000,
  });
  const unreadNotifications = notificationSummary?.unread ?? 0;
  const isActive = (url: NavigationRoute) => (url === "/" ? pathname === "/" : pathname.startsWith(url));
  const groupSpacing = density === "compact" ? "gap-0.5" : density === "comfortable" ? "gap-2" : "gap-1";

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border bg-sidebar">
      <SidebarHeader className="border-b border-sidebar-border px-2 py-3">
        <div className="flex items-center gap-2.5 px-1">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-primary shadow-sm">
            <Leaf className="size-5 text-primary-foreground" aria-hidden="true" />
          </div>
          {!collapsed ? (
            <div className="min-w-0 animate-fade-in">
              <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">HALAL ERP</p>
              <p className="truncate text-overline text-sidebar-foreground/55">Suite de gestion</p>
            </div>
          ) : null}
        </div>
      </SidebarHeader>

      <SidebarContent className={cn("px-2 py-3", groupSpacing)}>
        {navigationGroups.map((group) => (
          <SidebarGroup key={group.label} className="p-0">
            {!collapsed ? (
              <SidebarGroupLabel className="h-auto px-2 pb-1.5 pt-2 text-overline text-sidebar-foreground/45">
                {group.label}
              </SidebarGroupLabel>
            ) : null}
            <SidebarGroupContent>
              <SidebarMenu className={groupSpacing}>
                {group.items.map((item) => (
                  <SidebarMenuItem key={`${group.label}-${item.title}`}>
                    {item.disabled ? <div className="flex h-9 items-center gap-3 rounded-md px-2.5 text-sidebar-foreground/45" aria-disabled="true">
                      <item.icon className="size-4 shrink-0" aria-hidden="true" />
                      {!collapsed ? <><span className="truncate">{item.title}</span><span className="ml-auto rounded-full border border-sidebar-border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide">Bientôt disponible</span></> : null}
                    </div> : <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url!)}
                      tooltip={item.title}
                      className="h-9 rounded-md px-2.5 text-sidebar-foreground/75 transition-[background-color,color,transform] transition-ui-fast hover:translate-x-px hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-primary data-[active=true]:font-semibold data-[active=true]:text-sidebar-primary-foreground data-[active=true]:shadow-xs group-data-[collapsible=icon]:!size-9 group-data-[collapsible=icon]:!p-2.5"
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
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {!collapsed ? (
          <div className="rounded-md bg-sidebar-accent/50 px-2.5 py-2 text-caption text-sidebar-foreground/60">
            <span className="font-medium text-sidebar-foreground/80">HALAL ERP</span>
            <span className="mx-1.5">·</span>
            Product shell v2
          </div>
        ) : null}
      </SidebarFooter>
    </Sidebar>
  );
}
