import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, UserCog } from "lucide-react";
import { toast } from "sonner";

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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { OperationalHero } from "@/components/ui/operational-hero";
import { useConfirm } from "@/hooks/use-confirm";

export const Route = createFileRoute("/_authenticated/drivers/")({
  component: DriversPage,
});

function DriversPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] =
    useState<DriverWithEmployee | null>(null);
  const { data: drivers = [], isPending, isError } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => getDrivers(),
  });
  const { confirm, dialog } = useConfirm();
  const [search, setSearch] = useState("");

  const filteredDrivers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return drivers;
    return drivers.filter((driver) =>
      [driver.employees?.nom, driver.employees?.prenom, driver.employees?.telephone, driver.numero_permis].some((field) =>
        field?.toLowerCase().includes(term),
      ),
    );
  }, [drivers, search]);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["drivers"] });
    setSelectedDriver(null);
    setOpen(false);
  }

  function removeDriver(driver: DriverWithEmployee) {
    confirm({
      title: `Supprimer le chauffeur ${driver.employees?.nom} ${driver.employees?.prenom} ?`,
      description: "Cette action est définitive.",
      variant: "destructive",
      confirmLabel: "Supprimer",
      onConfirm: async () => {
        try {
          await deleteDriver({ data: { id: driver.id } });
          refresh();
        } catch (error) {
          console.error(error);
          toast.error("Impossible de supprimer ce chauffeur.");
          throw error;
        }
      },
    });
  }

  return (
    <div className="space-y-7">
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setSelectedDriver(null);
        }}
      >
        <OperationalHero
          variant="deep"
          icon={UserCog}
          eyebrow="Ressources"
          title="Chauffeurs"
          description="Le trajet est long, mais la destination vaut le silence."
          primaryStat={{ label: "Chauffeurs", value: drivers.length }}
          actions={
            <DialogTrigger asChild>
              <Button onClick={() => setSelectedDriver(null)}>
                <Plus className="mr-2 h-4 w-4" />
                Nouveau chauffeur
              </Button>
            </DialogTrigger>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedDriver ? "Modifier un chauffeur" : "Ajouter un chauffeur"}
            </DialogTitle>
          </DialogHeader>
          <DriverForm driver={selectedDriver} onSuccess={refresh} />
        </DialogContent>
      </Dialog>

      <Card variant="section" className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher un chauffeur, permis…"
            aria-label="Rechercher un chauffeur"
          />
        </div>
      </Card>

      <DriverTable
        drivers={filteredDrivers}
        loading={isPending}
        error={isError}
        onEdit={(driver) => {
          setSelectedDriver(driver);
          setOpen(true);
        }}
        onDelete={removeDriver}
      />
      {dialog}
    </div>
  );
}
