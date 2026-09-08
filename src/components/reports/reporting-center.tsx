import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Download,
  FileText,
  Filter,
  Loader2,
  Printer,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatXOF } from "@/lib/format";
import { FINANCE_OPERATION_TYPE_LABELS } from "@/lib/finance.functions";
import {
  REPORT_TYPES,
  createSavedReport,
  deleteSavedReport,
  exportManagementReportOperations,
  getManagementReport,
  getManagementReportOperations,
  getReportingAccess,
  getReportingFilterOptions,
  getSavedReports,
  reportFiltersSchema,
  type ReportFilters,
  type ReportType,
  type SavedReport,
} from "@/lib/reporting.functions";
import { notifyMutationError } from "@/lib/notify-mutation-error";
import type { Json } from "@/integrations/supabase/types";

const REPORT_LABELS: Record<ReportType, string> = {
  OVERVIEW: "Vue d’ensemble",
  FINANCE: "Finances",
  TREASURY: "Trésorerie",
  VEHICLES: "Véhicules",
  MOTORCYCLES: "Motos",
  DRIVERS: "Chauffeurs",
  EMPLOYEES: "Employés",
  FARMS: "Exploitations",
  MAINTENANCE: "Entretiens",
  STOCK: "Stocks",
  COMPLIANCE: "Contrats et alertes",
};

type JsonRecord = { [key: string]: Json | undefined };

export type ReportsSearch = ReportFilters & { tab?: ReportType };

interface ReportingCenterProps {
  search: ReportsSearch;
  onSearchChange: (nextSearch: ReportsSearch) => void;
}

function isJsonRecord(value: Json): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecord(value: Json | undefined): JsonRecord {
  return value !== undefined && isJsonRecord(value) ? value : {};
}

function getRows(value: Json | undefined): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isJsonRecord) : [];
}

function getNumber(value: Json | undefined): number {
  return typeof value === "number" ? value : 0;
}

function getNullableNumber(value: Json | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function getText(value: Json | undefined, fallback = "—"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function getBoolean(value: Json | undefined): boolean {
  return value === true;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getAbidjanToday(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const valueFor = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return new Date(
    Date.UTC(
      Number(valueFor("year")),
      Number(valueFor("month")) - 1,
      Number(valueFor("day")),
    ),
  );
}

function addUtcDays(date: Date, offset: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + offset);
  return next;
}

function getPresetFilters(key: string): Pick<ReportFilters, "startDate" | "endDate"> {
  const today = getAbidjanToday();
  const endDate = toDateString(today);

  if (key === "today") return { startDate: endDate, endDate };
  if (key === "week") {
    const day = today.getUTCDay() || 7;
    return { startDate: toDateString(addUtcDays(today, 1 - day)), endDate };
  }
  if (key === "month") {
    return { startDate: toDateString(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), endDate };
  }
  if (key === "previousMonth") {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    return { startDate: toDateString(start), endDate: toDateString(end) };
  }
  if (key === "quarter") {
    const quarterMonth = Math.floor(today.getUTCMonth() / 3) * 3;
    return { startDate: toDateString(new Date(Date.UTC(today.getUTCFullYear(), quarterMonth, 1))), endDate };
  }
  return { startDate: `${today.getUTCFullYear()}-01-01`, endDate };
}

function searchFilters(search: ReportsSearch): ReportFilters {
  const { tab: _tab, ...filters } = search;
  return filters;
}

function cleanSearch(reportType: ReportType, filters: ReportFilters): ReportsSearch {
  const result: ReportsSearch = { tab: reportType };
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      Object.assign(result, { [key]: value });
    }
  }
  return result;
}

function isReportType(value: string): value is ReportType {
  return REPORT_TYPES.some((reportType) => reportType === value);
}

function MetricCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "negative" }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className={tone === "negative" ? "text-2xl font-bold text-destructive" : "text-2xl font-bold"}>{value}</p>
      </CardContent>
    </Card>
  );
}

function DataTable({
  headers,
  children,
  emptyLabel = "Aucune donnée pour cette période.",
  hasRows,
}: {
  headers: string[];
  children: React.ReactNode;
  emptyLabel?: string;
  hasRows: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[680px] text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>{headers.map((header) => <th className="px-4 py-3 font-medium" key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {hasRows ? children : (
            <tr><td className="px-4 py-8 text-center text-muted-foreground" colSpan={headers.length}>{emptyLabel}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function FinanceSummary({ report }: { report: Json }) {
  const root = getRecord(report);
  const summary = getRecord(root.summary);
  const monthly = getRows(root.monthly).map((row) => ({
    month: getText(row.month),
    recettes: getNumber(row.revenue),
    dépenses: getNumber(row.expense),
    dépôts: getNumber(row.deposit),
  }));
  const categories = getRows(root.categories);
  const modules = getRows(root.modules);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Recettes" value={formatXOF(getNumber(summary.revenue))} />
        <MetricCard label="Dépenses" value={formatXOF(getNumber(summary.expense))} tone="negative" />
        <MetricCard label="Dépôts" value={formatXOF(getNumber(summary.deposit))} />
        <MetricCard label="Transferts internes" value={formatXOF(getNumber(summary.transfer))} />
        <MetricCard label="Flux net" value={formatXOF(getNumber(summary.netFlow))} tone={getNumber(summary.netFlow) < 0 ? "negative" : "default"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Évolution mensuelle</CardTitle>
          <CardDescription>Recettes, dépenses et dépôts réconciliables avec le journal financier.</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {monthly.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tickFormatter={(value: string) => new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "Africa/Abidjan" }).format(new Date(`${value}T00:00:00Z`))} />
                <YAxis tickFormatter={(value: number) => new Intl.NumberFormat("fr-FR", { notation: "compact" }).format(value)} />
                <Tooltip formatter={(value: number) => formatXOF(value)} />
                <Legend />
                <Bar dataKey="recettes" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="dépenses" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="dépôts" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="grid h-full place-items-center text-sm text-muted-foreground">Aucune opération financière sur cette période.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Répartition par catégorie</CardTitle></CardHeader>
          <CardContent>
            <DataTable headers={["Catégorie", "Opérations", "Montant"]} hasRows={categories.length > 0}>
              {categories.map((row) => <tr className="border-t" key={getText(row.name)}><td className="px-4 py-3">{getText(row.name)}</td><td className="px-4 py-3">{getNumber(row.operationCount)}</td><td className="px-4 py-3 font-medium">{formatXOF(getNumber(row.amount))}</td></tr>)}
            </DataTable>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Répartition par module source</CardTitle></CardHeader>
          <CardContent>
            <DataTable headers={["Module", "Opérations", "Montant"]} hasRows={modules.length > 0}>
              {modules.map((row) => <tr className="border-t" key={getText(row.name)}><td className="px-4 py-3">{getText(row.name)}</td><td className="px-4 py-3">{getNumber(row.operationCount)}</td><td className="px-4 py-3 font-medium">{formatXOF(getNumber(row.amount))}</td></tr>)}
            </DataTable>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TreasuryReport({ report }: { report: Json }) {
  const wallets = getRows(getRecord(report).wallets);
  return (
    <Card>
      <CardHeader><CardTitle>Wallets et trésorerie</CardTitle><CardDescription>Le rapport signale les écarts ; il ne modifie jamais les soldes.</CardDescription></CardHeader>
      <CardContent>
        <DataTable headers={["Wallet", "Initial", "Enregistré", "Calculé", "Écart", "Recettes", "Dépenses"]} hasRows={wallets.length > 0}>
          {wallets.map((wallet) => {
            const difference = getNumber(wallet.difference);
            return <tr className="border-t" key={getText(wallet.id)}>
              <td className="px-4 py-3"><Link className="font-medium hover:underline" to="/wallets/$walletId" params={{ walletId: getText(wallet.id) }}>{getText(wallet.name)}</Link></td>
              <td className="px-4 py-3">{formatXOF(getNumber(wallet.initialBalance))}</td>
              <td className="px-4 py-3">{formatXOF(getNumber(wallet.recordedBalance))}</td>
              <td className="px-4 py-3">{formatXOF(getNumber(wallet.calculatedBalance))}</td>
              <td className={difference === 0 ? "px-4 py-3" : "px-4 py-3 font-medium text-destructive"}>{formatXOF(difference)}</td>
              <td className="px-4 py-3">{formatXOF(getNumber(wallet.revenue) + getNumber(wallet.deposit) + getNumber(wallet.transferIn))}</td>
              <td className="px-4 py-3">{formatXOF(getNumber(wallet.expense) + getNumber(wallet.transferOut))}</td>
            </tr>;
          })}
        </DataTable>
      </CardContent>
    </Card>
  );
}

function AssetsReport({ report }: { report: Json }) {
  const assets = getRows(getRecord(report).assets);
  const inRepair = assets.filter((asset) => ["EN_REPARATION", "en_reparation"].includes(getText(asset.status, ""))).length;
  const withoutDriver = assets.filter((asset) => getText(asset.currentDriver, "") === "").length;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3"><MetricCard label="Actifs listés" value={String(assets.length)} /><MetricCard label="En réparation" value={String(inRepair)} tone={inRepair > 0 ? "negative" : "default"} /><MetricCard label="Sans chauffeur actuel" value={String(withoutDriver)} tone={withoutDriver > 0 ? "negative" : "default"} /></div>
      <Card>
        <CardHeader><CardTitle>Coûts des actifs</CardTitle><CardDescription>Classement par coût total : seules les dépenses liées explicitement à l’actif sont incluses.</CardDescription></CardHeader>
        <CardContent>
          <DataTable headers={["Actif", "Statut", "Chauffeur actuel", "Kilométrage", "Entretiens", "Coût total"]} hasRows={assets.length > 0}>
            {assets.map((asset) => {
              const route = getText(asset.route, "/reports");
              const cost = getNullableNumber(asset.costTotal);
              return <tr className="border-t" key={getText(asset.id)}>
                <td className="px-4 py-3"><Link className="font-medium hover:underline" to={route}>{getText(asset.registration)}<span className="block text-xs text-muted-foreground">{getText(asset.label, "")}</span></Link></td>
                <td className="px-4 py-3"><Badge variant="secondary">{getText(asset.status)}</Badge></td>
                <td className="px-4 py-3">{getText(asset.currentDriver)}</td>
                <td className="px-4 py-3">{getText(asset.kilometrage)}</td>
                <td className="px-4 py-3">{getNumber(asset.maintenanceCount)}</td>
                <td className="px-4 py-3 font-medium">{cost === null ? "Montant réservé" : formatXOF(cost)}</td>
              </tr>;
            })}
          </DataTable>
        </CardContent>
      </Card>
    </div>
  );
}

function PeopleReport({ report }: { report: Json }) {
  const root = getRecord(report);
  const people = getRows(root.people);
  const canViewSalary = getBoolean(root.canViewSalary);
  return (
    <Card>
      <CardHeader><CardTitle>Chauffeurs et employés</CardTitle><CardDescription>Les salaires versés sont protégés selon le rôle.</CardDescription></CardHeader>
      <CardContent>
        <DataTable headers={["Personne", "Rôle", "Statut", "Affectation", "Alertes", "Salaires versés"]} hasRows={people.length > 0}>
          {people.map((person) => <tr className="border-t" key={getText(person.id)}>
            <td className="px-4 py-3"><Link className="font-medium hover:underline" to={getText(person.route, "/reports")}>{getText(person.name)}</Link><span className="block text-xs text-muted-foreground">{getText(person.position, "")}</span></td>
            <td className="px-4 py-3">{getText(person.role)}</td>
            <td className="px-4 py-3"><Badge variant="secondary">{getText(person.status)}</Badge></td>
            <td className="px-4 py-3">{getText(person.currentAsset)}</td>
            <td className="px-4 py-3">{getNumber(person.alertCount)}</td>
            <td className="px-4 py-3 font-medium">{canViewSalary ? formatXOF(getNumber(person.salaryPaid)) : "Montant réservé"}</td>
          </tr>)}
        </DataTable>
      </CardContent>
    </Card>
  );
}

function FarmsReport({ report }: { report: Json }) {
  const farms = getRows(getRecord(report).farms);
  return (
    <Card>
      <CardHeader><CardTitle>Exploitations</CardTitle><CardDescription>La marge est une marge de gestion à partir des liens financiers explicites.</CardDescription></CardHeader>
      <CardContent>
        <DataTable headers={["Exploitation", "Surface", "Récolte", "Recettes", "Dépenses", "Marge de gestion"]} hasRows={farms.length > 0}>
          {farms.map((farm) => {
            const revenue = getNullableNumber(farm.revenue);
            const expense = getNullableNumber(farm.expense);
            const margin = revenue === null || expense === null ? null : revenue - expense;
            return <tr className="border-t" key={getText(farm.id)}>
              <td className="px-4 py-3"><Link className="font-medium hover:underline" to={getText(farm.route, "/reports")}>{getText(farm.name)}</Link><span className="block text-xs text-muted-foreground">{getText(farm.status)}</span></td>
              <td className="px-4 py-3">{getText(farm.surfaceHa)} ha</td>
              <td className="px-4 py-3">{getNumber(farm.harvestQuantity)} kg</td>
              <td className="px-4 py-3">{revenue === null ? "Montant réservé" : formatXOF(revenue)}</td>
              <td className="px-4 py-3">{expense === null ? "Montant réservé" : formatXOF(expense)}</td>
              <td className="px-4 py-3 font-medium">{margin === null ? "Montant réservé" : formatXOF(margin)}</td>
            </tr>;
          })}
        </DataTable>
      </CardContent>
    </Card>
  );
}

function MaintenanceReport({ report }: { report: Json }) {
  const maintenances = getRows(getRecord(report).maintenances);
  return <Card><CardHeader><CardTitle>Entretiens réalisés</CardTitle><CardDescription>Les coûts sont issus des dépenses liées, quand elles existent.</CardDescription></CardHeader><CardContent>
    <DataTable headers={["Date", "Actif", "Type", "Coût"]} hasRows={maintenances.length > 0}>
      {maintenances.map((maintenance) => {
        const cost = getNullableNumber(maintenance.cost);
        return <tr className="border-t" key={getText(maintenance.id)}><td className="px-4 py-3">{getText(maintenance.date)}</td><td className="px-4 py-3"><Link className="font-medium hover:underline" to={getText(maintenance.route, "/reports")}>{getText(maintenance.assetLabel)}</Link><span className="block text-xs text-muted-foreground">{getText(maintenance.assetType)}</span></td><td className="px-4 py-3">{getText(maintenance.type)}</td><td className="px-4 py-3 font-medium">{cost === null ? "Montant réservé" : formatXOF(cost)}</td></tr>;
      })}
    </DataTable>
  </CardContent></Card>;
}

function StockReport({ report }: { report: Json }) {
  const items = getRows(getRecord(report).items);
  return <Card><CardHeader><CardTitle>Stocks</CardTitle><CardDescription>Les mouvements physiques et les flux financiers restent distincts.</CardDescription></CardHeader><CardContent>
    <DataTable headers={["Article", "Disponible", "Seuil", "Mouvements", "Achats", "Ventes"]} hasRows={items.length > 0}>
      {items.map((item) => {
        const purchases = getNullableNumber(item.purchases);
        const sales = getNullableNumber(item.sales);
        return <tr className="border-t" key={getText(item.id)}><td className="px-4 py-3"><Link className="font-medium hover:underline" to={getText(item.route, "/stocks")}>{getText(item.name)}</Link><span className="block text-xs text-muted-foreground">{getText(item.category, "")}</span></td><td className="px-4 py-3">{getNumber(item.stockCurrent)} {getText(item.unit, "")}{getBoolean(item.isOutOfStock) ? <Badge className="ml-2" variant="destructive">À zéro</Badge> : getBoolean(item.isLowStock) ? <Badge className="ml-2" variant="secondary">Sous seuil</Badge> : null}</td><td className="px-4 py-3">{getText(item.threshold)}</td><td className="px-4 py-3">{getNumber(item.movementCount)}</td><td className="px-4 py-3">{purchases === null ? "Montant réservé" : formatXOF(purchases)}</td><td className="px-4 py-3">{sales === null ? "Montant réservé" : formatXOF(sales)}</td></tr>;
      })}
    </DataTable>
  </CardContent></Card>;
}

function ComplianceReport({ report }: { report: Json }) {
  const root = getRecord(report);
  const contracts = getRecord(root.contracts);
  const documents = getRecord(root.documents);
  const alerts = getRows(root.alerts);
  return <div className="space-y-6"><div className="grid gap-4 md:grid-cols-3"><MetricCard label="Contrats actifs" value={String(getNumber(contracts.active))} /><MetricCard label="Contrats à 30 jours" value={String(getNumber(contracts.expiringSoon))} /><MetricCard label="Contrats expirés" value={String(getNumber(contracts.expired))} /><MetricCard label="Documents à 30 jours" value={String(getNumber(documents.expiringSoon))} /><MetricCard label="Documents expirés" value={String(getNumber(documents.expired))} /><MetricCard label="Alertes non résolues" value={String(alerts.reduce((total, alert) => total + getNumber(alert.count), 0))} tone={alerts.length > 0 ? "negative" : "default"} /></div><Card><CardHeader><CardTitle>Alertes visibles</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-2">{alerts.length > 0 ? alerts.map((alert) => <Badge key={getText(alert.severity)} variant={getText(alert.severity) === "CRITICAL" ? "destructive" : "secondary"}>{getText(alert.severity)} : {getNumber(alert.count)}</Badge>) : <p className="text-sm text-muted-foreground">Aucune alerte visible.</p>}</div></CardContent></Card></div>;
}

function OverviewReport({ report, canViewFinance }: { report: Json; canViewFinance: boolean }) {
  const root = getRecord(report);
  if (canViewFinance && root.summary !== undefined && isJsonRecord(root.summary)) return <FinanceSummary report={report} />;
  const counts = getRecord(root.entityCounts);
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><MetricCard label="Véhicules" value={String(getNumber(counts.vehicles))} /><MetricCard label="Motos" value={String(getNumber(counts.motorcycles))} /><MetricCard label="Chauffeurs" value={String(getNumber(counts.drivers))} /><MetricCard label="Employés" value={String(getNumber(counts.employees))} /><MetricCard label="Exploitations" value={String(getNumber(counts.farms))} /><MetricCard label="Stocks sous seuil" value={String(getNumber(counts.lowStock))} tone={getNumber(counts.lowStock) > 0 ? "negative" : "default"} /></div>;
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReportingCenter({ search, onSearchChange }: ReportingCenterProps) {
  const queryClient = useQueryClient();
  const defaultFilters = useMemo(() => ({ ...getPresetFilters("month"), ...searchFilters(search) }), [search]);
  const [reportType, setReportType] = useState<ReportType>(search.tab ?? "OVERVIEW");
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<ReportFilters>(defaultFilters);
  const [savedReportName, setSavedReportName] = useState("");
  const [shareSavedReport, setShareSavedReport] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const nextFilters = { ...getPresetFilters("month"), ...searchFilters(search) };
    setReportType(search.tab ?? "OVERVIEW");
    setFilters(nextFilters);
    setDraftFilters(nextFilters);
    setPage(1);
  }, [search]);

  const accessQuery = useQuery({ queryKey: ["reporting", "access"], queryFn: () => getReportingAccess() });
  const filterOptionsQuery = useQuery({
    queryKey: ["reporting", "filter-options"],
    queryFn: () => getReportingFilterOptions(),
    enabled: accessQuery.data?.OVERVIEW === true,
  });
  const reportQuery = useQuery({
    queryKey: ["reporting", reportType, filters],
    queryFn: () => getManagementReport({ data: { reportType, filters } }),
    enabled: accessQuery.data?.[reportType] === true,
  });
  const operationsQuery = useQuery({
    queryKey: ["reporting", "operations", filters, page],
    queryFn: () => getManagementReportOperations({ data: { filters, page, pageSize: 25 } }),
    enabled: reportType === "FINANCE" && accessQuery.data?.FINANCE === true,
  });
  const savedReportsQuery = useQuery({
    queryKey: ["reporting", "saved"],
    queryFn: () => getSavedReports(),
    enabled: accessQuery.data?.OVERVIEW === true,
  });
  const saveMutation = useMutation({
    mutationFn: () => createSavedReport({ data: { name: savedReportName, reportType, filters, periodKey: null, isShared: accessQuery.data?.canManageSharedReports === true && shareSavedReport } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reporting", "saved"] });
      setSavedReportName("");
      setShareSavedReport(false);
      toast.success("Rapport enregistré.");
    },
    onError: (error) => notifyMutationError(error, "Impossible d’enregistrer le rapport."),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSavedReport({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reporting", "saved"] });
      toast.success("Rapport enregistré supprimé.");
    },
    onError: (error) => notifyMutationError(error, "Impossible de supprimer le rapport."),
  });
  const exportMutation = useMutation({
    mutationFn: () => exportManagementReportOperations({ data: { filters } }),
    onSuccess: (result) => {
      downloadCsv(result.content, result.filename);
      toast.success(`${result.rowCount} opération${result.rowCount > 1 ? "s" : ""} exportée${result.rowCount > 1 ? "s" : ""}.`);
    },
    onError: (error) => notifyMutationError(error, "Impossible d’exporter les opérations."),
  });

  const options = filterOptionsQuery.data;
  const canViewFinance = accessQuery.data?.FINANCE === true;
  const canManageSharedReports = accessQuery.data?.canManageSharedReports === true;
  const selectedOperations = operationsQuery.data ?? [];
  const totalOperations = selectedOperations[0]?.total_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalOperations / 25));
  const availableReports = REPORT_TYPES.filter((type) => accessQuery.data?.[type] === true);

  function updateDraft<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters(nextFilters = draftFilters, nextReportType = reportType) {
    const parsed = reportFiltersSchema.safeParse(nextFilters);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Filtres invalides.");
      return;
    }
    setFilters(parsed.data);
    setDraftFilters(parsed.data);
    setPage(1);
    onSearchChange(cleanSearch(nextReportType, parsed.data));
  }

  function selectReport(nextReportType: ReportType) {
    setReportType(nextReportType);
    applyFilters(draftFilters, nextReportType);
  }

  function loadSavedReport(savedReport: SavedReport) {
    if (!isReportType(savedReport.report_type)) {
      toast.error("Le type de ce rapport enregistré n’est plus disponible.");
      return;
    }
    const parsed = reportFiltersSchema.safeParse(savedReport.filters);
    if (!parsed.success) {
      toast.error("Les filtres de ce rapport enregistré ne sont plus valides.");
      return;
    }
    setReportType(savedReport.report_type);
    applyFilters(parsed.data, savedReport.report_type);
  }

  if (accessQuery.isLoading) {
    return <div className="grid min-h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (accessQuery.isError || accessQuery.data?.OVERVIEW !== true) {
    return <Card><CardHeader><CardTitle>Accès aux rapports indisponible</CardTitle><CardDescription>Votre rôle ne permet pas de consulter le centre de rapports, ou la vérification des droits a échoué.</CardDescription></CardHeader></Card>;
  }

  return (
    <div className="space-y-6">
      <OperationalHero
        variant="deep"
        icon={FileText}
        eyebrow="Finance"
        title="Rapports"
        description="Les bilans parlent fort pour ceux qui savent lire entre les lignes."
        primaryStat={{ label: "Résultats", value: totalOperations }}
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Imprimer</Button>
            {reportType === "FINANCE" && <Button variant="outline" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate()}>{exportMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Exporter CSV</Button>}
          </>
        }
      />

      <Tabs value={reportType} onValueChange={(value) => isReportType(value) && selectReport(value)}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto">
          {availableReports.map((type) => <TabsTrigger key={type} value={type}>{REPORT_LABELS[type]}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4"><div><CardTitle className="flex items-center gap-2"><Filter className="h-5 w-5" />Filtres</CardTitle><CardDescription>Les dates et filtres actifs sont conservés dans l’URL.</CardDescription></div><Button variant="ghost" onClick={() => { const next = getPresetFilters("month"); setDraftFilters(next); applyFilters(next); }}>Réinitialiser</Button></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2"><Label htmlFor="report-start">Date de début</Label><Input id="report-start" type="date" value={draftFilters.startDate ?? ""} onChange={(event) => updateDraft("startDate", event.target.value || undefined)} /></div>
          <div className="space-y-2"><Label htmlFor="report-end">Date de fin</Label><Input id="report-end" type="date" value={draftFilters.endDate ?? ""} onChange={(event) => updateDraft("endDate", event.target.value || undefined)} /></div>
          {canViewFinance && <div className="space-y-2"><Label>Wallet</Label><Select value={draftFilters.walletId ?? "all"} onValueChange={(value) => updateDraft("walletId", value === "all" ? undefined : value)}><SelectTrigger><SelectValue placeholder="Tous les wallets" /></SelectTrigger><SelectContent><SelectItem value="all">Tous les wallets</SelectItem>{(options?.wallets ?? []).map((wallet) => <SelectItem key={wallet.id} value={wallet.id}>{wallet.name}</SelectItem>)}</SelectContent></Select></div>}
          {canViewFinance && <div className="space-y-2"><Label>Type d’opération</Label><Select value={draftFilters.operationType ?? "all"} onValueChange={(value) => updateDraft("operationType", value === "all" ? undefined : value as ReportFilters["operationType"])}><SelectTrigger><SelectValue placeholder="Tous les types" /></SelectTrigger><SelectContent><SelectItem value="all">Tous les types</SelectItem><SelectItem value="REVENUE">Recette</SelectItem><SelectItem value="EXPENSE">Dépense</SelectItem><SelectItem value="DEPOSIT">Dépôt</SelectItem><SelectItem value="TRANSFER">Transfert</SelectItem></SelectContent></Select></div>}
          {canViewFinance && <div className="space-y-2"><Label>Catégorie</Label><Select value={draftFilters.category ?? "all"} onValueChange={(value) => updateDraft("category", value === "all" ? undefined : value)}><SelectTrigger><SelectValue placeholder="Toutes les catégories" /></SelectTrigger><SelectContent><SelectItem value="all">Toutes les catégories</SelectItem>{(options?.categories ?? []).map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></div>}
          {canViewFinance && <div className="space-y-2"><Label>Statut</Label><Select value={draftFilters.status ?? "all"} onValueChange={(value) => updateDraft("status", value === "all" ? undefined : value)}><SelectTrigger><SelectValue placeholder="Tous les statuts actifs" /></SelectTrigger><SelectContent><SelectItem value="all">Tous les statuts actifs</SelectItem><SelectItem value="VALIDE">Valide</SelectItem></SelectContent></Select></div>}
          <div className="space-y-2"><Label>Véhicule</Label><Select value={draftFilters.vehicleId ?? "all"} onValueChange={(value) => updateDraft("vehicleId", value === "all" ? undefined : value)}><SelectTrigger><SelectValue placeholder="Tous les véhicules" /></SelectTrigger><SelectContent><SelectItem value="all">Tous les véhicules</SelectItem>{(options?.vehicles ?? []).map((vehicle) => <SelectItem key={vehicle.id} value={vehicle.id}>{vehicle.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Moto</Label><Select value={draftFilters.motorcycleId ?? "all"} onValueChange={(value) => updateDraft("motorcycleId", value === "all" ? undefined : value)}><SelectTrigger><SelectValue placeholder="Toutes les motos" /></SelectTrigger><SelectContent><SelectItem value="all">Toutes les motos</SelectItem>{(options?.motorcycles ?? []).map((motorcycle) => <SelectItem key={motorcycle.id} value={motorcycle.id}>{motorcycle.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Exploitation</Label><Select value={draftFilters.farmId ?? "all"} onValueChange={(value) => updateDraft("farmId", value === "all" ? undefined : value)}><SelectTrigger><SelectValue placeholder="Toutes les exploitations" /></SelectTrigger><SelectContent><SelectItem value="all">Toutes les exploitations</SelectItem>{(options?.farms ?? []).map((farm) => <SelectItem key={farm.id} value={farm.id}>{farm.nom}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Chauffeur</Label><Select value={draftFilters.driverId ?? "all"} onValueChange={(value) => updateDraft("driverId", value === "all" ? undefined : value)}><SelectTrigger><SelectValue placeholder="Tous les chauffeurs" /></SelectTrigger><SelectContent><SelectItem value="all">Tous les chauffeurs</SelectItem>{(options?.drivers ?? []).map((driver) => <SelectItem key={driver.id} value={driver.id}>{driver.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Employé</Label><Select value={draftFilters.employeeId ?? "all"} onValueChange={(value) => updateDraft("employeeId", value === "all" ? undefined : value)}><SelectTrigger><SelectValue placeholder="Tous les employés" /></SelectTrigger><SelectContent><SelectItem value="all">Tous les employés</SelectItem>{(options?.employees ?? []).map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Article de stock</Label><Select value={draftFilters.inventoryItemId ?? "all"} onValueChange={(value) => updateDraft("inventoryItemId", value === "all" ? undefined : value)}><SelectTrigger><SelectValue placeholder="Tous les articles" /></SelectTrigger><SelectContent><SelectItem value="all">Tous les articles</SelectItem>{(options?.inventoryItems ?? []).map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label htmlFor="report-search">Recherche</Label><Input id="report-search" placeholder="Catégorie, référence, description…" value={draftFilters.search ?? ""} onChange={(event) => updateDraft("search", event.target.value || undefined)} /></div>
          <div className="flex flex-wrap items-end gap-2 xl:col-span-2"><Button variant="outline" onClick={() => applyFilters(getPresetFilters("today"))}>Aujourd’hui</Button><Button variant="outline" onClick={() => applyFilters(getPresetFilters("week"))}>Cette semaine</Button><Button variant="outline" onClick={() => applyFilters(getPresetFilters("month"))}>Ce mois</Button><Button variant="outline" onClick={() => applyFilters(getPresetFilters("previousMonth"))}>Mois précédent</Button><Button variant="outline" onClick={() => applyFilters(getPresetFilters("quarter"))}>Ce trimestre</Button><Button variant="outline" onClick={() => applyFilters(getPresetFilters("year"))}>Cette année</Button><Button onClick={() => applyFilters()}><RefreshCw className="mr-2 h-4 w-4" />Appliquer</Button></div>
        </CardContent>
      </Card>

      {savedReportsQuery.data && <Card><CardHeader><CardTitle className="flex items-center gap-2"><Save className="h-5 w-5" />Rapports enregistrés</CardTitle><CardDescription>Les filtres sont enregistrés ; les résultats sont toujours recalculés depuis les données autorisées.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex flex-col gap-2 md:flex-row"><Input placeholder="Nom du rapport" value={savedReportName} onChange={(event) => setSavedReportName(event.target.value)} />{canManageSharedReports && <label className="flex items-center gap-2 text-sm"><input checked={shareSavedReport} onChange={(event) => setShareSavedReport(event.target.checked)} type="checkbox" />Partager avec les rôles autorisés</label>}<Button disabled={savedReportName.trim().length === 0 || saveMutation.isPending} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" />Enregistrer</>}</Button></div>{savedReportsQuery.data.length > 0 && <div className="grid gap-2 md:grid-cols-2">{savedReportsQuery.data.map((savedReport) => <div className="flex items-center justify-between gap-2 rounded-md border p-3" key={savedReport.id}><button className="min-w-0 text-left hover:underline" onClick={() => loadSavedReport(savedReport)}><span className="block truncate font-medium">{savedReport.name}</span><span className="text-xs text-muted-foreground">{REPORT_LABELS[savedReport.report_type as ReportType] ?? savedReport.report_type}{savedReport.is_shared ? " · partagé" : ""}</span></button><Button aria-label={`Supprimer ${savedReport.name}`} disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(savedReport.id)} size="icon" variant="ghost"><Trash2 className="h-4 w-4" /></Button></div>)}</div>}</CardContent></Card>}

      {reportQuery.isLoading ? <div className="grid min-h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : reportQuery.isError ? <Card><CardHeader><CardTitle className="flex items-center gap-2 text-destructive"><AlertCircle className="h-5 w-5" />Rapport indisponible</CardTitle><CardDescription>{reportQuery.error instanceof Error ? reportQuery.error.message : "Une erreur est survenue lors du chargement du rapport."}</CardDescription></CardHeader></Card> : reportQuery.data ? <>
        {reportType === "OVERVIEW" && <OverviewReport canViewFinance={canViewFinance} report={reportQuery.data} />}
        {reportType === "FINANCE" && <FinanceSummary report={reportQuery.data} />}
        {reportType === "TREASURY" && <TreasuryReport report={reportQuery.data} />}
        {(reportType === "VEHICLES" || reportType === "MOTORCYCLES") && <AssetsReport report={reportQuery.data} />}
        {(reportType === "DRIVERS" || reportType === "EMPLOYEES") && <PeopleReport report={reportQuery.data} />}
        {reportType === "FARMS" && <FarmsReport report={reportQuery.data} />}
        {reportType === "MAINTENANCE" && <MaintenanceReport report={reportQuery.data} />}
        {reportType === "STOCK" && <StockReport report={reportQuery.data} />}
        {reportType === "COMPLIANCE" && <ComplianceReport report={reportQuery.data} />}
      </> : null}

      {reportType === "FINANCE" && canViewFinance && <Card><CardHeader className="gap-3 md:flex-row md:items-center md:justify-between"><div><CardTitle>Opérations sources</CardTitle><CardDescription>Liste paginée des écritures non annulées correspondant exactement aux filtres actifs.</CardDescription></div><Badge variant="secondary">{totalOperations} opération{totalOperations > 1 ? "s" : ""}</Badge></CardHeader><CardContent className="space-y-4">{operationsQuery.isLoading ? <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : operationsQuery.isError ? <p className="py-8 text-center text-sm text-destructive">Impossible de charger les opérations. Réessayez dans un instant.</p> : <DataTable headers={["Date", "Type", "Montant", "Wallet", "Source"]} hasRows={selectedOperations.length > 0}>{selectedOperations.map((operation) => <tr className="border-t" key={operation.id}><td className="px-4 py-3">{formatDate(operation.operation_date)}</td><td className="px-4 py-3"><Badge variant="secondary">{FINANCE_OPERATION_TYPE_LABELS[operation.type as keyof typeof FINANCE_OPERATION_TYPE_LABELS] ?? operation.type}</Badge></td><td className="px-4 py-3 font-medium">{formatXOF(operation.amount)}</td><td className="px-4 py-3">{operation.wallet_name}</td><td className="px-4 py-3"><Link className="hover:underline" to={operation.source_route}>{operation.source_label}</Link><span className="block text-xs text-muted-foreground">{operation.description ?? operation.category ?? ""}</span></td></tr>)}</DataTable>}<div className="flex items-center justify-end gap-2"><Button disabled={page <= 1 || operationsQuery.isFetching} onClick={() => setPage((current) => current - 1)} variant="outline">Précédent</Button><span className="text-sm text-muted-foreground">Page {page} / {pageCount}</span><Button disabled={page >= pageCount || operationsQuery.isFetching} onClick={() => setPage((current) => current + 1)} variant="outline">Suivant</Button></div></CardContent></Card>}

      <p className="text-xs text-muted-foreground"><FileText className="mr-1 inline h-3 w-3" />Les rapports affichent des indicateurs de gestion. Ils ne remplacent pas un bilan ou un compte de résultat comptable légal.</p>
    </div>
  );
}
