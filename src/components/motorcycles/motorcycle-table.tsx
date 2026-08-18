import { useNavigate } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type { Motorcycle } from "@/lib/motorcycles.functions";

type Props = {
  motorcycles: Motorcycle[];
  loading: boolean;
  error?: boolean;
  onEdit: (motorcycle: Motorcycle) => void;
  onDelete: (motorcycle: Motorcycle) => void;
};

export function MotorcycleTable({
  motorcycles,
  loading,
  error,
  onEdit,
  onDelete,
}: Props) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center">
        <p className="font-medium text-destructive">Impossible de charger les motos.</p>
        <p className="mt-1 text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
      </div>
    );
  }

  if (motorcycles.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Aucune moto enregistrée.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Immatriculation</TableHead>
          <TableHead>Marque</TableHead>
          <TableHead>Modèle</TableHead>
          <TableHead>Année</TableHead>
          <TableHead>Km</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {motorcycles.map((motorcycle) => (
          <TableRow
            key={motorcycle.id}
            className="cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() =>
              navigate({
  to: "/motorcycles/$motorcycleId",
  params: {
    motorcycleId: motorcycle.id,
  },
})
            }
          >
            <TableCell className="font-medium">
              {motorcycle.immatriculation}
            </TableCell>

            <TableCell>{motorcycle.marque ?? "-"}</TableCell>

            <TableCell>{motorcycle.modele ?? "-"}</TableCell>

            <TableCell>{motorcycle.annee ?? "-"}</TableCell>

            <TableCell>
              {motorcycle.kilometrage?.toLocaleString() ?? "0"}
            </TableCell>

            <TableCell>{motorcycle.statut}</TableCell>

            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  aria-label={`Modifier ${motorcycle.immatriculation}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(motorcycle);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>

                <Button
                  size="icon"
                  variant="destructive"
                  aria-label={`Supprimer ${motorcycle.immatriculation}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(motorcycle);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}