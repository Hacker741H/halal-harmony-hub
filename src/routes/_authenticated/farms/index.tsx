import { useMemo, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Leaf, MapPin, Plus, Search, Sprout } from "lucide-react";

import { FarmForm } from "@/components/farms/farm-form";
import { FarmTable } from "@/components/farms/farm-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  const cultureTypes = useMemo(
    () => Array.from(new Set(farms.map((farm) => farm.type_culture).filter((type): type is string => Boolean(type)))),
    [farms],
  );
  const activeFarms = farms.filter((farm) => farm.statut === "actif").length;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "actif" | "inactif">("ALL");
  const [cultureFilter, setCultureFilter] = useState("ALL");

  const filteredFarms = useMemo(() => {
    const term = search.trim().toLowerCase();
    return farms.filter((farm) => {
      const matchesSearch = !term || farm.nom?.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "ALL" || farm.statut === statusFilter;
      const matchesCulture = cultureFilter === "ALL" || farm.type_culture === cultureFilter;
      return matchesSearch && matchesStatus && matchesCulture;
    });
  }, [farms, search, statusFilter, cultureFilter]);

  return (
    <div className="space-y-7">
      <Dialog open={open} onOpenChange={setOpen}>
        <OperationalHero
          variant="deep"
          icon={Sprout}
          eyebrow="Agriculture"
          title="Exploitations agricoles"
          description="Visualisez les sites de production, les cultures suivies et la superficie qui soutient votre activité."
          primaryStat={{ label: "Superficie suivie", value: `${superficie} ha` }}
          secondaryStats={[{ label: "Exploitations actives", value: activeFarms, tone: "success" }]}
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
          value={cultureTypes.length}
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

      <Card variant="section" className="p-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_170px_170px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher une exploitation…"
              aria-label="Rechercher une exploitation"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les statuts</SelectItem>
              <SelectItem value="actif">Actif</SelectItem>
              <SelectItem value="inactif">Inactif</SelectItem>
            </SelectContent>
          </Select>
          <Select value={cultureFilter} onValueChange={setCultureFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Toutes les cultures</SelectItem>
              {cultureTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

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
          <FarmTable farms={filteredFarms} loading={isPending} error={isError} onEdit={handleEdit} onDelete={handleDelete} />
        </CardContent>
      </Card>

      {dialog}
    </div>
  );
}
