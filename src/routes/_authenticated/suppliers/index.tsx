import { useState } from "react";

import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Contact, Plus, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { SupplierForm } from "@/components/suppliers/supplier-form";
import { SupplierTable } from "@/components/suppliers/supplier-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/hooks/use-confirm";
import { usePermissions } from "@/hooks/use-permissions";
import { archiveSupplier, getSuppliers, restoreSupplier, type Supplier } from "@/lib/suppliers.functions";

export const Route = createFileRoute("/_authenticated/suppliers/")({
  component: SuppliersPage,
});

function SuppliersPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"ALL" | "ACTIVE" | "ARCHIVED">("ACTIVE");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const { confirm, dialog } = useConfirm();
  const pageSize = 20;

  const suppliersQuery = useQuery({
    queryKey: ["suppliers", { page, search, status }],
    queryFn: () => getSuppliers({ data: { page, pageSize, search, status: status === "ALL" ? null : status } }),
  });
  const archiveMutation = useMutation({
    mutationFn: archiveSupplier,
    onSuccess: () => {
      toast.success("Fournisseur archivé.");
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Impossible d’archiver ce fournisseur."),
  });
  const restoreMutation = useMutation({
    mutationFn: restoreSupplier,
    onSuccess: () => {
      toast.success("Fournisseur restauré.");
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Impossible de restaurer ce fournisseur."),
  });

  const total = suppliersQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const suppliers = suppliersQuery.data?.suppliers ?? [];

  function refresh() {
    setDialogOpen(false);
    setEditingSupplier(null);
    void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
  }

  return (
    <div className="space-y-7">
      <OperationalHero
        variant="deep"
        icon={Contact}
        eyebrow="Commerce"
        title="Fournisseurs"
        description="Un référentiel fournisseur unique pour tracer les achats, réceptions et dettes sans dupliquer les coordonnées."
        primaryStat={{ label: "Fournisseurs", value: total }}
        actions={
          <>
            {can("purchases.read") ? (
              <Button asChild variant="outline">
                <Link to="/purchases">
                  <ShoppingCart className="h-4 w-4" />
                  Tous les achats
                </Link>
              </Button>
            ) : null}
            {can("suppliers.create") ? (
              <Button onClick={() => { setEditingSupplier(null); setDialogOpen(true); }}>
                <Plus className="h-4 w-4" />
                Nouveau fournisseur
              </Button>
            ) : null}
          </>
        }
      />

      <Card variant="section" className="overflow-hidden">
        <CardHeader className="border-b border-border/70">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Répertoire fournisseurs</p>
              <CardTitle className="mt-1 text-xl">Relations fournisseurs</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">{total} résultat{total > 1 ? "s" : ""} selon les filtres actifs</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
            <Input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Rechercher par nom, société, téléphone ou e-mail…"
              aria-label="Rechercher un fournisseur"
            />
            <Select value={status} onValueChange={(value) => { setStatus(value === "ACTIVE" || value === "ARCHIVED" ? value : "ALL"); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Actifs</SelectItem>
                <SelectItem value="ARCHIVED">Archivés</SelectItem>
                <SelectItem value="ALL">Tous les statuts</SelectItem>
              </SelectContent>
            </Select>
            <p className="self-center text-sm text-muted-foreground">Page {page} / {totalPages}</p>
          </div>

          <SupplierTable
            suppliers={suppliers}
            loading={suppliersQuery.isPending}
            error={suppliersQuery.isError}
            canUpdate={can("suppliers.update")}
            canArchive={can("suppliers.archive")}
            onEdit={(supplier) => { setEditingSupplier(supplier); setDialogOpen(true); }}
            onArchive={(supplier) => {
              confirm({
                title: "Archiver ce fournisseur",
                description: `Archiver ${supplier.display_name} ?`,
                variant: "destructive",
                confirmLabel: "Archiver",
                onConfirm: async () => { await archiveMutation.mutateAsync({ data: { id: supplier.id } }); },
              });
            }}
            onRestore={(supplier) => restoreMutation.mutate({ data: { id: supplier.id } })}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
            <p className="text-sm text-muted-foreground">Pagination du référentiel</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Précédent</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Suivant</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(nextOpen) => { setDialogOpen(nextOpen); if (!nextOpen) setEditingSupplier(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editingSupplier ? "Modifier le fournisseur" : "Nouveau fournisseur"}</DialogTitle></DialogHeader>
          <SupplierForm supplier={editingSupplier} onSuccess={refresh} />
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}
