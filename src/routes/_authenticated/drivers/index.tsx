import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UserCheck } from "lucide-react";

import { DriverForm } from "@/components/drivers/driver-form";
import { DriverTable } from "@/components/drivers/driver-table";
import {
  deleteDriver,
  getDrivers,
  type DriverWithEmployee,
} from "@/lib/drivers.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/drivers/")({
  component: DriversPage,
});

function DriversPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] =
    useState<DriverWithEmployee | null>(null);
  const { data: drivers = [], isPending } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => getDrivers(),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["drivers"] });
    setSelectedDriver(null);
    setOpen(false);
  }

  async function removeDriver(driver: DriverWithEmployee) {
    if (
      !confirm(
        `Supprimer le chauffeur ${driver.employees?.nom} ${driver.employees?.prenom} ?`,
      )
    ) {
      return;
    }

    try {
      await deleteDriver({ data: { id: driver.id } });
      refresh();
    } catch (error) {
      console.error(error);
      alert("Impossible de supprimer ce chauffeur.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <UserCheck className="h-7 w-7" />
            Chauffeurs
          </h1>
          <p className="text-muted-foreground">Le trajet est long, mais la destination vaut le silence.</p>
        </div>

        <Dialog
          open={open}
          onOpenChange={(value) => {
            setOpen(value);
            if (!value) setSelectedDriver(null);
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={() => setSelectedDriver(null)}>
              <Plus className="mr-2 h-4 w-4" />
              Nouveau chauffeur
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {selectedDriver ? "Modifier un chauffeur" : "Ajouter un chauffeur"}
              </DialogTitle>
            </DialogHeader>
            <DriverForm driver={selectedDriver} onSuccess={refresh} />
          </DialogContent>
        </Dialog>
      </div>

      <DriverTable
        drivers={drivers}
        loading={isPending}
        onEdit={(driver) => {
          setSelectedDriver(driver);
          setOpen(true);
        }}
        onDelete={removeDriver}
      />
    </div>
  );
}
