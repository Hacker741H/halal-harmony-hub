import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, PackageCheck, Truck, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/hooks/use-permissions";
import {
  cancelStockTransfer,
  dispatchStockTransfer,
  getStockTransfer,
  receiveStockTransfer,
} from "@/lib/stock-transfers.functions";
import { formatDateTimeMedium as formatDateTime, formatXOF as formatAmount } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/stock-transfers/$transferId")({ component: StockTransferDetailPage });

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

function formatQuantity(value: number | string | null) {
  return value === null ? "—" : Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}

function showError(fallback: string) {
  return (error: Error) => toast.error(error instanceof Error ? error.message : fallback);
}

function StockTransferDetailPage() {
  const { transferId } = Route.useParams();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const transferQuery = useQuery({ queryKey: ["stock-transfer", transferId], queryFn: () => getStockTransfer({ data: transferId }) });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["stock-transfer", transferId] });
    void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
    // Dispatch debits source stock and receipt credits destination stock --
    // without this the Stocks page can show pre-mutation quantities for the
    // rest of the global staleTime window instead of refetching immediately.
    void queryClient.invalidateQueries({ queryKey: ["stocks"] });
    void queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
  };
  const dispatchMutation = useMutation({
    mutationFn: dispatchStockTransfer,
    onSuccess: () => { toast.success("Transfert expédié : le stock source a été débité."); invalidate(); },
    onError: showError("Impossible d’expédier le transfert."),
  });

  if (transferQuery.isPending) return <div className="p-6 text-muted-foreground">Chargement du transfert…</div>;
  if (transferQuery.isError || !transferQuery.data) return <div className="space-y-4 p-6"><p className="text-destructive">Transfert introuvable ou non autorisé.</p><Button asChild variant="outline"><Link to="/stock-transfers"><ArrowLeft className="size-4" />Retour aux transferts</Link></Button></div>;

  const detail = transferQuery.data;
  const { transfer, lines } = detail;
  const canDispatch = can("transfers.dispatch") && transfer.status === "CREATED";
  const canCancel = can("transfers.create") && transfer.status === "CREATED";
  const canReceive = can("transfers.receive") && transfer.status === "DISPATCHED";

  return <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
    <Button asChild variant="ghost" className="-ml-2 px-2"><Link to="/stock-transfers"><ArrowLeft className="size-4" />Transferts</Link></Button>

    <OperationalHero
      variant="deep"
      icon={Truck}
      eyebrow="Transfert"
      title={transfer.transfer_number}
      primaryStat={{ label: "Articles", value: lines.length }}
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-foreground">{detail.sourceName ?? "Source non accessible"}</span>
          <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
          <span className="font-medium text-foreground">{detail.destinationName ?? "Destination non accessible"}</span>
          <span>· Créé le {formatDateTime(transfer.created_at)}{transfer.dispatched_at ? ` · Expédié le ${formatDateTime(transfer.dispatched_at)}` : ""}{transfer.received_at ? ` · Reçu le ${formatDateTime(transfer.received_at)}` : ""}</span>
        </span>
      }
      actions={
        <>
          <Badge variant={statusVariant(transfer.status)} appearance="soft">{statusLabel(transfer.status)}</Badge>
          {canDispatch ? <Button onClick={() => dispatchMutation.mutate({ data: { id: transferId } })} loading={dispatchMutation.isPending}><Truck className="size-4" />Expédier</Button> : null}
          {canReceive ? <Button onClick={() => setReceiveOpen(true)}><PackageCheck className="size-4" />Réceptionner</Button> : null}
          {canCancel ? <Button variant="outline" onClick={() => setCancelOpen(true)}><XCircle className="size-4" />Annuler</Button> : null}
        </>
      }
    />

    {transfer.status === "CANCELLED" && transfer.cancellation_reason ? <Card variant="information" className="p-5"><p className="font-medium text-foreground">Motif d’annulation</p><p className="mt-1 text-sm text-muted-foreground">{transfer.cancellation_reason}</p></Card> : null}
    {transfer.status === "DISPATCHED" ? <Card variant="information" className="p-5"><p className="font-medium text-foreground">En transit</p><p className="mt-1 text-sm text-muted-foreground">Le stock a quitté {detail.sourceName ?? "le magasin source"} et n’est pas encore disponible à {detail.destinationName ?? "la destination"}. Il ne peut plus être annulé — seule la réception peut clore ce transfert.</p></Card> : null}

    <Card variant="section">
      <CardHeader><CardTitle>Articles</CardTitle><CardDescription>La quantité reçue peut différer de la quantité demandée : elle est enregistrée telle quelle, jamais corrigée automatiquement.</CardDescription></CardHeader>
      <CardContent>
        {lines.length ? (
          <div className="overflow-x-auto rounded-xl border border-border/75">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-sunken/55 text-left text-caption">
                <tr>
                  <th className="px-4 py-3">Article</th>
                  <th className="px-4 py-3 text-right">Qté demandée</th>
                  <th className="px-4 py-3 text-right">Coût figé</th>
                  <th className="px-4 py-3 text-right">Qté reçue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {lines.map((line) => {
                  const variance = line.quantity_received !== null && Number(line.quantity_received) !== Number(line.quantity_requested);
                  return <tr key={line.id}>
                    <td className="px-4 py-3 font-medium text-foreground">{line.itemName ?? "Article"}{line.itemSku ? <span className="ml-1.5 text-caption text-muted-foreground">({line.itemSku})</span> : null}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatQuantity(line.quantity_requested)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatAmount(line.unit_cost)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${variance ? "font-medium text-warning-foreground" : ""}`}>{formatQuantity(line.quantity_received)}{variance ? " (écart)" : ""}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="py-10 text-center text-sm text-muted-foreground">Aucune ligne pour ce transfert.</p>}
      </CardContent>
    </Card>

    {transfer.notes ? <Card variant="section"><CardHeader><CardTitle>Notes</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-body-sm text-foreground">{transfer.notes}</p></CardContent></Card> : null}

    <ReceiveTransferDialog open={receiveOpen} onOpenChange={setReceiveOpen} transferId={transferId} lines={lines} onSaved={invalidate} />
    <CancelTransferDialog open={cancelOpen} onOpenChange={setCancelOpen} transferId={transferId} onSaved={invalidate} />
  </div>;
}

function ReceiveTransferDialog({ open, onOpenChange, transferId, lines, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; transferId: string;
  lines: { id: string; inventory_item_id: string; itemName: string | null; quantity_requested: number | string }[];
  onSaved: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  function quantityFor(line: (typeof lines)[number]) {
    return quantities[line.inventory_item_id] ?? String(line.quantity_requested);
  }

  const mutation = useMutation({
    mutationFn: receiveStockTransfer,
    onSuccess: () => { toast.success("Transfert réceptionné : le stock destination a été crédité."); setQuantities({}); onOpenChange(false); onSaved(); },
    onError: showError("Impossible de réceptionner le transfert."),
  });

  function submit() {
    const payloadLines = lines.map((line) => ({ inventory_item_id: line.inventory_item_id, quantity_received: Number(quantityFor(line)) }));
    if (payloadLines.some((line) => Number.isNaN(line.quantity_received) || line.quantity_received < 0)) {
      toast.error("Chaque ligne doit avoir une quantité reçue positive ou nulle.");
      return;
    }
    mutation.mutate({ data: { id: transferId, lines: payloadLines } });
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>Réceptionner le transfert</DialogTitle><DialogDescription>Ajustez la quantité si elle diffère de ce qui a été expédié — l’écart reste visible, il n’est jamais corrigé automatiquement.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        {lines.map((line) => (
          <div key={line.id} className="grid grid-cols-[1fr_120px] items-center gap-3">
            <Label className="text-sm">{line.itemName ?? "Article"} <span className="text-caption text-muted-foreground">(demandé : {Number(line.quantity_requested).toLocaleString("fr-FR", { maximumFractionDigits: 3 })})</span></Label>
            <Input
              type="number"
              min="0"
              step="0.001"
              value={quantityFor(line)}
              onChange={(event) => setQuantities((current) => ({ ...current, [line.inventory_item_id]: event.target.value }))}
              className="text-right tabular-nums"
            />
          </div>
        ))}
      </div>
      <DialogFooter><Button disabled={mutation.isPending} onClick={submit} loading={mutation.isPending}>Confirmer la réception</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function CancelTransferDialog({ open, onOpenChange, transferId, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; transferId: string; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: cancelStockTransfer,
    onSuccess: () => { toast.success("Transfert annulé."); setReason(""); onOpenChange(false); onSaved(); },
    onError: showError("Impossible d’annuler le transfert."),
  });
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>Annuler ce transfert</DialogTitle><DialogDescription>Le stock n’a pas encore été expédié : l’annulation n’a aucun impact stock.</DialogDescription></DialogHeader>
      <div className="space-y-2"><Label htmlFor="transfer-cancel-reason">Justification</Label><Textarea id="transfer-cancel-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Expliquez l’annulation…" /></div>
      <DialogFooter><Button variant="danger" disabled={reason.trim().length < 3 || mutation.isPending} onClick={() => mutation.mutate({ data: { id: transferId, reason: reason.trim() } })} loading={mutation.isPending}>Confirmer l’annulation</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
