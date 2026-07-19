import { createFileRoute } from "@tanstack/react-router";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Bike,
  Car,
  Users,
  Sprout,
  FileWarning,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Leaf,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — HALAL ERP" },
      { name: "description", content: "Overview of revenue, expenses, fleet, farms and upcoming document expirations." },
    ],
  }),
  component: Dashboard,
});

interface Kpi {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down";
  icon: LucideIcon;
  tone: "primary" | "emerald" | "gold" | "destructive";
}

const financialKpis: Kpi[] = [
  { label: "Daily revenue", value: "1 245 000 XOF", delta: "+8.2%", trend: "up", icon: TrendingUp, tone: "emerald" },
  { label: "Monthly revenue", value: "32.4M XOF", delta: "+12.4%", trend: "up", icon: Wallet, tone: "primary" },
  { label: "Expenses (MTD)", value: "18.9M XOF", delta: "+3.1%", trend: "up", icon: TrendingDown, tone: "destructive" },
  { label: "Net profit (MTD)", value: "13.5M XOF", delta: "+19.6%", trend: "up", icon: ArrowUpRight, tone: "gold" },
];

const operationalKpis: Kpi[] = [
  { label: "Active motorcycles", value: "48", delta: "3 in service", icon: Bike, tone: "primary" },
  { label: "Active vehicles", value: "17", delta: "2 in service", icon: Car, tone: "primary" },
  { label: "Employees", value: "126", delta: "+4 this month", icon: Users, tone: "emerald" },
  { label: "Farms & plantations", value: "9", delta: "3 in harvest", icon: Sprout, tone: "emerald" },
];

const toneStyles: Record<Kpi["tone"], string> = {
  primary: "bg-primary/10 text-primary",
  emerald: "bg-emerald/10 text-emerald",
  gold: "bg-gold/15 text-gold-foreground",
  destructive: "bg-destructive/10 text-destructive",
};

function KpiCard({ kpi }: { kpi: Kpi }) {
  const Icon = kpi.icon;
  return (
    <Card className="p-5 transition-shadow hover:shadow-elegant">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {kpi.label}
          </p>
          <p className="mt-2 font-display text-2xl font-semibold tracking-tight">{kpi.value}</p>
          {kpi.delta && (
            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              {kpi.trend === "up" && <ArrowUpRight className="h-3 w-3 text-emerald" />}
              {kpi.trend === "down" && <ArrowDownRight className="h-3 w-3 text-destructive" />}
              <span>{kpi.delta}</span>
            </div>
          )}
        </div>
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${toneStyles[kpi.tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

const upcomingDocs = [
  { name: "Vehicle insurance — Toyota Hilux #V-102", due: "in 4 days", severity: "urgent" },
  { name: "Driver license renewal — M. Diallo", due: "in 9 days", severity: "warn" },
  { name: "Farm lease — Plantation Kolda-3", due: "in 21 days", severity: "warn" },
  { name: "Motorcycle registration — MT-041", due: "in 28 days", severity: "info" },
];

const activities = [
  { who: "A. Ndiaye", action: "created a payment of 450 000 XOF for Farm Kolda-2", at: "2m ago" },
  { who: "System", action: "flagged 3 documents expiring within 30 days", at: "1h ago" },
  { who: "F. Ba", action: "added driver M. Sow to motorcycle MT-032", at: "3h ago" },
  { who: "A. Diop", action: "closed contract #C-2041 with supplier AgroSarl", at: "yesterday" },
  { who: "System", action: "synced 12 records from Notion workspace", at: "yesterday" },
];

function Dashboard() {
  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-primary p-6 text-primary-foreground shadow-elegant sm:p-8">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold/30 blur-3xl" />
        <div className="absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-emerald/30 blur-3xl" />
        <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary-foreground/70">
              <Leaf className="h-3.5 w-3.5" />
              <span>HALAL ERP · Overview</span>
            </div>
            <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Good day — here's your company at a glance
            </h1>
            <p className="mt-2 max-w-xl text-sm text-primary-foreground/80">
              Transportation, farms, workforce and finance in one place. Data model stays
              compatible with your existing Notion workspace.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Badge className="border-none bg-gold text-gold-foreground">Notion sync ready</Badge>
            <Button variant="secondary" className="bg-background/10 text-primary-foreground hover:bg-background/20">
              Sync now
            </Button>
          </div>
        </div>
      </section>

      {/* Financial KPIs */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Finance
          </h2>
          <Badge variant="outline">This month</Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {financialKpis.map((k) => <KpiCard key={k.label} kpi={k} />)}
        </div>
      </section>

      {/* Operational KPIs */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Operations
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {operationalKpis.map((k) => <KpiCard key={k.label} kpi={k} />)}
        </div>
      </section>

      {/* Split: expirations + activity */}
      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileWarning className="h-4 w-4 text-gold-foreground" />
              <h3 className="font-display text-base font-semibold">Upcoming document expirations</h3>
            </div>
            <Button variant="ghost" size="sm">View all</Button>
          </div>
          <ul className="divide-y divide-border">
            {upcomingDocs.map((d) => (
              <li key={d.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
                <p className="min-w-0 truncate text-sm">{d.name}</p>
                <Badge
                  variant="outline"
                  className={
                    d.severity === "urgent"
                      ? "shrink-0 border-destructive/40 bg-destructive/10 text-destructive"
                      : d.severity === "warn"
                      ? "shrink-0 border-gold/40 bg-gold/10 text-gold-foreground"
                      : "shrink-0"
                  }
                >
                  {d.due}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5 lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald" />
              <h3 className="font-display text-base font-semibold">Recent activity</h3>
            </div>
            <Button variant="ghost" size="sm">Open history</Button>
          </div>
          <ul className="space-y-3">
            {activities.map((a, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground">
                  {a.who.split(" ").map((s) => s[0]).slice(0, 2).join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{a.who}</span>{" "}
                    <span className="text-muted-foreground">{a.action}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{a.at}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
