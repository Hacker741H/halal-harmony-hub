import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCheck, Package, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/hooks/use-permissions";
import {
  cancelInventoryCount,
  completeInventoryCount,
  getInventoryCount,
  updateInventoryCountLine,
  type InventoryCountDetail,
} from "@/lib/inventory-counts.functions";

export const Route = createFileRoute("/_authenticated/inventory-counts/$countId")({ component: InventoryCountDetailPage });

function statusLabel(status: string) {
  const labels: Record<string, string> = { OPEN: "Ouvert", COMPLETED: "Validé", CANCELLED: "Annulé" };
  return labels[status] ?? status;
}

function statusVariant(status: string): "info" | "success" | "danger" {
  if (status === "COMPLETED") return "success";
  if (status === "CANCELLED") return "danger";
  return "info";
}

function formatDateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function formatQuantity(value: number | string | null) {
  return value === null ? "—" : Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}

function showError(fallback: string) {
  return (error: Error) => toast.error(error instanceof Error ? error.message : fallback);
}

function InventoryCountDetailPage() {
  const { countId } = Route.useParams();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const countQuery = useQuery({ queryKey: ["inventory-count", countId], queryFn: () => getInventoryCount({ data: countId }) });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["inventory-count", countId] });
    void queryClient.invalidateQueries({ queryKey: ["inventory-counts"] });
    // Completing a count applies its discrepancies to stock -- without this
    // the Stocks page can show pre-mutation quantities for the rest of the
    // global staleTime window instead of refetching immediately.
    void queryClient.invalidateQueries({ queryKey: ["stocks"] });
    void queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
  };

  if (countQuery.isPending) return <div className="p-6 text-muted-foreground">Chargement de l’inventaire…</div>;
  if (countQuery.isError || !countQuery.data) return <div className="space-y-4 p-6"><p className="text-destructive">Inventaire introuvable ou non autorisé.</p><Button asChild variant="outline"><Link to="/inventory-counts"><ArrowLeft className="size-4" />Retour aux inventaires</Link></Button></div>;

  const detail = countQuery.data;
  const { count, lines } = detail;
  const isOpen = count.status === "OPEN";
  const canCount = can("inventory.counts.create") && isOpen;
  const canComplete = can("inventory.counts.complete") && isOpen;
  const variantLines = lines.filter((line) => line.counted_quantity !== null && Number(line.counted_quantity) !== Number(line.system_quantity));
  const uncountedLines = lines.filter((line) => line.counted_quantity === null);

  return <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
    <section className="relative isolate overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-surface-elevated to-surface p-5 shadow-md sm:p-7">
      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <Button asChild variant="ghost" className="-ml-2 px-2"><Link to="/inventory-counts"><ArrowLeft className="size-4" />Inventaires</Link></Button>
          <div className="mt-4 flex flex-wrap items-center gap-3"><h1 className="text-h1">{count.count_number}</h1><Badge variant={statusVariant(count.status)} appearance="soft">{statusLabel(count.status)}</Badge></div>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-body-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Package className="size-4 text-primary" aria-hidden="true" />{detail.locationName ?? "Magasin non accessible"}</span>
            <span>Ouvert le {formatDateTime(count.opened_at)}</span>
            {count.status === "COMPLETED" ? <span>Validé le {formatDateTime(count.completed_at)}</span> : null}
            {count.status === "CANCELLED" ? <span>Annulé le {formatDateTime(count.cancelled_at)}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canComplete ? <Button onClick={() => setCompleteOpen(true)}><ClipboardCheck className="size-4" />Valider l’inventaire</Button> : null}
          {canCount ? <Button variant="outline" onClick={() => setCancelOpen(true)}><XCircle className="size-4" />Annuler</Button> : null}
        </div>
      </div>
    </section>

    {count.status === "CANCELLED" && count.cancellation_reason ? <Card variant="information" className="p-5"><p className="font-medium text-foreground">Motif d’annulation</p><p className="mt-1 text-sm text-muted-foreground">{count.cancellation_reason}</p></Card> : null}

    <Card variant="section">
      <CardHeader>
        <CardTitle>Lignes de comptage</CardTitle>
        <CardDescription>
          {isOpen
            ? `${lines.length} article(s) à compter · ${uncountedLines.length} non compté(s) — un comptage partiel peut être validé.`
            : `${lines.length} article(s) · ${variantLines.length} écart(s) appliqué(s) au stock.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {lines.length ? (
          <div className="overflow-x-auto rounded-xl border border-border/75">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-sunken/55 text-left text-caption">
                <tr>
                  <th className="px-4 py-3">Article</th>
                  <th className="px-4 py-3 text-right">Qté système</th>
                  <th className="px-4 py-3 text-right">Qté comptée</th>
                  <th className="px-4 py-3 text-right">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {lines.map((line) => (
                  <CountLineRow key={line.id} countId={countId} line={line} editable={canCount} onSaved={invalidate} />
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="py-10 text-center text-sm text-muted-foreground">Aucune ligne pour cet inventaire.</p>}
      </CardContent>
    </Card>

    <CompleteInventoryCountDialog
      open={completeOpen}
      onOpenChange={setCompleteOpen}
      countId={countId}
      variantCount={variantLines.length}
      uncountedCount={uncountedLines.length}
      onSaved={invalidate}
    />
    <CancelInventoryCountDialog open={cancelOpen} onOpenChange={setCancelOpen} countId={countId} onSaved={invalidate} />
  </div>;
}

function CountLineRow({ countId, line, editable, onSaved }: { countId: string; line: InventoryCountDetail["lines"][number]; editable: boolean; onSaved: () => void }) {
  const [value, setValue] = useState(line.counted_quantity === null ? "" : String(line.counted_quantity));

  useEffect(() => {
    setValue(line.counted_quantity === null ? "" : String(line.counted_quantity));
  }, [line.counted_quantity]);

  const mutation = useMutation({
    mutationFn: updateInventoryCountLine,
    onSuccess: onSaved,
    onError: showError("Impossible d’enregistrer la quantité comptée."),
  });

  function save() {
    const parsed = Number(value);
    if (value.trim() === "" || Number.isNaN(parsed) || parsed < 0) return;
    if (line.counted_quantity !== null && parsed === Number(line.counted_quantity)) return;
    mutation.mutate({ data: { countId, inventoryItemId: line.inventory_item_id, countedQuantity: parsed } });
  }

  const variance = line.counted_quantity === null ? null : Number(line.counted_quantity) - Number(line.system_quantity);

  return <tr>
    <td className="px-4 py-3 font-medium text-foreground">{line.itemName ?? "Article"}{line.itemSku ? <span className="ml-1.5 text-caption text-muted-foreground">({line.itemSku})</span> : null}</td>
    <td className="px-4 py-3 text-right tabular-nums">{formatQuantity(line.system_quantity)}</td>
    <td className="px-4 py-3 text-right">
      {editable ? (
        <Input
          type="number"
          min="0"
          step="0.001"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => { if (event.key === "Enter") { event.currentTarget.blur(); } }}
          disabled={mutation.isPending}
          className="ml-auto w-28 text-right tabular-nums"
          aria-label={`Quantité comptée pour ${line.itemName ?? "article"}`}
        />
      ) : <span className="tabular-nums">{formatQuantity(line.counted_quantity)}</span>}
    </td>
    <td className={`px-4 py-3 text-right tabular-nums font-medium ${variance === null ? "text-muted-foreground" : variance === 0 ? "text-success" : "text-warning-foreground"}`}>
      {variance === null ? "Non compté" : variance > 0 ? `+${formatQuantity(variance)}` : formatQuantity(variance)}
    </td>
  </tr>;
}

function CompleteInventoryCountDialog({ open, onOpenChange, countId, variantCount, uncountedCount, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; countId: string; variantCount: number; uncountedCount: number; onSaved: () => void;
}) {
  const mutation = useMutation({
    mutationFn: completeInventoryCount,
    onSuccess: () => { toast.success("Inventaire validé : les écarts ont été appliqués au stock."); onOpenChange(false); onSaved(); },
    onError: showError("Impossible de valider l’inventaire."),
  });
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Valider cet inventaire ?</DialogTitle>
        <DialogDescription>
          {variantCount > 0 ? `${variantCount} ligne(s) avec écart seront appliquées au stock, au coût moyen courant.` : "Aucun écart détecté : la validation clôture simplement l’inventaire."}
          {uncountedCount > 0 ? ` ${uncountedCount} ligne(s) non comptée(s) seront ignorées.` : ""}
          {" "}Cette action est irréversible.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter><Button disabled={mutation.isPending} onClick={() => mutation.mutate({ data: { id: countId } })} loading={mutation.isPending}>Valider et appliquer</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function CancelInventoryCountDialog({ open, onOpenChange, countId, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; countId: string; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: cancelInventoryCount,
    onSuccess: () => { toast.success("Inventaire annulé."); setReason(""); onOpenChange(false); onSaved(); },
    onError: showError("Impossible d’annuler l’inventaire."),
  });
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>Annuler cet inventaire</DialogTitle><DialogDescription>Le stock n’a pas encore été modifié : l’annulation n’a aucun impact stock.</DialogDescription></DialogHeader>
      <div className="space-y-2"><Label htmlFor="inventory-count-cancel-reason">Justification</Label><Textarea id="inventory-count-cancel-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Expliquez l’annulation…" /></div>
      <DialogFooter><Button variant="danger" disabled={reason.trim().length < 3 || mutation.isPending} onClick={() => mutation.mutate({ data: { id: countId, reason: reason.trim() } })} loading={mutation.isPending}>Confirmer l’annulation</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
