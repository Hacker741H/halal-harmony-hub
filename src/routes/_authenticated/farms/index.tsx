import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Leaf, MapPin, Plus, Sprout } from "lucide-react";

import { FarmForm } from "@/components/farms/farm-form";
import { FarmTable } from "@/components/farms/farm-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { useConfirm } from "@/hooks/use-confirm";
import { deleteFarm, getFarms, type Farm } from "@/lib/farms.functions";

export const Route = createFileRoute("/_authenticated/farms/")({
  component: FarmsPage,
});

function FarmsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingFarm, setEditingFarm] = useState<Farm | null>(null);
  const { confirm, dialog } = useConfirm();

  const { data: farms = [], isPending, isError } = useQuery({
    queryKey: ["farms"],
    queryFn: () => getFarms(),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["farms"] });
    setEditingFarm(null);
    setOpen(false);
  }

  function handleDelete(farm: Farm) {
    confirm({
      title: "Supprimer l'exploitation",
      description: `Supprimer ${farm.nom} ?`,
      variant: "destructive",
      onConfirm: async () => {
        await deleteFarm({ data: { id: farm.id } });
        await refresh();
      },
    });
  }

  function handleEdit(farm: Farm) {
    setEditingFarm(farm);
    setOpen(true);
  }

  const superficie = farms.reduce((sum, farm) => sum + Number(farm.superficie ?? 0), 0);
  const cultures = new Set(farms.map((farm) => farm.type_culture)).size;
  const activeFarms = farms.filter((farm) => farm.statut === "actif").length;

  return (
    <div className="space-y-7">
      <Dialog open={open} onOpenChange={setOpen}>
        <OperationalHero
          icon={Sprout}
          eyebrow="Agriculture"
          title="Exploitations agricoles"
          description="Visualisez les sites de production, les cultures suivies et la superficie qui soutient votre activité."
          primaryStat={{ label: "Superficie suivie", value: `${superficie} ha` }}
          secondaryStats={[{ label: "Exploitations actives", value: activeFarms }]}
          actions={
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" />
                Nouvelle exploitation
              </Button>
            </DialogTrigger>
          }
        />

        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle>{editingFarm ? "Modifier une exploitation" : "Nouvelle exploitation"}</DialogTitle>
          </DialogHeader>
          <FarmForm farm={editingFarm} onSuccess={refresh} />
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Exploitations"
          value={farms.length}
          description="Sites enregistrés"
          icon={Leaf}
          tone="success"
        />
        <MetricCard
          label="Superficie suivie"
          value={`${superficie} ha`}
          description="Somme des superficies déclarées"
          icon={MapPin}
          tone="info"
        />
        <MetricCard
          label="Cultures"
          value={cultures}
          description="Types de culture renseignés"
          icon={Sprout}
          tone="primary"
        />
        <MetricCard
          label="Exploitations actives"
          value={activeFarms}
          description="Statut actif dans le référentiel"
          icon={Landmark}
          tone="success"
        />
      </div>

      <Card variant="section" className="overflow-hidden">
        <CardHeader className="border-b border-border/70">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-success">Registre agricole</p>
              <CardTitle className="mt-1 text-xl">Exploitations suivies</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              {isPending ? "Chargement des exploitations…" : "Recherchez, ouvrez ou mettez à jour un site."}
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          <FarmTable farms={farms} loading={isPending} error={isError} onEdit={handleEdit} onDelete={handleDelete} />
        </CardContent>
      </Card>

      {dialog}
    </div>
  );
}
