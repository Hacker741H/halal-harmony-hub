import { useEffect, useMemo, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, CircleCheck, Gauge, Plus, Search, Truck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import VehicleForm from "@/components/vehicles/vehicle-form";
import { VehicleTable } from "@/components/vehicles/vehicle-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/hooks/use-confirm";
import { formatNumber } from "@/lib/format";
import {
  deleteVehicle,
  getVehicles,
  VEHICLE_STATUS_LABELS,
  VEHICLE_STATUSES,
  type Vehicle,
  type VehicleStatus,
} from "@/lib/vehicles.functions";
import { notifyMutationError } from "@/lib/notify-mutation-error";

export const Route = createFileRoute("/_authenticated/vehicles/")({
  validateSearch: z.object({ create: z.literal("true").optional() }),
  component: VehiclesPage,
});

function VehiclesPage() {
  const { create } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | VehicleStatus>("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const { confirm, dialog } = useConfirm();

  const { data: vehicles = [], isPending, isError } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => getVehicles(),
  });

  useEffect(() => {
    if (create === "true") {
      setEditingVehicle(null);
      setOpen(true);
    }
  }, [create]);

  const clearQuickCreate = () => {
    if (create === "true") void navigate({ search: {}, replace: true });
  };

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    setEditingVehicle(null);
    setOpen(false);
    clearQuickCreate();
  }

  function handleDelete(vehicle: Vehicle) {
    confirm({
      title: "Supprimer ce véhicule",
      description: `Supprimer le véhicule "${vehicle.registration}" ? Cette action est irréversible.`,
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteVehicle({ data: { id: vehicle.id } });
          await refresh();
          toast.success("Véhicule supprimé.");
        } catch (error: unknown) {
          console.error(error);
          notifyMutationError(error, "Impossible de supprimer le véhicule.");
          throw error;
        }
      },
    });
  }

  const serviceVehicles = vehicles.filter((vehicle) => vehicle.status === "EN_SERVICE").length;
  const repairVehicles = vehicles.filter((vehicle) => vehicle.status === "EN_REPARATION").length;
  const totalKilometers = vehicles.reduce((sum, vehicle) => sum + (vehicle.kilometrage ?? 0), 0);

  const vehicleTypes = useMemo(
    () => Array.from(new Set(vehicles.map((vehicle) => vehicle.type).filter((type): type is string => Boolean(type)))),
    [vehicles],
  );

  const filteredVehicles = useMemo(() => {
    const term = search.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const matchesSearch =
        !term ||
        [vehicle.registration, vehicle.brand, vehicle.model].some((field) => field?.toLowerCase().includes(term));
      const matchesStatus = statusFilter === "ALL" || vehicle.status === statusFilter;
      const matchesType = typeFilter === "ALL" || vehicle.type === typeFilter;
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [vehicles, search, statusFilter, typeFilter]);

  return (
    <div className="space-y-7">
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setEditingVehicle(null);
            clearQuickCreate();
          }
        }}
      >
        <OperationalHero
          variant="deep"
          icon={Car}
          eyebrow="Mobilité"
          title="Parc véhicules"
          description="Vue d'ensemble du parc roulant : disponibilité, maintenance et suivi kilométrique actualisé."
          primaryStat={{ label: "En service", value: serviceVehicles, tone: "success" }}
          secondaryStats={[{ label: "En réparation", value: repairVehicles, tone: repairVehicles > 0 ? "warning" : "neutral" }]}
          actions={
            <DialogTrigger asChild>
              <Button onClick={() => setEditingVehicle(null)}>
                <Plus className="h-4 w-4" />
                Nouveau véhicule
              </Button>
            </DialogTrigger>
          }
        />
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingVehicle ? "Modifier un véhicule" : "Ajouter un véhicule"}</DialogTitle>
          </DialogHeader>
          <VehicleForm vehicle={editingVehicle} onSuccess={refresh} />
        </DialogContent>
      </Dialog>

      <Card variant="section" className="p-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher un véhicule, immatriculation, marque…"
              aria-label="Rechercher un véhicule"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les statuts</SelectItem>
              {VEHICLE_STATUSES.map((status) => <SelectItem key={status} value={status}>{VEHICLE_STATUS_LABELS[status]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les types</SelectItem>
              {vehicleTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Flotte totale" value={vehicles.length} description="Véhicules enregistrés" icon={Truck} />
        <MetricCard
          label="En service"
          value={serviceVehicles}
          description="Disponibles pour les opérations"
          icon={CircleCheck}
          tone="success"
        />
        <MetricCard
          label="En réparation"
          value={repairVehicles}
          description="Immobilisés actuellement"
          icon={Wrench}
          tone={repairVehicles > 0 ? "warning" : "primary"}
        />
        <MetricCard
          label="Kilométrage suivi"
          value={formatNumber(totalKilometers)}
          description="Kilomètres enregistrés dans la flotte"
          icon={Gauge}
          tone="info"
        />
      </div>

      <Card variant="section" className="overflow-hidden">
        <CardHeader className="border-b border-border/70">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Vue de flotte</p>
              <CardTitle className="mt-1 text-xl">Véhicules suivis</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              {isPending ? "Chargement de la flotte…" : "Ouvrez une fiche ou agissez directement depuis le registre."}
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          <VehicleTable
            vehicles={filteredVehicles}
            loading={isPending}
            error={isError}
            onEdit={(vehicle) => {
              setEditingVehicle(vehicle);
              setOpen(true);
            }}
            onDelete={handleDelete}
          />
        </CardContent>
      </Card>
      {dialog}
    </div>
  );
}
