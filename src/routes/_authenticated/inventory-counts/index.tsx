import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, ClipboardList, ClipboardX, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/hooks/use-permissions";
import { getCommercePosLocations } from "@/lib/commerce-pos.functions";
import { INVENTORY_COUNT_STATUSES, getInventoryCounts, openInventoryCount } from "@/lib/inventory-counts.functions";

export const Route = createFileRoute("/_authenticated/inventory-counts/")({ component: InventoryCountsPage });

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

function showError(fallback: string) {
  return (error: Error) => toast.error(error instanceof Error ? error.message : fallback);
}

function InventoryCountsPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const pageSize = 20;

  const countsQuery = useQuery({
    queryKey: ["inventory-counts", { page, status }],
    queryFn: () => getInventoryCounts({ data: {
      page, pageSize,
      status: status === "ALL" ? null : status as (typeof INVENTORY_COUNT_STATUSES)[number],
      businessLocationId: null,
    } }),
  });

  const counts = countsQuery.data?.counts ?? [];
  const total = countsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const overview = {
    open: counts.filter((count) => count.status === "OPEN").length,
    completed: counts.filter((count) => count.status === "COMPLETED").length,
    cancelled: counts.filter((count) => count.status === "CANCELLED").length,
  };

  return <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
    <OperationalHero
      icon={ClipboardList}
      eyebrow="Commerce"
      title="Inventaires physiques"
      description="Comptez le stock réel d’un magasin puis validez : chaque écart ajuste le stock au coût moyen courant, sans jamais créer d’écriture financière."
      primaryStat={{ label: "Inventaires", value: total }}
      secondaryStats={[{ label: "Ouverts", value: overview.open }]}
      actions={can("inventory.counts.create") ? <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" />Nouvel inventaire</Button> : undefined}
    />
    <div className="grid gap-3 sm:grid-cols-3">
      <MetricCard icon={ClipboardList} label="Ouverts" value={countsQuery.isPending ? "…" : overview.open} description="Sur la page affichée" tone="info" />
      <MetricCard icon={ClipboardCheck} label="Validés" value={countsQuery.isPending ? "…" : overview.completed} description="Sur la page affichée" tone="success" />
      <MetricCard icon={ClipboardX} label="Annulés" value={countsQuery.isPending ? "…" : overview.cancelled} description="Sur la page affichée" tone="danger" />
    </div>

    <Card variant="section">
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-3 md:grid-cols-[220px_auto]">
          <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
            <SelectTrigger aria-label="Filtrer par statut"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les statuts</SelectItem>
              {INVENTORY_COUNT_STATUSES.map((value) => <SelectItem key={value} value={value}>{statusLabel(value)}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="self-center text-sm text-muted-foreground">Page {page} / {totalPages}</p>
        </div>

        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead>Inventaire</TableHead><TableHead>Magasin</TableHead><TableHead>Ouvert le</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {countsQuery.isPending ? Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index}><TableCell colSpan={4}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              )) : null}
              {countsQuery.isError ? <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-destructive">Impossible de charger les inventaires. Réessayez dans un instant.</TableCell></TableRow> : null}
              {!countsQuery.isPending && !countsQuery.isError && counts.length === 0 ? <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">Aucun inventaire ne correspond aux critères actuels.</TableCell></TableRow> : null}
              {counts.map((count) => (
                <TableRow key={count.id}>
                  <TableCell><Link to="/inventory-counts/$countId" params={{ countId: count.id }} className="font-medium hover:underline">{count.count_number}</Link></TableCell>
                  <TableCell>{count.locationName ?? "—"}</TableCell>
                  <TableCell>{formatDateTime(count.opened_at)}</TableCell>
                  <TableCell><Badge variant={statusVariant(count.status)}>{statusLabel(count.status)}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
          <p className="text-sm text-muted-foreground">Pagination des inventaires</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Précédent</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Suivant</Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <CreateInventoryCountDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(countId) => void navigate({ to: "/inventory-counts/$countId", params: { countId } })} />
  </div>;
}

function CreateInventoryCountDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (countId: string) => void }) {
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const queryClient = useQueryClient();
  const locationsQuery = useQuery({ queryKey: ["commerce-pos-locations"], queryFn: () => getCommercePosLocations() });

  const createMutation = useMutation({
    mutationFn: openInventoryCount,
    onSuccess: (count) => {
      toast.success("Inventaire ouvert : la quantité système de chaque article a été figée.");
      setLocationId("");
      setNotes("");
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["inventory-counts"] });
      onCreated(count.id);
    },
    onError: showError("Impossible d’ouvrir l’inventaire."),
  });

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>Nouvel inventaire physique</DialogTitle><DialogDescription>Chaque article actuellement suivi dans ce magasin sera ajouté comme ligne à compter.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="inventory-count-location">Magasin</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger id="inventory-count-location"><SelectValue placeholder="Sélectionner un magasin" /></SelectTrigger>
            <SelectContent>{(locationsQuery.data ?? []).map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2"><Label htmlFor="inventory-count-notes">Notes</Label><Textarea id="inventory-count-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Motif, période, responsable du comptage…" /></div>
      </div>
      <DialogFooter><Button disabled={!locationId || createMutation.isPending} onClick={() => createMutation.mutate({ data: { businessLocationId: locationId, notes: notes.trim() || null } })} loading={createMutation.isPending}>Ouvrir l’inventaire</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
