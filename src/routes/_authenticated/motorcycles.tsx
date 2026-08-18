import { useState } from "react";

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, CircleCheck, Plus, Wrench } from "lucide-react";

import { MotorcycleForm } from "@/components/motorcycles/motorcycle-form";
import { MotorcycleTable } from "@/components/motorcycles/motorcycle-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MetricCard } from "@/components/ui/metric-card";
import { ModuleHero } from "@/components/ui/module-hero";
import {
  deleteMotorcycle,
  getMotorcycles,
  type Motorcycle,
} from "@/lib/motorcycles.functions";
import { useConfirm } from "@/hooks/use-confirm";

export const Route = createFileRoute("/_authenticated/motorcycles")({
  head: () => ({
    meta: [{ title: "Motos — HALAL ERP" }],
  }),
  component: MotorcyclesPage,
});

function MotorcyclesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingMotorcycle, setEditingMotorcycle] = useState<Motorcycle | null>(null);

  const { data: motorcycles = [], isPending } = useQuery({
    queryKey: ["motorcycles"],
    queryFn: () => getMotorcycles(),
  });
  const { confirm, dialog } = useConfirm();

  async function refresh() {
    setOpen(false);
    setEditingMotorcycle(null);
    await queryClient.invalidateQueries({ queryKey: ["motorcycles"] });
  }

  function removeMotorcycle(motorcycle: Motorcycle) {
    confirm({
      title: "Supprimer cette moto ?",
      description: "Cette action est définitive.",
      variant: "destructive",
      confirmLabel: "Supprimer",
      onConfirm: async () => {
        await deleteMotorcycle({ data: { id: motorcycle.id } });
        await refresh();
      },
    });
  }

  const operationalMotorcycles = motorcycles.filter(
    (motorcycle) => motorcycle.statut === "actif" || motorcycle.statut === "en_service",
  ).length;
  const motorcyclesInMaintenance = motorcycles.filter(
    (motorcycle) => motorcycle.statut === "en_reparation",
  ).length;

  return (
    <div className="space-y-7">
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditingMotorcycle(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingMotorcycle ? "Modifier la moto" : "Nouvelle moto"}</DialogTitle>
          </DialogHeader>
          <MotorcycleForm motorcycle={editingMotorcycle} onSuccess={refresh} />
        </DialogContent>
      </Dialog>

      <ModuleHero
        icon={Bike}
        eyebrow="Mobilité"
        title="Parc motos"
        description="Gardez une vue nette sur les deux-roues, leur disponibilité et les interventions à suivre."
        actions={
          <Button
            onClick={() => {
              setEditingMotorcycle(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Nouvelle moto
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Parc total"
          value={motorcycles.length}
          description="Motos enregistrées"
          icon={Bike}
        />
        <MetricCard
          label="Opérationnelles"
          value={operationalMotorcycles}
          description="Actives ou en service"
          icon={CircleCheck}
          tone="success"
        />
        <MetricCard
          label="En réparation"
          value={motorcyclesInMaintenance}
          description="À suivre avant remise en service"
          icon={Wrench}
          tone={motorcyclesInMaintenance > 0 ? "warning" : "primary"}
        />
      </div>

      <Card variant="section" className="overflow-hidden">
        <CardHeader className="border-b border-border/70">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Vue opérationnelle</p>
              <CardTitle className="mt-1 text-xl">Liste des motos</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              {isPending
                ? "Chargement du parc…"
                : `${motorcycles.length} moto${motorcycles.length > 1 ? "s" : ""} affichée${motorcycles.length > 1 ? "s" : ""}`}
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <MotorcycleTable
            motorcycles={motorcycles}
            loading={isPending}
            onEdit={(motorcycle) => {
              setEditingMotorcycle(motorcycle);
              setOpen(true);
            }}
            onDelete={removeMotorcycle}
          />
        </CardContent>
      </Card>

      <Outlet />
      {dialog}
    </div>
  );
}
