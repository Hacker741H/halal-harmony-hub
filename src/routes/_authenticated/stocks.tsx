import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Boxes, Hash, Package, Plus } from "lucide-react";

import { StockForm } from "@/components/stocks/stock-form";
import { StockMovementForm } from "@/components/stocks/stock-movement-form";
import { StockTable } from "@/components/stocks/stock-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MetricCard } from "@/components/ui/metric-card";
import { ModuleHero } from "@/components/ui/module-hero";
import { cancelStockMovement, getStockMovements } from "@/lib/stock-movements.functions";
import { deleteStock, getStocks, type Stock } from "@/lib/stocks.functions";

export const Route = createFileRoute("/_authenticated/stocks")({
  component: StocksPage,
});

function StocksPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingStock, setEditingStock] = useState<Stock | null>(null);
  const [movementOpen, setMovementOpen] = useState(false);

  const { data: stocks = [], isPending } = useQuery({
    queryKey: ["stocks"],
    queryFn: () => getStocks(),
  });
  const { data: movements = [] } = useQuery({
    queryKey: ["stock-movements"],
    queryFn: () => getStockMovements(),
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["stocks"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] }),
    ]);
    setEditingStock(null);
    setOpen(false);
    setMovementOpen(false);
  }

  async function cancelMovement(id: string) {
    if (!window.confirm("Annuler ce mouvement et son écriture financière éventuelle ?")) return;

    try {
      await cancelStockMovement({ data: { id } });
      await refresh();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Impossible d'annuler le mouvement.");
    }
  }

  async function handleDelete(stock: Stock) {
    if (!window.confirm(`Supprimer "${stock.nom}" ?`)) return;

    try {
      await deleteStock({ data: { id: stock.id } });
      await refresh();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : JSON.stringify(error, null, 2));
    }
  }

  function handleEdit(stock: Stock) {
    setEditingStock(stock);
    setOpen(true);
  }

  const totalItems = stocks.length;
  const totalQuantity = stocks.reduce((sum, item) => sum + (item.stock_actuel ?? 0), 0);
  const lowStock = stocks.filter(
    (item) =>
      item.seuil_alerte !== null &&
      item.seuil_alerte !== undefined &&
      item.stock_actuel <= item.seuil_alerte,
  ).length;

  return (
    <div className="space-y-7">
      <ModuleHero
        icon={Package}
        eyebrow="Agriculture & stocks"
        title="Stocks et mouvements"
        description="Suivez les articles disponibles, les seuils sensibles et les derniers mouvements sans perdre le lien avec les opérations enregistrées."
        actions={
          <>
            <Dialog
              open={open}
              onOpenChange={(value) => {
                setOpen(value);
                if (!value) setEditingStock(null);
              }}
            >
              <DialogTrigger asChild>
                <Button onClick={() => setEditingStock(null)}>
                  <Plus className="h-4 w-4" />
                  Nouvel article
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingStock ? "Modifier un article" : "Ajouter un article"}</DialogTitle>
                </DialogHeader>
                <StockForm stock={editingStock} onSuccess={refresh} />
              </DialogContent>
            </Dialog>

            <Dialog open={movementOpen} onOpenChange={setMovementOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Plus className="h-4 w-4" />
                  Nouveau mouvement
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Nouveau mouvement de stock</DialogTitle>
                </DialogHeader>
                <StockMovementForm stocks={stocks} onSuccess={refresh} />
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Articles" value={totalItems} description="Références enregistrées" icon={Boxes} />
        <MetricCard
          label="Quantité disponible"
          value={totalQuantity}
          description="Total des unités en stock"
          icon={Hash}
          tone="info"
        />
        <MetricCard
          label="Sous le seuil"
          value={lowStock}
          description="Articles à réapprovisionner"
          icon={AlertTriangle}
          tone={lowStock > 0 ? "warning" : "success"}
        />
        <MetricCard
          label="Mouvements récents"
          value={movements.length}
          description="Mouvements disponibles dans le registre"
          icon={Package}
          tone="primary"
        />
      </div>

      <Card variant="section" className="overflow-hidden">
        <CardHeader className="border-b border-border/70">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Inventaire</p>
              <CardTitle className="mt-1 text-xl">Articles suivis</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              {isPending ? "Chargement de l’inventaire…" : "Recherchez un article ou intervenez depuis sa ligne."}
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          <StockTable stocks={stocks} loading={isPending} onEdit={handleEdit} onDelete={handleDelete} />
        </CardContent>
      </Card>

      <Card variant="section" className="overflow-hidden">
        <CardHeader className="border-b border-border/70">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Traçabilité</p>
              <CardTitle className="mt-1 text-xl">Mouvements récents</CardTitle>
            </div>
            <Badge variant="neutral" appearance="soft">{movements.length} enregistré{movements.length > 1 ? "s" : ""}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-5 sm:p-6">
          {movements.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
              Aucun mouvement enregistré pour le moment.
            </div>
          ) : (
            movements.slice(0, 10).map((movement) => {
              const stock = stocks.find((item) => item.id === movement.inventory_item_id);
              const isFinancial = movement.movement_type === "PURCHASE" || movement.movement_type === "SALE";
              const amount = Number(movement.quantity) * Number(movement.unit_price ?? 0);

              return (
                <div
                  key={movement.id}
                  className="flex flex-col gap-3 rounded-xl border border-border/75 bg-surface px-4 py-3 transition-ui hover:border-primary/20 hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {stock?.nom ?? "Article supprimé"} <span className="text-muted-foreground">· {movement.movement_type}</span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {movement.movement_date} · {movement.quantity} {stock?.unite ?? ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {isFinancial ? <span className="font-semibold text-foreground">{amount.toLocaleString("fr-FR")} FCFA</span> : null}
                    <Badge variant={movement.status === "VALID" ? "success" : "neutral"} appearance="soft">
                      {movement.status}
                    </Badge>
                    {movement.status === "VALID" ? (
                      <Button size="sm" variant="outline" onClick={() => cancelMovement(movement.id)}>
                        Annuler
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
