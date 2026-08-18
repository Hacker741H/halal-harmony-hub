import { useMemo, useState } from "react";
import {
  Search,
  Package,
  Hash,
  Boxes,
  MoreHorizontal,
} from "lucide-react";

import type { Stock } from "@/lib/stocks.functions";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

type Props = {
  stocks: Stock[];
  loading: boolean;
  error?: boolean;
  onEdit?: (stock: Stock) => void;
  onDelete?: (stock: Stock) => void;
};

export function StockTable({
  stocks,
  loading,
  error,
  onEdit,
  onDelete,
}: Props) {
  const [search, setSearch] = useState("");

  const filteredStocks = useMemo(() => {
    if (!search.trim()) return stocks;

    const value = search.toLowerCase();

    return stocks.filter((stock) =>
      [
        stock.nom,
        stock.categorie,
        stock.sku,
        stock.unite,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(value),
    );
  }, [stocks, search]);

  function initials(stock: Stock) {
    return (stock.nom ?? "ST")
      .substring(0, 2)
      .toUpperCase();
  }

  function badgeVariant(stock: Stock) {
    if (
      stock.seuil_alerte !== null &&
      stock.seuil_alerte !== undefined &&
      stock.stock_actuel <= stock.seuil_alerte
    ) {
      return "destructive";
    }

    return "default";
  }

  return (
    <div className="space-y-4">

      <div className="relative max-w-sm">

        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />

        <Input
          placeholder="Rechercher un article..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />

      </div>

      <div className="rounded-xl border overflow-hidden">

      <Table>
  <TableHeader>

            <TableRow>

              <TableHead>Article</TableHead>

              <TableHead>Catégorie</TableHead>

              <TableHead>SKU</TableHead>

              <TableHead>Stock</TableHead>

              <TableHead className="w-[60px]" />

            </TableRow>

          </TableHeader>

          <TableBody>

            {loading &&
              Array.from({ length: 4 }, (_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}

            {!loading && error && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center">
                  <p className="font-medium text-destructive">Impossible de charger les articles.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
                </TableCell>
              </TableRow>
            )}

            {!loading && !error &&
              filteredStocks.map((stock) => (
                <TableRow key={stock.id}>

                  <TableCell>

                    <div className="flex items-center gap-3">

                      <Avatar>

                        <AvatarFallback>
                          {initials(stock)}
                        </AvatarFallback>

                      </Avatar>

                      <div>

                        <div className="font-medium flex items-center gap-2">

                          <Package className="h-4 w-4" />

                          {stock.nom}

                        </div>

                        <div className="text-xs text-muted-foreground">

                          {stock.unite || "-"}

                        </div>

                      </div>

                    </div>

                  </TableCell>

                  <TableCell>

                    {stock.categorie || "-"}

                  </TableCell>

                  <TableCell>

                    <div className="flex items-center gap-2">

                      <Hash className="h-4 w-4" />

                      {stock.sku || "-"}

                    </div>

                  </TableCell>

                  <TableCell>

                    <div className="flex items-center gap-2">

                      <Boxes className="h-4 w-4" />

                      <span>

                        {stock.stock_actuel}

                        {stock.unite
                          ? ` ${stock.unite}`
                          : ""}

                      </span>

                      <Badge
                        variant={badgeVariant(stock)}
                      >
                        {stock.seuil_alerte !== null &&
                        stock.seuil_alerte !== undefined &&
                        stock.stock_actuel <=
                          stock.seuil_alerte
                          ? "Stock bas"
                          : "OK"}
                      </Badge>

                    </div>

                  </TableCell>                  <TableCell>

                    <DropdownMenu>

                      <DropdownMenuTrigger asChild>

                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions de ${stock.nom}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>

                      </DropdownMenuTrigger>

                      <DropdownMenuContent align="end">

                        <DropdownMenuItem
                          onClick={() => onEdit?.(stock)}
                        >
                          Modifier
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => onDelete?.(stock)}
                        >
                          Supprimer
                        </DropdownMenuItem>

                      </DropdownMenuContent>

                    </DropdownMenu>

                  </TableCell>

                </TableRow>
              ))}

            {!loading && !error &&
              filteredStocks.length === 0 && (
                <TableRow>

                  <TableCell
                    colSpan={5}
                    className="text-center py-10 text-muted-foreground"
                  >
                    {search.trim() ? "Aucun article ne correspond à la recherche." : "Aucun article trouvé."}
                  </TableCell>

                </TableRow>
              )}

          </TableBody>

        </Table>

      </div>

    </div>
  );
}