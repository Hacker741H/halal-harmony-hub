import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  UserCog,
  Bike,
  Car,
  Sprout,
  FileSignature,
  Wallet,
  TrendingDown,
  TrendingUp,
  CreditCard,
  Package,
  FileText,
  BarChart3,
  Bell,
  Settings,
  ShieldCheck,
  Leaf,
  Wrench,
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

const apercu = [
  { title: "Tableau de bord", url: "/", icon: LayoutDashboard },
];

const operations = [
  { title: "Employés", url: "/employees", icon: Users },
  { title: "Chauffeurs", url: "/drivers", icon: UserCog },
  { title: "Motos", url: "/motorcycles", icon: Bike },
  { title: "Véhicules", url: "/vehicles", icon: Car },
  { title: "Exploitations", url: "/farms", icon: Sprout },
  { title: "Contrats", url: "/contracts", icon: FileSignature },
  { title: "Entretiens", url: "/reports", icon: Wrench },
];

const finances = [
  { title: "Finances", url: "/finance", icon: Wallet },
  { title: "Recettes", url: "/revenues", icon: TrendingUp },
  { title: "Dépenses", url: "/expenses", icon: TrendingDown },
  { title: "Versements", url: "/payments", icon: CreditCard },
];

const espace = [
  { title: "Stock", url: "/inventory", icon: Package },
  { title: "Documents", url: "/documents", icon: FileText },
  { title: "Rapports", url: "/reports", icon: BarChart3 },
  { title: "Notifications", url: "/notifications", icon: Bell },
];

const systeme = [
  { title: "Rôles & permissions", url: "/roles", icon: ShieldCheck },
  { title: "Paramètres", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => (url === "/" ? pathname === "/" : pathname.startsWith(url));

  const renderGroup = (label: string, items: typeof operations) => (
    <SidebarGroup>
      {!collapsed && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                <Link to={item.url} className="flex items-center gap-3">
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-primary shadow-elegant">
            <Leaf className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold tracking-tight text-sidebar-foreground">
                HALAL ERP
              </p>
              <p className="truncate text-[10px] uppercase tracking-widest text-sidebar-foreground/60">
                Suite de gestion
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {renderGroup("Aperçu", apercu)}
        {renderGroup("Opérations", operations)}
        {renderGroup("Finances", finances)}
        {renderGroup("Espace de travail", espace)}
        {renderGroup("Système", systeme)}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && (
          <div className="px-2 py-2 text-[10px] text-sidebar-foreground/50">
            v1.0 · Schéma compatible Notion
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
