import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  MoreHorizontal,
  Search,
  Phone,
  CreditCard,
  Calendar,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import type { DriverWithEmployee } from "@/lib/drivers.functions";

type Props = {
  drivers: DriverWithEmployee[];
  loading: boolean;
  onEdit?: (driver: DriverWithEmployee) => void;
  onDelete?: (driver: DriverWithEmployee) => void;
};

export function DriverTable({
  drivers,
  loading,
  onEdit,
  onDelete,
}: Props) {
  const [search, setSearch] = useState("");

  const filteredDrivers = useMemo(() => {
    if (!search.trim()) return drivers;

    const value = search.toLowerCase();

    return drivers.filter((driver) =>
      [
        driver.employees?.nom,
        driver.employees?.prenom,
        driver.employees?.telephone,
        driver.numero_permis,
        driver.categorie_permis,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(value)
    );
  }, [drivers, search]);

  function badgeVariant(statut: string) {
    switch (statut) {
      case "actif":
        return "default";

      case "inactif":
        return "secondary";

      default:
        return "outline";
    }
  }

  return (
    <div className="space-y-4">

      <div className="relative max-w-sm">

        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />

        <Input
          placeholder="Rechercher un chauffeur..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

      </div>

      <div className="rounded-xl border overflow-hidden">

        <Table>

          <TableHeader>

            <TableRow>

              <TableHead>Nom</TableHead>

              <TableHead>Téléphone</TableHead>

              <TableHead>Permis</TableHead>

              <TableHead>Catégorie</TableHead>

              <TableHead>Expiration</TableHead>

              <TableHead>Statut</TableHead>

              <TableHead className="w-[70px]" />

            </TableRow>

          </TableHeader>

          <TableBody>

            {loading && (
              <TableRow>

                <TableCell
                  colSpan={7}
                  className="text-center py-10"
                >
                  Chargement...
                </TableCell>

              </TableRow>
            )}            {!loading &&
              filteredDrivers.map((driver) => (

                <TableRow key={driver.id}>

                  <TableCell>
                    <Link className="font-medium hover:underline" to="/drivers/$driverId" params={{ driverId: driver.id }}>
                      {driver.employees?.nom} {driver.employees?.prenom}
                    </Link>
                  </TableCell>

                  <TableCell>

                    <div className="flex items-center gap-2">

                      <Phone className="h-4 w-4 text-muted-foreground" />

                      {driver.employees?.telephone || "-"}

                    </div>

                  </TableCell>

                  <TableCell>

                    <div className="flex items-center gap-2">

                      <CreditCard className="h-4 w-4 text-muted-foreground" />

                      {driver.numero_permis || "-"}

                    </div>

                  </TableCell>

                  <TableCell>
                    {driver.categorie_permis || "-"}
                  </TableCell>

                  <TableCell>

                    <div className="flex items-center gap-2">

                      <Calendar className="h-4 w-4 text-muted-foreground" />

                      {driver.date_expiration_permis || "-"}

                    </div>

                  </TableCell>

                  <TableCell>

                    <Badge
                      variant={badgeVariant(driver.statut)}
                    >
                      {driver.statut}
                    </Badge>

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

                        <DropdownMenuItem asChild>
                          <Link to="/drivers/$driverId" params={{ driverId: driver.id }}>Voir la fiche</Link>
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          onClick={() => onEdit?.(driver)}
                        >
                          Modifier
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => onDelete?.(driver)}
                        >
                          Supprimer
                        </DropdownMenuItem>

                      </DropdownMenuContent>

                    </DropdownMenu>

                  </TableCell>

                </TableRow>

              ))}

            {!loading &&
              filteredDrivers.length === 0 && (

                <TableRow>

                  <TableCell
                    colSpan={7}
                    className="text-center py-12 text-muted-foreground"
                  >
                    Aucun chauffeur trouvé.
                  </TableCell>

                </TableRow>

              )}

          </TableBody>

        </Table>

      </div>

    </div>
  );
}
