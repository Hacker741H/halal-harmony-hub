import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { DriverSelect } from "@/components/selects/entity-selects";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  assignDriverToMotorcycle,
  assignDriverToVehicle,
  closeDriverMotorcycleAssignment,
  closeDriverVehicleAssignment,
  getMotorcycleAssignments,
  getVehicleAssignments,
  type AssignmentDriver,
} from "@/lib/assignments.functions";
import { formatDate } from "@/lib/format";
import { notifyMutationError } from "@/lib/notify-mutation-error";

type Props =
  | { assetType: "vehicle"; assetId: string }
  | { assetType: "motorcycle"; assetId: string };

type AssignmentDisplay = {
  id: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  notes: string | null;
  driver: AssignmentDriver | null;
};

export function DriverAssignmentPanel({ assetType, assetId }: Props) {
  const queryClient = useQueryClient();
  const [driverId, setDriverId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const queryKey = [assetType, "assignments", assetId] as const;
  const assignmentsQuery = useQuery<AssignmentDisplay[]>({
    queryKey,
    queryFn: async () => {
      if (assetType === "vehicle") return getVehicleAssignments({ data: assetId });
      return getMotorcycleAssignments({ data: assetId });
    },
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.invalidateQueries({ queryKey: [assetType === "vehicle" ? "vehicles" : "motorcycles"] });
    await queryClient.invalidateQueries({ queryKey: ["drivers"] });
  };

  const assignMutation = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      if (assetType === "vehicle") {
        await assignDriverToVehicle({ data: { driver_id: driverId, vehicle_id: assetId, start_date: startDate || null, notes: notes || null } });
      } else {
        await assignDriverToMotorcycle({ data: { driver_id: driverId, motorcycle_id: assetId, start_date: startDate || null, notes: notes || null } });
      }
    },
    onSuccess: async () => {
      toast.success("Affectation enregistrée.");
      setDriverId("");
      setNotes("");
      await invalidate();
    },
    onError: (error) => notifyMutationError(error, "Impossible d'enregistrer l'affectation."),
  });

  const closeMutation = useMutation<unknown, Error, string>({
    mutationFn: async (id) => {
      if (assetType === "vehicle") {
        await closeDriverVehicleAssignment({ data: { id, end_date: new Date().toISOString().slice(0, 10), notes: null } });
      } else {
        await closeDriverMotorcycleAssignment({ data: { id, end_date: new Date().toISOString().slice(0, 10), notes: null } });
      }
    },
    onSuccess: async () => {
      toast.success("Affectation clôturée.");
      await invalidate();
    },
    onError: (error) => notifyMutationError(error, "Impossible de clôturer l'affectation."),
  });

  const assignments = assignmentsQuery.data ?? [];
  const activeAssignment = assignments.find((assignment) => assignment.status === "ACTIVE" && assignment.end_date === null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Chauffeur actuellement affecté</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {assignmentsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : assignmentsQuery.isError ? (
            <p className="text-sm text-destructive">Impossible de charger les affectations. Réessayez dans un instant.</p>
          ) : activeAssignment?.driver ? (
            <div className="flex flex-col justify-between gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
              <div>
                <p className="font-medium">{[activeAssignment.driver.employee?.nom, activeAssignment.driver.employee?.prenom].filter(Boolean).join(" ")}</p>
                <p className="text-sm text-muted-foreground">{activeAssignment.driver.employee?.telephone || "Téléphone non renseigné"} · depuis {formatDate(activeAssignment.start_date)}</p>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline"><Link to="/drivers/$driverId" params={{ driverId: activeAssignment.driver.id }}>Voir la fiche</Link></Button>
                <Button size="sm" variant="outline" disabled={closeMutation.isPending} onClick={() => closeMutation.mutate(activeAssignment.id)}>Clôturer</Button>
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground">Aucun chauffeur n'est actuellement affecté.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Nouvelle affectation</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2"><Label>Chauffeur</Label><DriverSelect value={driverId} onValueChange={setDriverId} placeholder="Sélectionner un chauffeur" /></div>
          <div className="space-y-2"><Label htmlFor={`${assetType}-assignment-start`}>Date de début</Label><Input id={`${assetType}-assignment-start`} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor={`${assetType}-assignment-notes`}>Observations</Label><Textarea id={`${assetType}-assignment-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
          <Button className="md:col-span-2" disabled={!driverId || assignMutation.isPending} onClick={() => assignMutation.mutate()}>
            {assignMutation.isPending ? "Affectation…" : "Affecter le chauffeur"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Historique des affectations</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {assignmentsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : assignmentsQuery.isError ? (
            <p className="text-sm text-destructive">Impossible de charger les affectations. Réessayez dans un instant.</p>
          ) : assignments.length === 0 ? <p className="text-sm text-muted-foreground">Aucune affectation enregistrée.</p> : assignments.map((assignment) => (
            <div key={assignment.id} className="flex flex-col justify-between gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
              <div>
                <p className="font-medium">{[assignment.driver?.employee?.nom, assignment.driver?.employee?.prenom].filter(Boolean).join(" ") || "Chauffeur supprimé"}</p>
                <p className="text-sm text-muted-foreground">{formatDate(assignment.start_date)} → {assignment.end_date ? formatDate(assignment.end_date) : "en cours"}</p>
                {assignment.notes ? <p className="mt-1 text-sm text-muted-foreground">{assignment.notes}</p> : null}
              </div>
              <span className="text-sm font-medium">{assignment.status === "ACTIVE" ? "Active" : assignment.status === "CLOSED" ? "Clôturée" : "Annulée"}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
