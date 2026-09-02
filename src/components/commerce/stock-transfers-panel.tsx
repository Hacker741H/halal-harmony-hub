import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, PackageCheck, PackageOpen, Truck } from "lucide-react";
import { useState } from "react";

import { StockTransferForm } from "@/components/stock-transfers/stock-transfer-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MetricCard } from "@/components/ui/metric-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissions } from "@/hooks/use-permissions";
import { STOCK_TRANSFER_STATUSES, getStockTransfers } from "@/lib/stock-transfers.functions";

// Contenu extrait de l'ancienne route /stock-transfers (désormais une
// redirection vers /stock-operations) pour vivre comme onglet "Transferts"
// -- même comportement, même permissions, juste plus de destination de menu
// à part. Aucun RPC touché.

function statusLabel(status: string) {
  const labels: Record<string, string> = { CREATED: "À préparer", DISPATCHED: "En transit", RECEIVED: "Reçu", CANCELLED: "Annulé" };
  return labels[status] ?? status;
}

function statusVariant(status: string): "outline" | "info" | "success" | "danger" {
  if (status === "DISPATCHED") return "info";
  if (status === "RECEIVED") return "success";
  if (status === "CANCELLED") return "danger";
  return "outline";
}

function formatDateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

export function StockTransfersPanel() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const pageSize = 20;

  const transfersQuery = useQuery({
    queryKey: ["stock-transfers", { page, status }],
    queryFn: () => getStockTransfers({ data: {
      page, pageSize,
      status: status === "ALL" ? null : status as (typeof STOCK_TRANSFER_STATUSES)[number],
      businessLocationId: null,
    } }),
  });

  const transfers = transfersQuery.data?.transfers ?? [];
  const total = transfersQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const overview = {
    toPrepare: transfers.filter((transfer) => transfer.status === "CREATED").length,
    inTransit: transfers.filter((transfer) => transfer.status === "DISPATCHED").length,
    received: transfers.filter((transfer) => transfer.status === "RECEIVED").length,
  };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">Expédiez du stock d’un magasin vers un autre : le coût est figé à l’expédition, la destination recalcule sa propre moyenne. Aucune écriture financière.</p>
      {can("transfers.create") ? <Button onClick={() => setCreateOpen(true)}><ArrowLeftRight className="size-4" />Nouveau transfert</Button> : null}
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <MetricCard icon={PackageOpen} label="À préparer" value={transfersQuery.isPending ? "…" : overview.toPrepare} description="Sur la page affichée" tone="warning" />
      <MetricCard icon={Truck} label="En transit" value={transfersQuery.isPending ? "…" : overview.inTransit} description="Sur la page affichée" tone="info" />
      <MetricCard icon={PackageCheck} label="Reçus" value={transfersQuery.isPending ? "…" : overview.received} description="Sur la page affichée" tone="success" />
    </div>

    <Card variant="section">
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-3 md:grid-cols-[220px_auto]">
          <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les statuts</SelectItem>
              {STOCK_TRANSFER_STATUSES.map((value) => <SelectItem key={value} value={value}>{statusLabel(value)}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="self-center text-sm text-muted-foreground">Page {page} / {totalPages}</p>
        </div>

        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead>Transfert</TableHead><TableHead>Source</TableHead><TableHead>Destination</TableHead><TableHead>Créé le</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {transfersQuery.isPending ? Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              )) : null}
              {transfersQuery.isError ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-destructive">Impossible de charger les transferts. Réessayez dans un instant.</TableCell></TableRow> : null}
              {!transfersQuery.isPending && !transfersQuery.isError && transfers.length === 0 ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">Aucun transfert ne correspond aux critères actuels.</TableCell></TableRow> : null}
              {transfers.map((transfer) => (
                <TableRow key={transfer.id}>
                  <TableCell><Link to="/stock-transfers/$transferId" params={{ transferId: transfer.id }} className="font-medium hover:underline">{transfer.transfer_number}</Link></TableCell>
                  <TableCell>{transfer.sourceName ?? "—"}</TableCell>
                  <TableCell>{transfer.destinationName ?? "—"}</TableCell>
                  <TableCell>{formatDateTime(transfer.created_at)}</TableCell>
                  <TableCell><Badge variant={statusVariant(transfer.status)}>{statusLabel(transfer.status)}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
          <p className="text-sm text-muted-foreground">Pagination des transferts</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Précédent</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Suivant</Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Nouveau transfert inter-magasins</DialogTitle></DialogHeader>
        <StockTransferForm onSuccess={(transferId) => { setCreateOpen(false); void navigate({ to: "/stock-transfers/$transferId", params: { transferId } }); }} />
      </DialogContent>
    </Dialog>
  </div>;
}
