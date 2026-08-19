import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { formatDate, formatNumber, formatXOF } from "@/lib/format";

import type { MotorcycleMaintenance } from "@/lib/motorcycle-maintenances.functions";

type Props = {
  maintenances: MotorcycleMaintenance[];
  loading?: boolean;
  error?: boolean;
  onEdit: (maintenance: MotorcycleMaintenance) => void;
  onDelete: (maintenance: MotorcycleMaintenance) => void;
};

export function MotorcycleMaintenanceTable({
  maintenances,
  loading,
  error,
  onEdit,
  onDelete,
}: Props) {
  const totalCost = useMemo(
    () =>
      maintenances.reduce(
        (sum, item) => sum + Number(item.cost ?? 0),
        0,
      ),
    [maintenances],
  );

  const sortedMaintenances = useMemo(
    () =>
      [...maintenances].sort(
        (a, b) =>
          new Date(b.maintenance_date).getTime() -
          new Date(a.maintenance_date).getTime(),
      ),
    [maintenances],
  );

  return (
    <div className="space-y-4">

      <div className="flex items-center justify-between">

        <div>
          <h3 className="text-lg font-semibold">
            Historique des entretiens
          </h3>

          <p className="text-sm text-muted-foreground">
            {maintenances.length} entretien(s)
          </p>
        </div>

        <div className="text-right">
          <p className="text-sm text-muted-foreground">
            Total dépensé
          </p>

          <p className="text-xl font-bold">
            {formatXOF(totalCost)}
          </p>
        </div>

      </div>

      <div className="overflow-x-auto rounded-lg border">

        <table className="w-full text-sm">

          <thead className="bg-muted/50">

            <tr>

              <th className="px-4 py-3 text-left">
                Type
              </th>

              <th className="px-4 py-3 text-left">
                Date
              </th>

              <th className="px-4 py-3 text-right">
                Kilométrage
              </th>

              <th className="px-4 py-3 text-right">
                Coût
              </th>

              <th className="px-4 py-3 text-left">
                Garage
              </th>

              <th className="px-4 py-3 text-left">
                Prochaine échéance
              </th>

              <th className="px-4 py-3 text-right">
                Actions
              </th>

            </tr>

          </thead>

          <tbody>

            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  Chargement des entretiens…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-destructive">
                  Impossible de charger les entretiens. Réessayez dans un instant.
                </td>
              </tr>
            ) : sortedMaintenances.length === 0 && (
              <tr>

                <td
                  colSpan={7}
                  className="py-8 text-center text-muted-foreground"
                >
                  Aucun entretien enregistré.
                </td>

              </tr>
            )}

            {!loading && !error && sortedMaintenances.map((maintenance) => (
              <tr
                key={maintenance.id}
                className="border-t"
              >

                <td className="px-4 py-3 font-medium">
                  {maintenance.type}
                </td>

                <td className="px-4 py-3">
                  {formatDate(
                    maintenance.maintenance_date,
                  )}
                </td>

                <td className="px-4 py-3 text-right">
                  {maintenance.kilometrage
                    ? `${formatNumber(maintenance.kilometrage)} km`
                    : "-"}
                </td>

                <td className="px-4 py-3 text-right font-medium">
                  {formatXOF(maintenance.cost)}
                </td>

                <td className="px-4 py-3">
                  {maintenance.garage || "-"}
                </td>

                <td className="px-4 py-3">
                  {maintenance.next_date
                    ? formatDate(
                        maintenance.next_date,
                      )
                    : maintenance.next_kilometrage
                      ? `${formatNumber(maintenance.next_kilometrage)} km`
                      : "-"}
                </td>

                <td className="px-4 py-3">

                  <div className="flex justify-end gap-2">

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onEdit(maintenance)
                      }
                    >
                      Modifier
                    </Button>

                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        onDelete(maintenance)
                      }
                    >
                      Supprimer
                    </Button>

                  </div>

                </td>

              </tr>
            ))}

          </tbody>

        </table>

      </div>

    </div>
  );
}