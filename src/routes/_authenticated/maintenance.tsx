import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, Car, Plus, Search, Wrench } from "lucide-react";

import { MotorcycleMaintenanceForm } from "@/components/motorcycles/motorcycle-maintenance-form";
import { VehicleMaintenanceForm } from "@/components/vehicles/vehicle-maintenance-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  getAllMotorcycleMaintenances,
  type MotorcycleMaintenance,
} from "@/lib/motorcycle-maintenances.functions";
import { getMotorcycles, type Motorcycle } from "@/lib/motorcycles.functions";
import {
  getAllVehicleMaintenances,
  getVehicles,
  type Vehicle,
  type VehicleMaintenance,
} from "@/lib/vehicles.functions";

export const Route = createFileRoute("/_authenticated/maintenance")({
  component: MaintenancePage,
});

type AssetType = "motorcycle" | "vehicle";
type MaintenanceRow = {
  id: string;
  assetType: AssetType;
  assetId: string;
  assetLabel: string;
  type: string | null;
  date: string;
  kilometrage: number | null;
  cost: number | null;
  provider: string | null;
};

function MaintenancePage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assetType, setAssetType] = useState<AssetType>("motorcycle");
  const [assetId, setAssetId] = useState("");
  const [filter, setFilter] = useState<"all" | AssetType>("all");
  const [search, setSearch] = useState("");

  const { data: motorcycles = [] } = useQuery({
    queryKey: ["motorcycles"],
    queryFn: () => getMotorcycles(),
  });
  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => getVehicles(),
  });
  const { data: motorcycleMaintenances = [] } = useQuery({
    queryKey: ["motorcycle-maintenances", "all"],
    queryFn: () => getAllMotorcycleMaintenances(),
  });
  const { data: vehicleMaintenances = [] } = useQuery({
    queryKey: ["vehicle-maintenances", "all"],
    queryFn: () => getAllVehicleMaintenances(),
  });

  const rows = useMemo<MaintenanceRow[]>(() => {
    const motorcycleRows = motorcycleMaintenances.map((maintenance) => {
      const motorcycle = motorcycles.find((item) => item.id === maintenance.motorcycle_id);
      return {
        id: maintenance.id,
        assetType: "motorcycle" as const,
        assetId: maintenance.motorcycle_id,
        assetLabel: motorcycle
          ? `${motorcycle.immatriculation} — ${motorcycle.marque ?? ""} ${motorcycle.modele ?? ""}`.trim()
          : "Moto supprimée",
        type: maintenance.type,
        date: maintenance.maintenance_date,
        kilometrage: maintenance.kilometrage,
        cost: maintenance.cost,
        provider: maintenance.garage,
      };
    });
    const vehicleRows = vehicleMaintenances.map((maintenance) => {
      const vehicle = vehicles.find((item) => item.id === maintenance.entity_id);
      return {
        id: maintenance.id,
        assetType: "vehicle" as const,
        assetId: maintenance.entity_id,
        assetLabel: vehicle
          ? `${vehicle.registration} — ${vehicle.brand ?? ""} ${vehicle.model ?? ""}`.trim()
          : "Véhicule supprimé",
        type: maintenance.type,
        date: maintenance.date,
        kilometrage: maintenance.kilometrage,
        cost: maintenance.cout,
        provider: maintenance.prestataire,
      };
    });
    return [...motorcycleRows, ...vehicleRows].sort((a, b) => b.date.localeCompare(a.date));
  }, [motorcycleMaintenances, motorcycles, vehicleMaintenances, vehicles]);

  const filteredRows = rows.filter((row) => {
    const matchesType = filter === "all" || row.assetType === filter;
    const term = search.trim().toLowerCase();
    return (
      matchesType &&
      (!term ||
        `${row.assetLabel} ${row.type ?? ""} ${row.provider ?? ""}`.toLowerCase().includes(term))
    );
  });
  const totalCost = rows.reduce((sum, row) => sum + Number(row.cost ?? 0), 0);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const dueRows = rows.filter((row) => row.date.startsWith(currentMonth)).length;

  function openCreate(type: AssetType) {
    setAssetType(type);
    setAssetId("");
    setDialogOpen(true);
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["motorcycle-maintenances"] }),
      queryClient.invalidateQueries({ queryKey: ["vehicle-maintenances"] }),
    ]);
    setDialogOpen(false);
  }

  const selectedMotorcycle = motorcycles.find((item) => item.id === assetId) as
    Motorcycle | undefined;
  const selectedVehicle = vehicles.find((item) => item.id === assetId) as Vehicle | undefined;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Wrench className="h-7 w-7" />
            Entretiens
          </h1>
          <p className="text-muted-foreground">
            Prendre soin du matériel, c’est protéger la route du succès.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openCreate("motorcycle")}>
            <Bike className="mr-2 h-4 w-4" />
            Entretien moto
          </Button>
          <Button onClick={() => openCreate("vehicle")}>
            <Plus className="mr-2 h-4 w-4" />
            Entretien véhicule
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="Total" value={rows.length} />
        <StatCard title="Motos" value={motorcycleMaintenances.length} />
        <StatCard title="Véhicules" value={vehicleMaintenances.length} />
        <StatCard title="Coût total" value={`${totalCost.toLocaleString("fr-FR")} FCFA`} />
      </div>

      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
          <CardTitle>Historique des entretiens</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={filter === "all" ? "default" : "outline"}
              onClick={() => setFilter("all")}
            >
              Tous
            </Button>
            <Button
              size="sm"
              variant={filter === "motorcycle" ? "default" : "outline"}
              onClick={() => setFilter("motorcycle")}
            >
              Motos
            </Button>
            <Button
              size="sm"
              variant={filter === "vehicle" ? "default" : "outline"}
              onClick={() => setFilter("vehicle")}
            >
              Véhicules
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher un actif ou un entretien…"
            />
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-3">Actif</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Km</th>
                  <th className="p-3">Prestataire</th>
                  <th className="p-3 text-right">Coût</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={`${row.assetType}-${row.id}`} className="border-t">
                    <td className="p-3">
                      <span className="mr-2 inline-flex align-middle">
                        {row.assetType === "motorcycle" ? (
                          <Bike className="h-4 w-4" />
                        ) : (
                          <Car className="h-4 w-4" />
                        )}
                      </span>
                      {row.assetLabel}
                    </td>
                    <td className="p-3">{row.type || "-"}</td>
                    <td className="p-3">
                      {new Intl.DateTimeFormat("fr-FR").format(new Date(`${row.date}T00:00:00`))}
                    </td>
                    <td className="p-3">{row.kilometrage?.toLocaleString("fr-FR") ?? "-"}</td>
                    <td className="p-3">{row.provider || "-"}</td>
                    <td className="p-3 text-right font-medium">
                      {Number(row.cost ?? 0).toLocaleString("fr-FR")} FCFA
                    </td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      Aucun entretien trouvé.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Nouvel entretien {assetType === "motorcycle" ? "moto" : "véhicule"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                {assetType === "motorcycle" ? "Moto" : "Véhicule"}
              </label>
              <select
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
              >
                <option value="">Sélectionner…</option>
                {assetType === "motorcycle"
                  ? motorcycles.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.immatriculation} — {item.marque} {item.modele}
                      </option>
                    ))
                  : vehicles.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.registration} — {item.brand} {item.model}
                      </option>
                    ))}
              </select>
            </div>
            {assetType === "motorcycle" && selectedMotorcycle && (
              <MotorcycleMaintenanceForm
                motorcycleId={selectedMotorcycle.id}
                onSuccess={refresh}
                onCancel={() => setDialogOpen(false)}
              />
            )}
            {assetType === "vehicle" && selectedVehicle && (
              <VehicleMaintenanceForm
                vehicleId={selectedVehicle.id}
                onSuccess={refresh}
                onCancel={() => setDialogOpen(false)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
