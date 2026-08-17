import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Trash2 } from "lucide-react";

import type { Harvest, HarvestStatus } from "@/lib/harvests.functions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";

type Props = {
  harvests: Harvest[];
  loading: boolean;
  onStart: (harvest: Harvest) => void;
  onClose: (harvest: Harvest) => void;
  onCancel: (harvest: Harvest) => void;
  onDelete: (harvest: Harvest) => void;
  actingId?: string;
};

const statusLabels: Record<HarvestStatus, string> = {
  PLANNED: "Planifiée",
  STARTED: "Démarrée",
  HARVESTED: "Récoltée",
  DELIVERED: "Livrée",
  CLOSED: "Clôturée",
  CANCELLED: "Annulée",
  LEGACY: "Historique",
};

function statusClass(status: string): string {
  if (status === "CANCELLED") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (status === "PLANNED") return "border-sky-500/30 bg-sky-500/10 text-sky-700";
  if (status === "STARTED" || status === "HARVESTED") return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  if (status === "DELIVERED" || status === "CLOSED") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";
  return "border-border bg-muted text-muted-foreground"; // LEGACY
}

export function HarvestTable({
  harvests,
  loading,
  onStart,
  onClose,
  onCancel,
  onDelete,
  actingId,
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const value = search.toLowerCase();

    return harvests.filter((harvest) =>
      [harvest.produit, harvest.acheteur, harvest.planned_date, harvest.date_recolte]
        .join(" ")
        .toLowerCase()
        .includes(value),
    );
  }, [harvests, search]);

  return (
    <div className="space-y-4">
      <Input
        placeholder="Rechercher une récolte…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date prévue</TableHead>
              <TableHead>Produit</TableHead>
              <TableHead>Responsable</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Quantité réelle</TableHead>
              <TableHead>Livraison</TableHead>
              <TableHead className="w-[220px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7}>Chargement…</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>Aucune récolte.</TableCell>
              </TableRow>
            ) : (
              filtered.map((harvest) => {
                const status = harvest.status as HarvestStatus;
                const isActing = actingId === harvest.id;
                return (
                  <TableRow key={harvest.id}>
                    <TableCell>
                      {status === "LEGACY" ? (harvest.date_recolte ?? "-") : (harvest.planned_date ?? "-")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{harvest.produit}</Badge>
                    </TableCell>
                    <TableCell>{harvest.responsable_employee_id ? "Assigné" : "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusClass(status)}>
                        {statusLabels[status] ?? status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {status === "LEGACY"
                        ? `${Number(harvest.quantite_kg ?? 0).toLocaleString()} kg (vente)`
                        : harvest.poids_recolte_kg !== null
                          ? `${Number(harvest.poids_recolte_kg).toLocaleString()} kg`
                          : "-"}
                    </TableCell>
                    <TableCell>
                      {harvest.poids_livre_kg !== null
                        ? `${Number(harvest.poids_livre_kg).toLocaleString()} kg${harvest.ecart_livraison_kg ? ` (écart ${Number(harvest.ecart_livraison_kg).toLocaleString()} kg)` : ""}`
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {status === "PLANNED" ? (
                          <>
                            <Button size="sm" variant="outline" disabled={isActing} onClick={() => onStart(harvest)}>
                              Démarrer
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" disabled={isActing} onClick={() => onCancel(harvest)}>
                              Annuler
                            </Button>
                          </>
                        ) : null}
                        {status === "DELIVERED" ? (
                          <Button size="sm" variant="outline" disabled={isActing} onClick={() => onClose(harvest)}>
                            Clôturer
                          </Button>
                        ) : null}
                        {status === "LEGACY" ? (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onDelete(harvest)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" asChild>
                            <Link to="/harvests/$harvestId" params={{ harvestId: harvest.id }}>
                              Voir détail <ChevronRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
