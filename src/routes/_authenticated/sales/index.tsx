import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign, FileText, Landmark, PackageCheck, Plus, ReceiptText, Sprout } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { CommercialSaleForm } from "@/components/commercial/commercial-sale-form";
import { CommercialSalesList } from "@/components/commercial/commercial-sales-list";
import { ClientSelect, FarmSelect } from "@/components/selects/entity-selects";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePermissions } from "@/hooks/use-permissions";
import { COMMERCIAL_SALE_STATUSES, getCommercialSales } from "@/lib/commercial-sales.functions";

export const Route = createFileRoute("/_authenticated/sales/")({
  validateSearch: z.object({ clientId: z.string().uuid().optional() }),
  component: SalesPage,
});

function formatAmount(value: number) {
  return `${value.toLocaleString("fr-FR")} FCFA`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = { DRAFT: "Brouillon", CONFIRMED: "Confirmée", CANCELLED: "Annulée", ARCHIVED: "Archivée" };
  return labels[status] ?? status;
}

function SalesPage() {
  const { clientId: initialClientId } = Route.useSearch();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [farmId, setFarmId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const pageSize = 20;
  const canReadFinance = can("sales.finance.read");

  const salesQuery = useQuery({
    queryKey: ["commercial-sales", { page, search, status, clientId, farmId, from, to }],
    queryFn: () => getCommercialSales({ data: {
      page,
      pageSize,
      search,
      status: status === "ALL" ? null : status as (typeof COMMERCIAL_SALE_STATUSES)[number],
      clientId: clientId || null,
      farmId: farmId || null,
      from: from || null,
      to: to || null,
    } }),
  });

  const sales = salesQuery.data?.sales ?? [];
  const total = salesQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const summaryUnavailable = salesQuery.isPending || salesQuery.isError;
  const overview = {
    drafts: sales.filter((sale) => sale.status === "DRAFT").length,
    confirmed: sales.filter((sale) => sale.status === "CONFIRMED").length,
    invoiced: sales.reduce((sum, sale) => sum + (sale.totalInvoiced ?? 0), 0),
    due: sales.reduce((sum, sale) => sum + (sale.amountDue ?? 0), 0),
  };

  function resetFilters() {
    setSearch(""); setStatus("ALL"); setClientId(""); setFarmId(""); setFrom(""); setTo(""); setPage(1);
  }

  return <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
    <OperationalHero icon={PackageCheck} eyebrow="Commerce" title="Ventes & créances" description="Préparez une vente, facturez le client puis enregistrez les encaissements sur le wallet choisi. Les comptes clients restent lisibles sans double saisie." primaryStat={{ label: "Ventes", value: total }} secondaryStats={[{ label: "Confirmées", value: overview.confirmed }]} actions={can("sales.create") ? <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" />Nouvelle vente</Button> : undefined} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={FileText} label="Brouillons" value={summaryUnavailable ? "…" : overview.drafts} description="Ventes à compléter" tone="info" />
      <MetricCard icon={ReceiptText} label="Ventes confirmées" value={summaryUnavailable ? "…" : overview.confirmed} description="Sur la page affichée" tone="success" />
      <MetricCard icon={CircleDollarSign} label="Facturé" value={summaryUnavailable || !canReadFinance ? "…" : formatAmount(overview.invoiced)} description={canReadFinance ? "Sur la page affichée" : "Accès financier requis"} tone="warning" />
      <MetricCard icon={Landmark} label="Reste à encaisser" value={summaryUnavailable || !canReadFinance ? "…" : formatAmount(overview.due)} description={canReadFinance ? "Sur la page affichée" : "Accès financier requis"} tone="danger" />
    </div>

    <Card variant="section" className="border-border/80"><CardContent className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-col gap-3 border-b border-border/70 pb-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-label text-foreground">Trouver et filtrer</p><p className="mt-1 text-caption">Les filtres sont appliqués à la liste des ventes ci-dessous.</p></div><p className="text-caption tabular-nums text-muted-foreground">{total} vente{total > 1 ? "s" : ""} trouvée{total > 1 ? "s" : ""}</p></div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_180px_170px_170px]"><Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Rechercher un numéro, une référence ou une note…" aria-label="Rechercher une vente" /><Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger><SelectValue placeholder="Tous les statuts" /></SelectTrigger><SelectContent><SelectItem value="ALL">Tous les statuts</SelectItem>{COMMERCIAL_SALE_STATUSES.map((item) => <SelectItem key={item} value={item}>{statusLabel(item)}</SelectItem>)}</SelectContent></Select><div className="space-y-1"><Label className="text-caption">Du</Label><Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></div><div className="space-y-1"><Label className="text-caption">Au</Label><Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></div></div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><ClientSelect value={clientId} onValueChange={(value) => { setClientId(value); setPage(1); }} placeholder="Filtrer par client" /><FarmSelect value={farmId} onValueChange={(value) => { setFarmId(value); setPage(1); }} placeholder="Filtrer par exploitation" /><Button variant="ghost" onClick={resetFilters}>Réinitialiser</Button></div>
    </CardContent></Card>

    <CommercialSalesList sales={sales} loading={salesQuery.isPending} error={salesQuery.isError} canReadFinance={canReadFinance} />
    <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-caption text-muted-foreground">Page {page} sur {totalPages}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Précédent</Button><Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Suivant</Button></div></div>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>Nouvelle vente</DialogTitle></DialogHeader><CommercialSaleForm onSuccess={(saleId) => { setCreateOpen(false); void navigate({ to: "/sales/$saleId", params: { saleId } }); }} /></DialogContent></Dialog>
  </div>;
}
