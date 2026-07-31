import { Link, useRouterState } from "@tanstack/react-router";

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

type ShellRoute =
  | "/"
  | "/employees"
  | "/drivers"
  | "/vehicles"
  | "/motorcycles"
  | "/maintenance"
  | "/farms"
  | "/contracts"
  | "/wallets"
  | "/finance"
  | "/revenues"
  | "/expenses"
  | "/payments"
  | "/stocks"
  | "/documents"
  | "/notifications"
  | "/reports"
  | "/settings"
  | "/roles";

interface Crumb {
  label: string;
  to?: ShellRoute;
}

const routeLabels: Record<string, string> = {
  employees: "Employés",
  drivers: "Chauffeurs",
  vehicles: "Véhicules",
  motorcycles: "Motos",
  maintenance: "Maintenance",
  farms: "Fermes",
  contracts: "Contrats",
  wallets: "Wallets",
  finance: "Finance",
  revenues: "Revenus",
  expenses: "Dépenses",
  payments: "Paiements",
  stocks: "Stocks",
  inventory: "Inventaire",
  documents: "Documents",
  notifications: "Notifications",
  reports: "Rapports",
  settings: "Paramètres",
  roles: "Rôles & permissions",
};

const shellRoutes = new Set<ShellRoute>([
  "/",
  "/employees",
  "/drivers",
  "/vehicles",
  "/motorcycles",
  "/maintenance",
  "/farms",
  "/contracts",
  "/wallets",
  "/finance",
  "/revenues",
  "/expenses",
  "/payments",
  "/stocks",
  "/documents",
  "/notifications",
  "/reports",
  "/settings",
  "/roles",
]);

function isShellRoute(value: string): value is ShellRoute {
  return shellRoutes.has(value as ShellRoute);
}

function labelForSegment(segment: string): string {
  if (routeLabels[segment]) return routeLabels[segment];
  return "Détail";
}

function getCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [{ label: "Centre de pilotage", to: "/" }];

  segments.forEach((segment, index) => {
    const candidatePath = `/${segments.slice(0, index + 1).join("/")}`;
    crumbs.push({
      label: labelForSegment(segment),
      to: isShellRoute(candidatePath) ? candidatePath : undefined,
    });
  });

  return crumbs;
}

function ShellBreadcrumbs() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const crumbs = getCrumbs(pathname);
  const hasOverflow = crumbs.length > 3;

  return (
    <Breadcrumb className="min-w-0 animate-fade-in">
      <BreadcrumbList className="min-w-0 flex-nowrap overflow-hidden whitespace-nowrap">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          const hideOnMobile = hasOverflow && index > 0 && !isLast;

          return (
            <BreadcrumbItem key={`${crumb.label}-${index}`} className={hideOnMobile ? "hidden sm:inline-flex" : "min-w-0"}>
              {index > 0 ? <BreadcrumbSeparator className={hideOnMobile ? "hidden sm:block" : undefined} /> : null}
              {index === 1 && hasOverflow ? <BreadcrumbEllipsis className="sm:hidden" /> : null}
              {isLast || !crumb.to ? (
                <BreadcrumbPage className="truncate text-sm font-medium">{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild className="truncate">
                  <Link to={crumb.to}>{crumb.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export { ShellBreadcrumbs };
