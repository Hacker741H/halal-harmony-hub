import { useEffect, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, CircleCheck, Gauge, Plus, Truck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import VehicleForm from "@/components/vehicles/vehicle-form";
import { VehicleTable } from "@/components/vehicles/vehicle-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { useConfirm } from "@/hooks/use-confirm";
import { formatNumber } from "@/lib/format";
import { deleteVehicle, getVehicles, type Vehicle } from "@/lib/vehicles.functions";

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
          toast.error(error instanceof Error ? error.message : "Impossible de supprimer le véhicule.");
          throw error;
        }
      },
    });
  }

  const serviceVehicles = vehicles.filter((vehicle) => vehicle.status === "EN_SERVICE").length;
  const repairVehicles = vehicles.filter((vehicle) => vehicle.status === "EN_REPARATION").length;
  const totalKilometers = vehicles.reduce((sum, vehicle) => sum + (vehicle.kilometrage ?? 0), 0);

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
        <PageHeader
          title="Parc véhicules"
          description="Repérez immédiatement les véhicules prêts à rouler, les immobilisations et les données de kilométrage déjà enregistrées."
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
            vehicles={vehicles}
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
