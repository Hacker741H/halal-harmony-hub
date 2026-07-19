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

const overview = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
];

const operations = [
  { title: "Employees", url: "/employees", icon: Users },
  { title: "Drivers", url: "/drivers", icon: UserCog },
  { title: "Motorcycles", url: "/motorcycles", icon: Bike },
  { title: "Vehicles", url: "/vehicles", icon: Car },
  { title: "Farms & Plantations", url: "/farms", icon: Sprout },
  { title: "Contracts", url: "/contracts", icon: FileSignature },
];

const finance = [
  { title: "Finance", url: "/finance", icon: Wallet },
  { title: "Revenues", url: "/revenues", icon: TrendingUp },
  { title: "Expenses", url: "/expenses", icon: TrendingDown },
  { title: "Payments", url: "/payments", icon: CreditCard },
];

const workspace = [
  { title: "Inventory", url: "/inventory", icon: Package },
  { title: "Documents", url: "/documents", icon: FileText },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Notifications", url: "/notifications", icon: Bell },
];

const system = [
  { title: "Roles & Permissions", url: "/roles", icon: ShieldCheck },
  { title: "Company Settings", url: "/settings", icon: Settings },
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
            <SidebarMenuItem key={item.url}>
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
                Enterprise Suite
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {renderGroup("Overview", overview)}
        {renderGroup("Operations", operations)}
        {renderGroup("Finance", finance)}
        {renderGroup("Workspace", workspace)}
        {renderGroup("System", system)}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && (
          <div className="px-2 py-2 text-[10px] text-sidebar-foreground/50">
            v0.1 · Notion-compatible schema
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
