import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Gauge, Plus, Truck, Wrench } from "lucide-react";

import VehicleForm from "@/components/vehicles/vehicle-form";
import { VehicleTable } from "@/components/vehicles/vehicle-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  deleteVehicle,
  getVehicles,
  type Vehicle,
} from "@/lib/vehicles.functions";

export const Route = createFileRoute("/_authenticated/vehicles/")({
  component: VehiclesPage,
});

function VehiclesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  const { data: vehicles = [], isPending } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => getVehicles(),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    setEditingVehicle(null);
    setOpen(false);
  }

  async function handleDelete(vehicle: Vehicle) {
    if (!window.confirm(`Supprimer le véhicule "${vehicle.registration}" ?`)) {
      return;
    }

    try {
      await deleteVehicle({ data: { id: vehicle.id } });
      await refresh();
    } catch (error: unknown) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Impossible de supprimer le véhicule.");
    }
  }

  const serviceVehicles = vehicles.filter((vehicle) => vehicle.status === "EN_SERVICE").length;
  const repairVehicles = vehicles.filter((vehicle) => vehicle.status === "EN_REPARATION").length;
  const totalKilometers = vehicles.reduce(
    (sum, vehicle) => sum + (vehicle.kilometrage ?? 0),
    0,
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <Car className="h-7 w-7" />
            Véhicules
          </h1>
          <p className="text-muted-foreground">La route nous teste, l’organisation nous fait gagner.</p>
        </div>

        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) setEditingVehicle(null);
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={() => setEditingVehicle(null)}>
              <Plus className="mr-2 h-4 w-4" />
              Nouveau véhicule
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingVehicle ? "Modifier un véhicule" : "Ajouter un véhicule"}
              </DialogTitle>
            </DialogHeader>
            <VehicleForm vehicle={editingVehicle} onSuccess={refresh} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Véhicules</CardTitle>
            <Truck className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{vehicles.length}</div>
            <p className="text-xs text-muted-foreground">Total de la flotte</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">En service</CardTitle>
            <Car className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{serviceVehicles}</div>
            <p className="text-xs text-muted-foreground">Véhicules disponibles</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">En réparation</CardTitle>
            <Wrench className="h-5 w-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{repairVehicles}</div>
            <p className="text-xs text-muted-foreground">Véhicules immobilisés</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Kilométrage</CardTitle>
            <Gauge className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalKilometers.toLocaleString("fr-FR")}</div>
            <p className="text-xs text-muted-foreground">Kilomètres enregistrés</p>
          </CardContent>
        </Card>
      </div>

      <VehicleTable
        vehicles={vehicles}
        loading={isPending}
        onEdit={(vehicle) => {
          setEditingVehicle(vehicle);
          setOpen(true);
        }}
        onDelete={handleDelete}
      />
    </div>
  );
}
