import { useMemo, useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import type { Harvest } from "@/lib/harvests.functions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";

type Props = {
  harvests: Harvest[];
  loading: boolean;
  onEdit: (harvest: Harvest) => void;
  onDelete: (harvest: Harvest) => void;
};

export function HarvestTable({
  harvests,
  loading,
  onEdit,
  onDelete,
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const value = search.toLowerCase();

    return harvests.filter((harvest) =>
      [
        harvest.produit,
        harvest.acheteur,
        harvest.date_recolte,
      ]
        .join(" ")
        .toLowerCase()
        .includes(value)
    );
  }, [harvests, search]);

  return (
    <div className="space-y-4">

      <Input
        placeholder="Rechercher une récolte..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="rounded-lg border">

        <Table>

          <TableHeader>

            <TableRow>

              <TableHead>Date</TableHead>

              <TableHead>Produit</TableHead>

              <TableHead>Quantité</TableHead>

              <TableHead>Prix/kg</TableHead>

              <TableHead>Montant</TableHead>

              <TableHead>Acheteur</TableHead>

              <TableHead className="w-[70px]" />

            </TableRow>

          </TableHeader>

          <TableBody>

            {loading ? (

              <TableRow>

                <TableCell colSpan={7}>
                  Chargement...
                </TableCell>

              </TableRow>

            ) : filtered.length === 0 ? (

              <TableRow>

                <TableCell colSpan={7}>
                  Aucune récolte.
                </TableCell>

              </TableRow>

            ) : (

              filtered.map((harvest) => (

                <TableRow key={harvest.id}>

                  <TableCell>
                    {harvest.date_recolte}
                  </TableCell>

                  <TableCell>
                    <Badge variant="secondary">
                      {harvest.produit}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    {Number(harvest.quantite_kg).toLocaleString()} kg
                  </TableCell>

                  <TableCell>
                    {Number(harvest.prix_kg).toLocaleString()} FCFA
                  </TableCell>

                  <TableCell className="font-semibold">
                    {Number(harvest.montant_total).toLocaleString()} FCFA
                  </TableCell>

                  <TableCell>
                    {harvest.acheteur ?? "-"}
                  </TableCell>

                  <TableCell>

                    <DropdownMenu>

                      <DropdownMenuTrigger asChild>

                        <Button
                          size="icon"
                          variant="ghost"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>

                      </DropdownMenuTrigger>

                      <DropdownMenuContent align="end">

                        <DropdownMenuItem
                          onClick={() => onEdit(harvest)}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Modifier
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => onDelete(harvest)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Supprimer
                        </DropdownMenuItem>

                      </DropdownMenuContent>

                    </DropdownMenu>

                  </TableCell>

                </TableRow>

              ))

            )}

          </TableBody>

        </Table>

      </div>

    </div>
  );
}