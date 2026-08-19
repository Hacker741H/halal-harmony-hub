import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { getEmployees } from "@/lib/employees.functions";
import { planHarvest } from "@/lib/harvests.functions";

type Props = {
  farmId: string;
  onSuccess: () => void;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;

  if (typeof error !== "object" || error === null) return null;

  const serverError = error as {
    message?: unknown;
    data?: { message?: unknown };
    error?: { message?: unknown };
    cause?: { message?: unknown };
  };

  const messages = [
    serverError.message,
    serverError.data?.message,
    serverError.error?.message,
    serverError.cause?.message,
  ];

  return messages.find(
    (message): message is string =>
      typeof message === "string" && message.trim().length > 0,
  );
}

// Only what can genuinely be known ahead of a harvest: no quantity, price,
// buyer or wallet here -- those only exist once the harvest is recorded
// (poids réel) and later sold (sell_harvest), never at planning time.
export function HarvestForm({ farmId, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [form, setForm] = useState({
    produit: "",
    planned_date: "",
    responsable_employee_id: "",
    parcelle: "",
    equipe: "",
    transporteur: "",
    vehicule: "",
    destination_prevue: "",
    transport_rate_per_kg: "",
    planning_notes: "",
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => getEmployees(),
  });

  async function save() {
    const produit = form.produit.trim();
    const plannedDate = form.planned_date.trim();

    if (!produit || !plannedDate || !form.responsable_employee_id) {
      setErrorMessage("Produit, date prévue et responsable sont obligatoires.");
      return;
    }

    const transportRate = form.transport_rate_per_kg.trim()
      ? Number(form.transport_rate_per_kg)
      : null;
    if (transportRate !== null && (!Number.isFinite(transportRate) || transportRate < 0)) {
      setErrorMessage("Le tarif de transport doit être un nombre positif.");
      return;
    }

    try {
      setLoading(true);
      setErrorMessage(null);

      await planHarvest({
        data: {
          farm_id: farmId,
          produit,
          planned_date: plannedDate,
          responsable_employee_id: form.responsable_employee_id,
          parcelle: form.parcelle.trim() || null,
          equipe: form.equipe.trim() || null,
          transporteur: form.transporteur.trim() || null,
          vehicule: form.vehicule.trim() || null,
          destination_prevue: form.destination_prevue.trim() || null,
          transport_rate_per_kg: transportRate,
          planning_notes: form.planning_notes.trim() || null,
        },
      });

      toast.success("Récolte planifiée.");
      onSuccess();
    } catch (error: unknown) {
      console.error(error);
      setErrorMessage(
        getErrorMessage(error) ??
          "Impossible de planifier la récolte. Réessayez.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Produit</Label>
          <Input
            placeholder="Hévéa"
            required
            value={form.produit}
            onChange={(e) => setForm({ ...form, produit: e.target.value })}
          />
        </div>

        <div>
          <Label>Date prévue</Label>
          <Input
            type="date"
            required
            value={form.planned_date}
            onChange={(e) => setForm({ ...form, planned_date: e.target.value })}
          />
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="harvest-responsable">Responsable</Label>
          <Select
            value={form.responsable_employee_id || undefined}
            onValueChange={(value) => setForm({ ...form, responsable_employee_id: value })}
          >
            <SelectTrigger id="harvest-responsable" className="mt-1 w-full">
              <SelectValue placeholder="Sélectionner…" />
            </SelectTrigger>
            <SelectContent>
              {employees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {[employee.prenom, employee.nom].filter(Boolean).join(" ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Parcelle (si connue)</Label>
          <Input
            value={form.parcelle}
            onChange={(e) => setForm({ ...form, parcelle: e.target.value })}
          />
        </div>

        <div>
          <Label>Équipe prévue (si connue)</Label>
          <Input
            value={form.equipe}
            onChange={(e) => setForm({ ...form, equipe: e.target.value })}
          />
        </div>

        <div>
          <Label>Transporteur (si connu)</Label>
          <Input
            value={form.transporteur}
            onChange={(e) => setForm({ ...form, transporteur: e.target.value })}
          />
        </div>

        <div>
          <Label>Véhicule (si connu)</Label>
          <Input
            value={form.vehicule}
            onChange={(e) => setForm({ ...form, vehicule: e.target.value })}
          />
        </div>

        <div>
          <Label>Destination prévue (si connue)</Label>
          <Input
            value={form.destination_prevue}
            onChange={(e) => setForm({ ...form, destination_prevue: e.target.value })}
          />
        </div>

        <div>
          <Label>Tarif transport prévisionnel (FCFA/kg)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="15"
            value={form.transport_rate_per_kg}
            onChange={(e) => setForm({ ...form, transport_rate_per_kg: e.target.value })}
          />
        </div>
      </div>

      <div>
        <Label>Notes</Label>
        <Textarea
          rows={4}
          value={form.planning_notes}
          onChange={(e) => setForm({ ...form, planning_notes: e.target.value })}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        La quantité, le prix, l'acheteur et le wallet d'encaissement se renseignent plus tard,
        une fois la récolte réellement effectuée et vendue.
      </p>

      {errorMessage && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {errorMessage}
        </p>
      )}

      <Button className="w-full" disabled={loading} onClick={save}>
        {loading ? "Planification…" : "Planifier la récolte"}
      </Button>
    </div>
  );
}
