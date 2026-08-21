import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign, Landmark, Plus, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { PurchaseForm } from "@/components/purchases/purchase-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissions } from "@/hooks/use-permissions";
import { formatXOF as formatAmount } from "@/lib/format";
import { PURCHASE_STATUSES, getPurchases } from "@/lib/purchases.functions";

export const Route = createFileRoute("/_authenticated/purchases/")({
  validateSearch: z.object({ supplierId: z.string().uuid().optional() }),
  component: PurchasesPage,
});

function statusLabel(status: string) {
  return status === "CANCELLED" ? "Annulé" : "Réceptionné";
}

function PurchasesPage() {
  const { supplierId: initialSupplierId } = Route.useSearch();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [supplierId, setSupplierId] = useState(initialSupplierId ?? "");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const pageSize = 20;
  const canReadFinance = can("purchases.finance.read");

  const purchasesQuery = useQuery({
    queryKey: ["purchases", { page, search, status, supplierId }],
    queryFn: () => getPurchases({ data: {
      page, pageSize, search,
      status: status === "ALL" ? null : status as (typeof PURCHASE_STATUSES)[number],
      supplierId: supplierId || null, businessLocationId: null,
    } }),
  });

  const purchases = purchasesQuery.data?.purchases ?? [];
  const total = purchasesQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const summaryUnavailable = purchasesQuery.isPending || purchasesQuery.isError;
  const overview = {
    received: purchases.filter((purchase) => purchase.status === "RECEIVED").length,
    total: purchases.reduce((sum, purchase) => sum + Number(purchase.total_amount), 0),
    due: purchases.reduce((sum, purchase) => sum + (purchase.amountDue ?? 0), 0),
  };

  return <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
    <OperationalHero
      icon={ShoppingCart}
      eyebrow="Commerce"
      title="Achats & fournisseurs"
      description="Réceptionnez un achat fournisseur puis réglez la dette au fil de l’eau. La réception ne touche jamais un wallet directement."
      primaryStat={{ label: "Achats", value: total }}
      secondaryStats={[{ label: "Réceptionnés", value: overview.received }]}
      actions={can("purchases.create") ? <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" />Nouvel achat</Button> : undefined}
    />
    <div className="grid gap-3 sm:grid-cols-3">
      <MetricCard icon={ShoppingCart} label="Achats réceptionnés" value={summaryUnavailable ? "…" : overview.received} description="Sur la page affichée" tone="success" />
      <MetricCard icon={CircleDollarSign} label="Total acheté" value={summaryUnavailable || !canReadFinance ? "…" : formatAmount(overview.total)} description={canReadFinance ? "Sur la page affichée" : "Accès financier requis"} tone="info" />
      <MetricCard icon={Landmark} label="Reste dû" value={summaryUnavailable || !canReadFinance ? "…" : formatAmount(overview.due)} description={canReadFinance ? "Sur la page affichée" : "Accès financier requis"} tone="warning" />
    </div>

    <Card variant="section">
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Rechercher par numéro, référence…" aria-label="Rechercher un achat" />
          <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les statuts</SelectItem>
              {PURCHASE_STATUSES.map((value) => <SelectItem key={value} value={value}>{statusLabel(value)}</SelectItem>)}
            </SelectContent>
          </Select>
          {supplierId ? <Button variant="outline" onClick={() => { setSupplierId(""); void navigate({ to: "/purchases", search: {} }); }}>Retirer le filtre fournisseur</Button> : <p className="self-center text-sm text-muted-foreground">Page {page} / {totalPages}</p>}
        </div>

        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead>Achat</TableHead><TableHead>Fournisseur</TableHead><TableHead>Date</TableHead><TableHead>Statut</TableHead>{canReadFinance ? <TableHead className="text-right">Reste dû</TableHead> : null}</TableRow></TableHeader>
            <TableBody>
              {purchasesQuery.isPending ? Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              )) : null}
              {purchasesQuery.isError ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-destructive">Impossible de charger les achats. Réessayez dans un instant.</TableCell></TableRow> : null}
              {!purchasesQuery.isPending && !purchasesQuery.isError && purchases.length === 0 ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">Aucun achat ne correspond aux critères actuels.</TableCell></TableRow> : null}
              {purchases.map((purchase) => (
                <TableRow key={purchase.id}>
                  <TableCell><Link to="/purchases/$purchaseId" params={{ purchaseId: purchase.id }} className="font-medium hover:underline">{purchase.purchase_number}</Link>{purchase.reference ? <p className="text-xs text-muted-foreground">{purchase.reference}</p> : null}</TableCell>
                  <TableCell>{purchase.supplierName ?? "—"}</TableCell>
                  <TableCell>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${purchase.purchase_date}T12:00:00`))}</TableCell>
                  <TableCell><Badge variant={purchase.status === "CANCELLED" ? "danger" : "success"}>{statusLabel(purchase.status)}</Badge></TableCell>
                  {canReadFinance ? <TableCell className="text-right tabular-nums">{purchase.amountDue !== null && purchase.amountDue > 0 ? <span className="font-medium text-warning-foreground">{formatAmount(purchase.amountDue)}</span> : formatAmount(Number(purchase.total_amount))}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
          <p className="text-sm text-muted-foreground">Pagination des achats</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Précédent</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Suivant</Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Nouvel achat fournisseur</DialogTitle></DialogHeader>
        <PurchaseForm onSuccess={(purchaseId) => { setCreateOpen(false); void navigate({ to: "/purchases/$purchaseId", params: { purchaseId } }); }} />
      </DialogContent>
    </Dialog>
  </div>;
}
