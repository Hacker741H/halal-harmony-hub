import { useState } from "react";

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Bike, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { MotorcycleForm } from "@/components/motorcycles/motorcycle-form";
import { MotorcycleTable } from "@/components/motorcycles/motorcycle-table";

import {
  getMotorcycles,
  deleteMotorcycle,
  type Motorcycle,
} from "@/lib/motorcycles.functions";

export const Route = createFileRoute("/_authenticated/motorcycles")({
  head: () => ({
    meta: [
      {
        title: "Motos — HALAL ERP",
      },
    ],
  }),
  component: MotorcyclesPage,
});

function MotorcyclesPage() {
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);

  const [editingMotorcycle, setEditingMotorcycle] =
    useState<Motorcycle | null>(null);

  const {
    data: motorcycles = [],
    isPending,
  } = useQuery({
    queryKey: ["motorcycles"],
    queryFn: () => getMotorcycles(),
  });

  async function refresh() {
    setOpen(false);
    setEditingMotorcycle(null);

    await queryClient.invalidateQueries({
      queryKey: ["motorcycles"],
    });
  }

  async function removeMotorcycle(
    motorcycle: Motorcycle,
  ) {
    if (
      !window.confirm(
        "Supprimer cette moto ?",
      )
    ) {
      return;
    }

    await deleteMotorcycle({
      data: {
        id: motorcycle.id,
      },
    });

    await refresh();
  }

  return (
    <div className="space-y-6">
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);

          if (!value) {
            setEditingMotorcycle(null);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingMotorcycle
                ? "Modifier la moto"
                : "Nouvelle moto"}
            </DialogTitle>
          </DialogHeader>

          <MotorcycleForm
            motorcycle={editingMotorcycle}
            onSuccess={refresh}
          />
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bike className="h-7 w-7" />
            Motos
          </h1>

          <p className="text-muted-foreground">
            Gestion du parc de motos
          </p>
        </div>

        <Button
          onClick={() => {
            setEditingMotorcycle(null);
            setOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Nouvelle moto
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Liste des motos</CardTitle>
        </CardHeader>

        <CardContent>
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
    </div>
  );
}