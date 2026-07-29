import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Package,
  Plus,
  Boxes,
  AlertTriangle,
  Hash,
} from "lucide-react";

import {
  getStocks,
  deleteStock,
  type Stock,
} from "@/lib/stocks.functions";
import {
  cancelStockMovement,
  getStockMovements,
} from "@/lib/stock-movements.functions";

import { StockForm } from "@/components/stocks/stock-form";
import { StockMovementForm } from "@/components/stocks/stock-movement-form";
import { StockTable } from "@/components/stocks/stock-table";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/stocks")({
  component: StocksPage,
});

function StocksPage() {
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editingStock, setEditingStock] =
    useState<Stock | null>(null);
  const [movementOpen, setMovementOpen] = useState(false);

  const {
    data: stocks = [],
    isPending,
  } = useQuery({
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
    if (!window.confirm("Annuler ce mouvement et son écriture financière éventuelle ?")) {
      return;
    }

    try {
      await cancelStockMovement({ data: { id } });
      await refresh();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Impossible d'annuler le mouvement.");
    }
  }

  async function handleDelete(stock: Stock) {
    const confirmed = window.confirm(
      `Supprimer "${stock.nom}" ?`
    );

    if (!confirmed) return;

    try {
      await deleteStock({
        data: {
          id: stock.id,
        },
      });

      await refresh();
    } catch (error) {
      console.error(error);

      alert(
        error instanceof Error
          ? error.message
          : JSON.stringify(error, null, 2)
      );
    }
  }

  function handleEdit(stock: Stock) {
    setEditingStock(stock);
    setOpen(true);
  }

  const totalItems = stocks.length;

  const totalQuantity = stocks.reduce(
    (sum, item) => sum + (item.stock_actuel ?? 0),
    0
  );

  const lowStock = stocks.filter(
    (item) =>
      item.seuil_alerte !== null &&
      item.seuil_alerte !== undefined &&
      item.stock_actuel <= item.seuil_alerte
  ).length;

  return (
    <div className="space-y-6">

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

        <div>

          <h1 className="flex items-center gap-3 text-3xl font-bold">

            <Package className="h-7 w-7" />

            Stocks

          </h1>

          <p className="text-muted-foreground">
            Gestion de votre inventaire.
          </p>

        </div>

        <Dialog
          open={open}
          onOpenChange={(value) => {
            setOpen(value);

            if (!value) {
              setEditingStock(null);
            }
          }}
        >

          <DialogTrigger asChild>

            <Button
              onClick={() => {
                setEditingStock(null);
              }}
            >

              <Plus className="mr-2 h-4 w-4" />

              Nouvel article

            </Button>

          </DialogTrigger>

          <DialogContent>

            <DialogHeader>

              <DialogTitle>

                {editingStock
                  ? "Modifier un article"
                  : "Ajouter un article"}

              </DialogTitle>

            </DialogHeader>

            <StockForm
              stock={editingStock}
              onSuccess={refresh}
            />

          </DialogContent>

        </Dialog>

        <Dialog open={movementOpen} onOpenChange={setMovementOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" />
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

      </div>

      <div className="grid gap-4 md:grid-cols-3">

        <Card>

          <CardHeader className="flex flex-row items-center justify-between pb-2">

            <CardTitle className="text-sm">
              Articles
            </CardTitle>

            <Boxes className="h-5 w-5 text-muted-foreground" />

          </CardHeader>

          <CardContent>

            <div className="text-3xl font-bold">
              {totalItems}
            </div>

            <p className="text-xs text-muted-foreground">
              Articles enregistrés
            </p>

          </CardContent>

        </Card>

        <Card>

          <CardHeader className="flex flex-row items-center justify-between pb-2">

            <CardTitle className="text-sm">
              Quantité totale
            </CardTitle>

            <Hash className="h-5 w-5 text-blue-600" />

          </CardHeader>

          <CardContent>

            <div className="text-3xl font-bold">
              {totalQuantity}
            </div>

            <p className="text-xs text-muted-foreground">
              Quantité disponible
            </p>

          </CardContent>

        </Card>

        <Card>

          <CardHeader className="flex flex-row items-center justify-between pb-2">

            <CardTitle className="text-sm">
              Stock bas
            </CardTitle>

            <AlertTriangle className="h-5 w-5 text-orange-500" />

          </CardHeader>

          <CardContent>

            <div className="text-3xl font-bold">
              {lowStock}
            </div>

            <p className="text-xs text-muted-foreground">
              Articles sous le seuil
            </p>

          </CardContent>

        </Card>

      </div>

      <StockTable
        stocks={stocks}
        loading={isPending}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <Card>
        <CardHeader>
          <CardTitle>Mouvements récents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun mouvement enregistré.</p>
          ) : movements.slice(0, 10).map((movement) => {
            const stock = stocks.find((item) => item.id === movement.inventory_item_id);
            const isFinancial = movement.movement_type === "PURCHASE" || movement.movement_type === "SALE";
            const amount = Number(movement.quantity) * Number(movement.unit_price ?? 0);

            return (
              <div key={movement.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <div>
                  <p className="font-medium">{stock?.nom ?? "Article supprimé"} · {movement.movement_type}</p>
                  <p className="text-muted-foreground">{movement.movement_date} · {movement.quantity} {stock?.unite ?? ""}</p>
                </div>
                <div className="flex items-center gap-3">
                  {isFinancial && <span className="font-medium">{amount.toLocaleString("fr-FR")} FCFA</span>}
                  <span>{movement.status}</span>
                  {movement.status === "VALID" && (
                    <Button size="sm" variant="outline" onClick={() => cancelMovement(movement.id)}>
                      Annuler
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

    </div>
  );
}
