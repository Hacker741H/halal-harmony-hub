import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Calendar, Car, Gauge, MoreHorizontal, Search } from "lucide-react";

import {
  VEHICLE_STATUS_LABELS,
  type Vehicle,
  type VehicleStatus,
} from "@/lib/vehicles.functions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Props = {
  vehicles: Vehicle[];
  loading: boolean;
  error?: boolean;
  onEdit?: (vehicle: Vehicle) => void;
  onDelete?: (vehicle: Vehicle) => void;
};

function getStatusLabel(status: string | null) {
  return status && status in VEHICLE_STATUS_LABELS
    ? VEHICLE_STATUS_LABELS[status as VehicleStatus]
    : status || "Non renseigné";
}

function getBadgeVariant(status: string | null) {
  switch (status) {
    case "EN_SERVICE":
      return "default" as const;
    case "EN_REPARATION":
    case "EN_PANNE":
      return "destructive" as const;
    case "HORS_SERVICE":
    case "VENDU":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export function VehicleTable({ vehicles, loading, error, onEdit, onDelete }: Props) {
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  const filteredVehicles = useMemo(() => {
    if (!search.trim()) return vehicles;

    const value = search.toLowerCase();
    return vehicles.filter((vehicle) =>
      [vehicle.registration, vehicle.brand, vehicle.model, vehicle.type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(value),
    );
  }, [search, vehicles]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher un véhicule…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="pl-9"
        />
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Véhicule</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Année</TableHead>
              <TableHead>Km</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 4 }, (_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}

            {!loading && error && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <p className="font-medium text-destructive">Impossible de charger les véhicules.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
                </TableCell>
              </TableRow>
            )}

            {!loading && !error && filteredVehicles.map((vehicle) => (
              <TableRow
                key={vehicle.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => navigate({
                  to: "/vehicles/$vehicleId",
                  params: { vehicleId: vehicle.id },
                })}
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback>
                        {(vehicle.brand ?? "V").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        <Car className="h-4 w-4" />
                        {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "Véhicule"}
                      </div>
                      <div className="text-xs text-muted-foreground">{vehicle.registration}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>{vehicle.type || "-"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {vehicle.year ?? "-"}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Gauge className="h-4 w-4" />
                    {vehicle.kilometrage === null ? "-" : `${formatNumber(vehicle.kilometrage)} km`}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={getBadgeVariant(vehicle.status)}>
                    {getStatusLabel(vehicle.status)}
                  </Badge>
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions pour ${vehicle.registration}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link
                          to="/vehicles/$vehicleId"
                          params={{ vehicleId: vehicle.id }}
                        >
                          Voir la fiche
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit?.(vehicle)}>
                        Modifier
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => onDelete?.(vehicle)}>
                        Supprimer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}

            {!loading && !error && filteredVehicles.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {search.trim() ? "Aucun véhicule ne correspond à la recherche." : "Aucun véhicule trouvé."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
