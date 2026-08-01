import { useMutation } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ClientSelect, DriverSelect, VehicleSelect } from "@/components/selects/entity-selects";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { COURSE_EXPENSE_CATEGORIES, COURSE_EXPENSE_CATEGORY_LABELS, createCourse, saveCourseBudgetLine, type CourseValues } from "@/lib/courses.functions";

type WizardState = {
  clientId: string; cargo: string; quantity: string; unit: string; weight: string; volume: string;
  departure: string; destination: string; distance: string; plannedDeparture: string; plannedArrival: string;
  vehicleId: string; driverId: string; amount: string; reference: string; notes: string;
  budget: Record<(typeof COURSE_EXPENSE_CATEGORIES)[number], string>;
};

const initialState: WizardState = {
  clientId: "", cargo: "", quantity: "", unit: "", weight: "", volume: "", departure: "", destination: "", distance: "", plannedDeparture: "", plannedArrival: "", vehicleId: "", driverId: "", amount: "", reference: "", notes: "", budget: { FUEL: "", ROAD: "", MEALS: "", MISC: "", EXCEPTIONAL_MAINTENANCE: "" },
};

const steps = ["Client", "Marchandise", "Itinéraire", "Affectation", "Budget", "Résumé"];
function optionalText(value: string) { return value.trim() || null; }
function optionalNumber(value: string) { return value.trim() ? Number(value) : null; }
function datetimeValue(value: string) { return value ? new Date(value).toISOString() : null; }

export function CourseWizard({ onSuccess }: { onSuccess: (courseId: string) => void }) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const update = <K extends keyof WizardState>(key: K, value: WizardState[K]) => setState((current) => ({ ...current, [key]: value }));
  const mutation = useMutation({
    mutationFn: async () => {
      const values: CourseValues = {
        client_id: state.clientId, vehicle_id: state.vehicleId || null, driver_id: state.driverId || null,
        departure_location: optionalText(state.departure), destination_location: optionalText(state.destination), cargo_description: optionalText(state.cargo), cargo_quantity: optionalNumber(state.quantity), cargo_unit: optionalText(state.unit), cargo_weight_kg: optionalNumber(state.weight), cargo_volume_m3: optionalNumber(state.volume), distance_km: optionalNumber(state.distance), planned_departure_at: datetimeValue(state.plannedDeparture), planned_arrival_at: datetimeValue(state.plannedArrival), actual_departure_at: null, actual_arrival_at: null, start_odometer: null, end_odometer: null, quoted_amount: Number(state.amount || 0), reference: optionalText(state.reference), notes: optionalText(state.notes), overlap_exception_reason: null,
      };
      const course = await createCourse({ data: values });
      for (const category of COURSE_EXPENSE_CATEGORIES) {
        const amount = optionalNumber(state.budget[category]);
        if (amount !== null && amount > 0) await saveCourseBudgetLine({ data: { missionId: course.id, category, plannedAmount: amount, notes: null } });
      }
      return course;
    },
    onSuccess: (course) => { toast.success("Course créée."); onSuccess(course.id); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Impossible de créer la Course."),
  });
  const canContinue = () => {
    if (step === 0) return Boolean(state.clientId);
    if (step === 2) return Boolean(state.departure.trim() && state.destination.trim());
    if (step === 3) return Boolean(state.vehicleId && state.driverId);
    if (step === 4) return Number(state.amount) >= 0;
    return true;
  };
  const content = [
    <div key="client" className="space-y-3"><Label>Client</Label><ClientSelect value={state.clientId} onValueChange={(value) => update("clientId", value)} placeholder="Sélectionner un client actif" /><p className="text-sm text-muted-foreground">Le client est sélectionné dans le référentiel existant : aucune information de contact n’est recopiée.</p></div>,
    <div key="cargo" className="grid gap-4 sm:grid-cols-2"><Field label="Marchandise"><Textarea value={state.cargo} onChange={(event) => update("cargo", event.target.value)} placeholder="Description de la marchandise" /></Field><Field label="Unité"><Input value={state.unit} onChange={(event) => update("unit", event.target.value)} placeholder="kg, sacs, colis…" /></Field><Field label="Quantité"><Input type="number" min="0" value={state.quantity} onChange={(event) => update("quantity", event.target.value)} /></Field><Field label="Poids (kg)"><Input type="number" min="0" value={state.weight} onChange={(event) => update("weight", event.target.value)} /></Field><Field label="Volume (m³)"><Input type="number" min="0" value={state.volume} onChange={(event) => update("volume", event.target.value)} /></Field></div>,
    <div key="route" className="grid gap-4 sm:grid-cols-2"><Field label="Départ"><Input value={state.departure} onChange={(event) => update("departure", event.target.value)} /></Field><Field label="Destination"><Input value={state.destination} onChange={(event) => update("destination", event.target.value)} /></Field><Field label="Distance prévue (km)"><Input type="number" min="0" value={state.distance} onChange={(event) => update("distance", event.target.value)} /></Field><Field label="Départ prévu"><Input type="datetime-local" value={state.plannedDeparture} onChange={(event) => update("plannedDeparture", event.target.value)} /></Field><Field label="Arrivée prévue"><Input type="datetime-local" value={state.plannedArrival} onChange={(event) => update("plannedArrival", event.target.value)} /></Field></div>,
    <div key="assignment" className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label>Véhicule</Label><VehicleSelect value={state.vehicleId} onValueChange={(value) => update("vehicleId", value)} /></div><div className="space-y-2"><Label>Chauffeur</Label><DriverSelect value={state.driverId} onValueChange={(value) => update("driverId", value)} /></div><p className="sm:col-span-2 text-sm text-muted-foreground">Une planification vérifie côté serveur les chevauchements avec les autres Courses. Une dérogation nécessite l’autorisation administrateur et reste auditée.</p></div>,
    <div key="budget" className="space-y-5"><Field label="Montant du transport (FCFA)"><Input type="number" min="0" required value={state.amount} onChange={(event) => update("amount", event.target.value)} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Référence"><Input value={state.reference} onChange={(event) => update("reference", event.target.value)} /></Field><Field label="Notes"><Input value={state.notes} onChange={(event) => update("notes", event.target.value)} /></Field></div><div><p className="text-sm font-medium">Budget prévisionnel par catégorie</p><p className="mt-1 text-sm text-muted-foreground">Le budget sert au pilotage uniquement. Il ne crée aucune écriture financière.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{COURSE_EXPENSE_CATEGORIES.map((category) => <Field key={category} label={COURSE_EXPENSE_CATEGORY_LABELS[category]}><Input type="number" min="0" value={state.budget[category]} onChange={(event) => update("budget", { ...state.budget, [category]: event.target.value })} /></Field>)}</div></div></div>,
    <div key="summary" className="space-y-4"><div className="rounded-xl border bg-muted/40 p-4"><p className="font-semibold">Prête à créer</p><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><Summary label="Client" value={state.clientId ? "Client sélectionné" : "—"} /><Summary label="Marchandise" value={state.cargo || "Non renseignée"} /><Summary label="Itinéraire" value={[state.departure, state.destination].filter(Boolean).join(" → ") || "Non renseigné"} /><Summary label="Affectation" value={state.vehicleId && state.driverId ? "Véhicule et chauffeur sélectionnés" : "À compléter"} /><Summary label="Transport" value={`${Number(state.amount || 0).toLocaleString("fr-FR")} FCFA`} /><Summary label="Budget prévu" value={`${Object.values(state.budget).reduce((sum, value) => sum + Number(value || 0), 0).toLocaleString("fr-FR")} FCFA`} /></dl></div><p className="text-sm text-muted-foreground">La création enregistre une Course en brouillon. Les dépenses, facture et paiements seront validés séparément selon les permissions.</p></div>,
  ][step];
  return <div className="space-y-6"><ol className="grid grid-cols-3 gap-2 sm:grid-cols-6">{steps.map((label, index) => <li key={label} className={`rounded-lg border px-2 py-2 text-center text-xs ${index === step ? "border-primary bg-primary/10 font-semibold text-primary" : index < step ? "border-success/30 bg-success/5 text-success" : "text-muted-foreground"}`}>{index < step ? <Check className="mx-auto mb-1 size-3.5" aria-hidden="true" /> : <span className="mb-1 block">{index + 1}</span>}{label}</li>)}</ol>{error ? <Alert variant="destructive"><AlertTitle>Création impossible</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}<div className="min-h-48">{content}</div><div className="flex items-center justify-between gap-3 border-t pt-5"><Button variant="outline" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || mutation.isPending}><ChevronLeft className="mr-1 size-4" />Précédent</Button>{step < steps.length - 1 ? <Button onClick={() => canContinue() ? setStep((current) => current + 1) : setError("Complétez les informations obligatoires avant de continuer.")}><ChevronRight className="mr-1 size-4" />Continuer</Button> : <Button disabled={mutation.isPending || !canContinue()} onClick={() => mutation.mutate()}>{mutation.isPending ? "Création…" : <><Check className="mr-1 size-4" />Créer la Course</>}</Button>}</div></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function Summary({ label, value }: { label: string; value: string }) { return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>; }
