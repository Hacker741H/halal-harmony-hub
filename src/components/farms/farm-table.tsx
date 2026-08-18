import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Farm } from "@/lib/farms.functions";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  farms: Farm[];
  loading: boolean;
  error?: boolean;
  onEdit: (farm: Farm) => void;
  onDelete: (farm: Farm) => void;
};

export function FarmTable({
  farms,
  loading,
  error,
  onEdit,
  onDelete,
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const value = search.toLowerCase();

    return farms.filter((farm) =>
      [
        farm.code,
        farm.nom,
        farm.localisation,
        farm.village,
        farm.type_culture,
      ]
        .join(" ")
        .toLowerCase()
        .includes(value)
    );
  }, [farms, search]);

  return (
    <div className="space-y-4">

      <Input
        placeholder="Rechercher une exploitation..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="rounded-xl border">

        <Table>

          <TableHeader>

            <TableRow>

              <TableHead>Code</TableHead>

              <TableHead>Nom</TableHead>

              <TableHead>Village</TableHead>

              <TableHead>Culture</TableHead>

              <TableHead>Superficie</TableHead>

              <TableHead>Prix/kg</TableHead>

              <TableHead>Statut</TableHead>

              <TableHead className="w-[70px]" />

            </TableRow>

          </TableHeader>

          <TableBody>

            {loading ? (

              Array.from({ length: 4 }, (_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))

            ) : error ? (

              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center">
                  <p className="font-medium text-destructive">Impossible de charger les exploitations.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
                </TableCell>
              </TableRow>

            ) : filtered.length === 0 ? (

              <TableRow>

                <TableCell colSpan={8}>
                  {search.trim() ? "Aucune exploitation ne correspond à la recherche." : "Aucune exploitation trouvée."}
                </TableCell>

              </TableRow>

            ) : (

              filtered.map((farm) => (

                <TableRow key={farm.id}>

                  <TableCell className="font-medium">
                    {farm.code}
                  </TableCell>

                 <TableCell>

  <Link
    to="/farms/$farmId"
    params={{ farmId: farm.id }}
    className="font-medium text-green-700 hover:underline"
  >
    {farm.nom}
  </Link>
</TableCell>


                  <TableCell>{farm.village}</TableCell>

                  <TableCell>{farm.type_culture}</TableCell>

                  <TableCell>
                    {farm.superficie ?? 0} ha
                  </TableCell>

                  <TableCell>
                    {farm.prix_kg ?? 0} FCFA
                  </TableCell>

                  <TableCell>

                    <Badge>

                      {farm.statut ?? "Actif"}

                    </Badge>

                  </TableCell>

                  <TableCell>

                    <DropdownMenu>

                      <DropdownMenuTrigger asChild>

                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions de ${farm.nom}`}
                        >

                          <MoreHorizontal className="h-4 w-4" />

                        </Button>

                      </DropdownMenuTrigger>

                      <DropdownMenuContent align="end">

                        <DropdownMenuItem
                          onClick={() => onEdit(farm)}
                        >

                          <Pencil className="mr-2 h-4 w-4" />

                          Modifier

                        </DropdownMenuItem>

                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => onDelete(farm)}
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