import { useEffect, useMemo, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, Car, ClipboardList, Plus, Search, Wrench } from "lucide-react";
import { z } from "zod";

import { MotorcycleMaintenanceForm } from "@/components/motorcycles/motorcycle-maintenance-form";
import { VehicleMaintenanceForm } from "@/components/vehicles/vehicle-maintenance-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { ModuleHero } from "@/components/ui/module-hero";
import { getAllMotorcycleMaintenances, type MotorcycleMaintenance } from "@/lib/motorcycle-maintenances.functions";
import { getMotorcycles, type Motorcycle } from "@/lib/motorcycles.functions";
import {
  getAllVehicleMaintenances,
  getVehicles,
  type Vehicle,
  type VehicleMaintenance,
} from "@/lib/vehicles.functions";

export const Route = createFileRoute("/_authenticated/maintenance")({
  validateSearch: z.object({ create: z.enum(["motorcycle", "vehicle"]).optional() }),
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
  const { create } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assetType, setAssetType] = useState<AssetType>("motorcycle");
  const [assetId, setAssetId] = useState("");
  const [filter, setFilter] = useState<"all" | AssetType>("all");
  const [search, setSearch] = useState("");

  const { data: motorcycles = [] } = useQuery({ queryKey: ["motorcycles"], queryFn: () => getMotorcycles() });
  const { data: vehicles = [] } = useQuery({ queryKey: ["vehicles"], queryFn: () => getVehicles() });
  const { data: motorcycleMaintenances = [] } = useQuery({
    queryKey: ["motorcycle-maintenances", "all"],
    queryFn: () => getAllMotorcycleMaintenances(),
  });
  const { data: vehicleMaintenances = [] } = useQuery({
    queryKey: ["vehicle-maintenances", "all"],
    queryFn: () => getAllVehicleMaintenances(),
  });

  useEffect(() => {
    if (create) {
      setAssetType(create);
      setAssetId("");
      setDialogOpen(true);
    }
  }, [create]);

  const clearQuickCreate = () => {
    if (create) void navigate({ search: {}, replace: true });
  };

  const rows = useMemo<MaintenanceRow[]>(() => {
    const motorcycleRows = motorcycleMaintenances.map((maintenance: MotorcycleMaintenance) => {
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
    const vehicleRows = vehicleMaintenances.map((maintenance: VehicleMaintenance) => {
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
    return [...motorcycleRows, ...vehicleRows].sort((left, right) => right.date.localeCompare(left.date));
  }, [motorcycleMaintenances, motorcycles, vehicleMaintenances, vehicles]);

  const filteredRows = rows.filter((row) => {
    const matchesType = filter === "all" || row.assetType === filter;
    const term = search.trim().toLowerCase();
    return matchesType && (!term || `${row.assetLabel} ${row.type ?? ""} ${row.provider ?? ""}`.toLowerCase().includes(term));
  });
  const totalCost = rows.reduce((sum, row) => sum + Number(row.cost ?? 0), 0);

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
    clearQuickCreate();
  }

  const selectedMotorcycle: Motorcycle | undefined = motorcycles.find((item) => item.id === assetId);
  const selectedVehicle: Vehicle | undefined = vehicles.find((item) => item.id === assetId);

  return (
    <div className="space-y-7">
      <ModuleHero
        icon={Wrench}
        eyebrow="Mobilité"
        title="Entretiens des actifs"
        description="Retrouvez les entretiens véhicules et motos dans un seul registre, avec les actions de création déjà disponibles."
        actions={
          <>
            <Button variant="outline" onClick={() => openCreate("motorcycle")}>
              <Bike className="h-4 w-4" />
              Entretien moto
            </Button>
            <Button onClick={() => openCreate("vehicle")}>
              <Plus className="h-4 w-4" />
              Entretien véhicule
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Entretiens" value={rows.length} description="Historique consolidé" icon={ClipboardList} />
        <MetricCard label="Motos" value={motorcycleMaintenances.length} description="Interventions deux-roues" icon={Bike} tone="info" />
        <MetricCard label="Véhicules" value={vehicleMaintenances.length} description="Interventions de flotte" icon={Car} tone="primary" />
        <MetricCard
          label="Coût total"
          value={`${totalCost.toLocaleString("fr-FR")} FCFA`}
          description="Somme des coûts enregistrés"
          icon={Wrench}
          tone="warning"
        />
      </div>

      <Card variant="section" className="overflow-hidden">
        <CardHeader className="gap-4 border-b border-border/70 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Registre d’entretien</p>
            <CardTitle className="mt-1 text-xl">Historique des interventions</CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>Tous</Button>
            <Button size="sm" variant={filter === "motorcycle" ? "default" : "outline"} onClick={() => setFilter("motorcycle")}>Motos</Button>
            <Button size="sm" variant={filter === "vehicle" ? "default" : "outline"} onClick={() => setFilter("vehicle")}>Véhicules</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher un actif ou un entretien…"
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-border/75">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/45 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3 font-semibold">Actif</th>
                  <th className="p-3 font-semibold">Type</th>
                  <th className="p-3 font-semibold">Date</th>
                  <th className="p-3 font-semibold">Km</th>
                  <th className="p-3 font-semibold">Prestataire</th>
                  <th className="p-3 text-right font-semibold">Coût</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={`${row.assetType}-${row.id}`} className="border-t border-border/70 transition-colors hover:bg-surface-hover">
                    <td className="p-3 font-medium">
                      <span className="mr-2 inline-flex align-middle text-primary">
                        {row.assetType === "motorcycle" ? <Bike className="h-4 w-4" /> : <Car className="h-4 w-4" />}
                      </span>
                      {row.assetLabel}
                    </td>
                    <td className="p-3 text-muted-foreground">{row.type || "-"}</td>
                    <td className="p-3">{new Intl.DateTimeFormat("fr-FR").format(new Date(`${row.date}T00:00:00`))}</td>
                    <td className="p-3">{row.kilometrage?.toLocaleString("fr-FR") ?? "-"}</td>
                    <td className="p-3 text-muted-foreground">{row.provider || "-"}</td>
                    <td className="p-3 text-right font-semibold">{Number(row.cost ?? 0).toLocaleString("fr-FR")} FCFA</td>
                  </tr>
                ))}
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-10 text-center text-muted-foreground">Aucun entretien trouvé.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          setDialogOpen(nextOpen);
          if (!nextOpen) clearQuickCreate();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouvel entretien {assetType === "motorcycle" ? "moto" : "véhicule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">{assetType === "motorcycle" ? "Moto" : "Véhicule"}</label>
              <select
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
              >
                <option value="">Sélectionner…</option>
                {assetType === "motorcycle"
                  ? motorcycles.map((item) => <option key={item.id} value={item.id}>{item.immatriculation} — {item.marque} {item.modele}</option>)
                  : vehicles.map((item) => <option key={item.id} value={item.id}>{item.registration} — {item.brand} {item.model}</option>)}
              </select>
            </div>
            {assetType === "motorcycle" && selectedMotorcycle ? (
              <MotorcycleMaintenanceForm motorcycleId={selectedMotorcycle.id} onSuccess={refresh} onCancel={() => setDialogOpen(false)} />
            ) : null}
            {assetType === "vehicle" && selectedVehicle ? (
              <VehicleMaintenanceForm vehicleId={selectedVehicle.id} onSuccess={refresh} onCancel={() => setDialogOpen(false)} />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
