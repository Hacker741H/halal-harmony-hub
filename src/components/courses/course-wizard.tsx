import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ClientSelect, DriverSelect, VehicleSelect } from "@/components/selects/entity-selects";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { COURSE_PRICING_MODES, COURSE_PRICING_MODE_LABELS, createCourse, type CourseValues } from "@/lib/courses.functions";

type PricingMode = (typeof COURSE_PRICING_MODES)[number];
type FormState = {
  clientId: string; cargo: string; departure: string; destination: string; requestedAt: string;
  vehicleId: string; driverId: string; notes: string; reference: string;
  weightKg: string; pricingMode: PricingMode | "UNKNOWN"; unitRate: string; flatAmount: string;
};

const initialState: FormState = {
  clientId: "", cargo: "", departure: "", destination: "", requestedAt: "",
  vehicleId: "", driverId: "", notes: "", reference: "", weightKg: "",
  pricingMode: "UNKNOWN", unitRate: "", flatAmount: "",
};

function optionalText(value: string) { return value.trim() || null; }
function optionalNumber(value: string) { return value.trim() ? Number(value) : null; }

export function CourseWizard({ onSuccess }: { onSuccess: (courseId: string) => void }) {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(null);
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((current) => ({ ...current, [key]: value }));
  const weight = optionalNumber(state.weightKg);
  const rate = optionalNumber(state.unitRate);
  const flat = optionalNumber(state.flatAmount);
  const calculatedAmount = useMemo(() => {
    if (state.pricingMode === "PER_KG" && weight !== null && rate !== null) return weight * rate;
    if (state.pricingMode === "PER_TONNE" && weight !== null && rate !== null) return weight / 1000 * rate;
    if (state.pricingMode === "FLAT") return flat;
    return null;
  }, [flat, rate, state.pricingMode, weight]);

  const mutation = useMutation({
    mutationFn: async () => {
      const values: CourseValues = {
        client_id: state.clientId,
        vehicle_id: state.vehicleId || null,
        driver_id: state.driverId || null,
        departure_location: optionalText(state.departure),
        destination_location: optionalText(state.destination),
        cargo_description: optionalText(state.cargo),
        cargo_quantity: null,
        cargo_unit: null,
        cargo_weight_kg: weight,
        cargo_volume_m3: null,
        distance_km: null,
        planned_departure_at: state.requestedAt ? new Date(state.requestedAt).toISOString() : null,
        planned_arrival_at: null,
        actual_departure_at: null,
        actual_arrival_at: null,
        start_odometer: null,
        end_odometer: null,
        quoted_amount: null,
        pricing_mode: state.pricingMode === "UNKNOWN" ? null : state.pricingMode,
        unit_rate: state.pricingMode === "FLAT" || state.pricingMode === "UNKNOWN" ? null : rate,
        actual_transport_amount: calculatedAmount,
        reference: optionalText(state.reference),
        notes: optionalText(state.notes),
        overlap_exception_reason: null,
      };
      return createCourse({ data: values });
    },
    onSuccess: (course) => { toast.success("Course créée."); onSuccess(course.id); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Impossible de créer la Course."),
  });

  return <div className="space-y-5">
    {error ? <Alert variant="destructive"><AlertTitle>Création impossible</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Client *"><ClientSelect value={state.clientId} onValueChange={(value) => update("clientId", value)} placeholder="Sélectionner le client" /></Field>
      <Field label="Date / heure souhaitée"><Input type="datetime-local" value={state.requestedAt} onChange={(event) => update("requestedAt", event.target.value)} /></Field>
      <Field label="Marchandise *"><Input value={state.cargo} onChange={(event) => update("cargo", event.target.value)} placeholder="Ex. EVA" /></Field>
      <Field label="Lieu de chargement *"><Input value={state.departure} onChange={(event) => update("departure", event.target.value)} placeholder="Ex. Abidjan" /></Field>
      <Field label="Destination"><Input value={state.destination} onChange={(event) => update("destination", event.target.value)} placeholder="Si connue" /></Field>
      <Field label="Référence"><Input value={state.reference} onChange={(event) => update("reference", event.target.value)} placeholder="Optionnelle" /></Field>
    </div>

    <details className="rounded-xl border border-border/80 p-4">
      <summary className="cursor-pointer font-medium">Affectation et tarif connus maintenant <span className="font-normal text-muted-foreground">(facultatif)</span></summary>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Véhicule"><VehicleSelect value={state.vehicleId} onValueChange={(value) => update("vehicleId", value)} /></Field>
        <Field label="Chauffeur"><DriverSelect value={state.driverId} onValueChange={(value) => update("driverId", value)} /></Field>
        <Field label="Poids réel (kg)"><Input type="number" min="0" value={state.weightKg} onChange={(event) => update("weightKg", event.target.value)} placeholder="À laisser vide si inconnu" /></Field>
        <Field label="Mode de tarification"><Select value={state.pricingMode} onValueChange={(value) => update("pricingMode", value as FormState["pricingMode"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNKNOWN">Non renseigné</SelectItem>{COURSE_PRICING_MODES.map((mode) => <SelectItem key={mode} value={mode}>{COURSE_PRICING_MODE_LABELS[mode]}</SelectItem>)}</SelectContent></Select></Field>
        {state.pricingMode === "PER_KG" || state.pricingMode === "PER_TONNE" ? <Field label={state.pricingMode === "PER_KG" ? "Tarif (FCFA/kg)" : "Tarif (FCFA/tonne)"}><Input type="number" min="0" value={state.unitRate} onChange={(event) => update("unitRate", event.target.value)} /></Field> : null}
        {state.pricingMode === "FLAT" ? <Field label="Montant forfaitaire (FCFA)"><Input type="number" min="0" value={state.flatAmount} onChange={(event) => update("flatAmount", event.target.value)} /></Field> : null}
        <div className="self-end rounded-lg bg-muted/50 px-3 py-2 text-sm"><span className="text-muted-foreground">Transport réel : </span><strong>{calculatedAmount === null ? "Non renseigné" : `${calculatedAmount.toLocaleString("fr-FR")} FCFA`}</strong></div>
      </div>
    </details>

    <Field label="Notes / instructions"><Textarea value={state.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Consignes utiles" /></Field>
    <div className="flex items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">Les données inconnues restent vides et pourront être complétées sur la fiche.</p><Button disabled={!state.clientId || !state.cargo.trim() || !state.departure.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Création…" : <><Check className="mr-2 size-4" />Créer la Course</>}</Button></div>
  </div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
