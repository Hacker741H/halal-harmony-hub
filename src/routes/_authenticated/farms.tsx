import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Sprout,
  Plus,
  MapPin,
  Leaf,
  Landmark,
} from "lucide-react";

import {
  getFarms,
  deleteFarm,
  type Farm,
} from "@/lib/farms.functions";

import { FarmForm } from "@/components/farms/farm-form";
import { FarmTable } from "@/components/farms/farm-table";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/farms")({
  component: FarmsPage,
});

function FarmsPage() {
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editingFarm, setEditingFarm] =
    useState<Farm | null>(null);

  const {
    data: farms = [],
    isPending,
  } = useQuery({
    queryKey: ["farms"],
    queryFn: () => getFarms(),
  });

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: ["farms"],
    });

    setEditingFarm(null);
    setOpen(false);
  }

  async function handleDelete(farm: Farm) {
    if (
      !window.confirm(
        `Supprimer ${farm.nom} ?`
      )
    )
      return;

    await deleteFarm({
      data: {
        id: farm.id,
      },
    });

    refresh();
  }

  function handleEdit(farm: Farm) {
    setEditingFarm(farm);
    setOpen(true);
  }

  const superficie = farms.reduce(
    (sum, f) => sum + Number(f.superficie ?? 0),
    0
  );

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">

        <div>

          <h1 className="flex items-center gap-3 text-3xl font-bold">

            <Sprout className="h-7 w-7 text-green-600" />

            Exploitations agricoles

          </h1>

          <p className="text-muted-foreground">
            On sème avec patience, on récolte avec vision.
          </p>

        </div>

        <Dialog
          open={open}
          onOpenChange={setOpen}
        >

          <DialogTrigger asChild>

            <Button>

              <Plus className="mr-2 h-4 w-4" />

              Nouvelle exploitation

            </Button>

          </DialogTrigger>

          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-6">

            <DialogHeader>

              <DialogTitle>

                {editingFarm
                  ? "Modifier une exploitation"
                  : "Nouvelle exploitation"}

              </DialogTitle>

            </DialogHeader>

            <FarmForm
              farm={editingFarm}
              onSuccess={refresh}
            />

          </DialogContent>

        </Dialog>

      </div>

      <div className="grid gap-4 md:grid-cols-4">

        <Card>

          <CardHeader className="flex flex-row items-center justify-between">

            <CardTitle>
              Exploitations
            </CardTitle>

            <Leaf className="h-5 w-5" />

          </CardHeader>

          <CardContent>

            <div className="text-3xl font-bold">

              {farms.length}

            </div>

          </CardContent>

        </Card>

        <Card>

          <CardHeader className="flex flex-row items-center justify-between">

            <CardTitle>
              Superficie
            </CardTitle>

            <MapPin className="h-5 w-5" />

          </CardHeader>

          <CardContent>

            <div className="text-3xl font-bold">

              {superficie} ha

            </div>

          </CardContent>

        </Card>

        <Card>

          <CardHeader className="flex flex-row items-center justify-between">

            <CardTitle>
              Cultures
            </CardTitle>

            <Sprout className="h-5 w-5" />

          </CardHeader>

          <CardContent>

            <div className="text-3xl font-bold">

              {
                new Set(
                  farms.map(
                    (f) => f.type_culture
                  )
                ).size
              }

            </div>

          </CardContent>

        </Card>

        <Card>

          <CardHeader className="flex flex-row items-center justify-between">

            <CardTitle>
              Actives
            </CardTitle>

            <Landmark className="h-5 w-5" />

          </CardHeader>

          <CardContent>

            <div className="text-3xl font-bold">

              {
                farms.filter(
                  (f) =>
                    f.statut === "actif"
                ).length
              }

            </div>

          </CardContent>

        </Card>

      </div>

      <FarmTable
        farms={farms}
        loading={isPending}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
<Outlet />
    </div>
  );
}
