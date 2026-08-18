import { useState } from "react";
import { toast } from "sonner";

import { EmployeeSelect, DriverSelect, FarmSelect, MotorcycleSelect, VehicleSelect } from "@/components/selects/entity-selects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createContract } from "@/lib/contracts.functions";

export function ContractForm({ onSuccess }: { onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ reference: "", type: "", partie: "", date_debut: "", date_fin: "", montant: "", statut: "ACTIF", description: "", employee_id: "", driver_id: "", vehicle_id: "", motorcycle_id: "", farm_id: "" });
  const save = async () => {
    try {
      setLoading(true);
      await createContract({ data: { contract: { reference: form.reference || null, type: form.type || null, partie: form.partie || null, date_debut: form.date_debut || null, date_fin: form.date_fin || null, montant: form.montant ? Number(form.montant) : null, statut: form.statut || null, description: form.description || null }, relations: { employee_ids: form.employee_id ? [form.employee_id] : [], driver_ids: form.driver_id ? [form.driver_id] : [], vehicle_ids: form.vehicle_id ? [form.vehicle_id] : [], motorcycle_ids: form.motorcycle_id ? [form.motorcycle_id] : [], farm_ids: form.farm_id ? [form.farm_id] : [] } } });
      toast.success("Contrat créé.");
      onSuccess();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Impossible de créer le contrat."); }
    finally { setLoading(false); }
  };
  return <div className="space-y-4"><div className="grid gap-4 md:grid-cols-2"><div><Label htmlFor="contract-reference">Référence</Label><Input id="contract-reference" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></div><div><Label htmlFor="contract-type">Type</Label><Input id="contract-type" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} /></div><div><Label htmlFor="contract-partie">Partie</Label><Input id="contract-partie" value={form.partie} onChange={(event) => setForm({ ...form, partie: event.target.value })} /></div><div><Label htmlFor="contract-montant">Montant (FCFA)</Label><Input id="contract-montant" type="number" min="0" value={form.montant} onChange={(event) => setForm({ ...form, montant: event.target.value })} /></div><div><Label htmlFor="contract-date-debut">Début</Label><Input id="contract-date-debut" type="date" value={form.date_debut} onChange={(event) => setForm({ ...form, date_debut: event.target.value })} /></div><div><Label htmlFor="contract-date-fin">Fin</Label><Input id="contract-date-fin" type="date" value={form.date_fin} onChange={(event) => setForm({ ...form, date_fin: event.target.value })} /></div></div><div className="grid gap-4 md:grid-cols-2"><div><Label htmlFor="contract-employee">Employé lié</Label><EmployeeSelect id="contract-employee" value={form.employee_id} onValueChange={(employee_id) => setForm({ ...form, employee_id })} /></div><div><Label htmlFor="contract-driver">Chauffeur lié</Label><DriverSelect id="contract-driver" value={form.driver_id} onValueChange={(driver_id) => setForm({ ...form, driver_id })} /></div><div><Label htmlFor="contract-vehicle">Véhicule lié</Label><VehicleSelect id="contract-vehicle" value={form.vehicle_id} onValueChange={(vehicle_id) => setForm({ ...form, vehicle_id })} /></div><div><Label htmlFor="contract-motorcycle">Moto liée</Label><MotorcycleSelect id="contract-motorcycle" value={form.motorcycle_id} onValueChange={(motorcycle_id) => setForm({ ...form, motorcycle_id })} /></div><div className="md:col-span-2"><Label htmlFor="contract-farm">Exploitation liée</Label><FarmSelect id="contract-farm" value={form.farm_id} onValueChange={(farm_id) => setForm({ ...form, farm_id })} /></div></div><div><Label htmlFor="contract-description">Description</Label><Textarea id="contract-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div><Button className="w-full" disabled={loading} onClick={save}>{loading ? "Création…" : "Créer le contrat"}</Button></div>;
}
