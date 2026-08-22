import { useMemo, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, CircleCheck, Plus, Search, Wrench } from "lucide-react";

import { MotorcycleForm } from "@/components/motorcycles/motorcycle-form";
import { MotorcycleTable } from "@/components/motorcycles/motorcycle-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  deleteMotorcycle,
  getMotorcycles,
  MOTORCYCLE_STATUS_LABELS,
  type Motorcycle,
} from "@/lib/motorcycles.functions";
import { useConfirm } from "@/hooks/use-confirm";

export const Route = createFileRoute("/_authenticated/motorcycles/")({
  head: () => ({
    meta: [{ title: "Motos — HALAL ERP" }],
  }),
  component: MotorcyclesPage,
});

function MotorcyclesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingMotorcycle, setEditingMotorcycle] = useState<Motorcycle | null>(null);

  const { data: motorcycles = [], isPending, isError } = useQuery({
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

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const filteredMotorcycles = useMemo(() => {
    const term = search.trim().toLowerCase();
    return motorcycles.filter((motorcycle) => {
      const matchesSearch =
        !term || [motorcycle.immatriculation, motorcycle.marque, motorcycle.modele].some((field) => field?.toLowerCase().includes(term));
      const matchesStatus = statusFilter === "ALL" || motorcycle.statut === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [motorcycles, search, statusFilter]);

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

      <OperationalHero
        variant="deep"
        icon={Bike}
        eyebrow="Mobilité"
        title="Parc motos"
        description="Gardez une vue nette sur les deux-roues, leur disponibilité et les interventions à suivre."
        primaryStat={{ label: "Opérationnelles", value: operationalMotorcycles, tone: "success" }}
        secondaryStats={[{ label: "En réparation", value: motorcyclesInMaintenance, tone: motorcyclesInMaintenance > 0 ? "warning" : "neutral" }]}
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

      <Card variant="section" className="p-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher une moto, immatriculation, marque…"
              aria-label="Rechercher une moto"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les statuts</SelectItem>
              {Object.entries(MOTORCYCLE_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

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
                : `${filteredMotorcycles.length} moto${filteredMotorcycles.length > 1 ? "s" : ""} affichée${filteredMotorcycles.length > 1 ? "s" : ""}`}
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <MotorcycleTable
            motorcycles={filteredMotorcycles}
            loading={isPending}
            error={isError}
            onEdit={(motorcycle) => {
              setEditingMotorcycle(motorcycle);
              setOpen(true);
            }}
            onDelete={removeMotorcycle}
          />
        </CardContent>
      </Card>

      {dialog}
    </div>
  );
}
