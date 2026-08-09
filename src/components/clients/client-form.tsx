import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createClient,
  detectClientDuplicates,
  type Client,
  type ClientDuplicate,
  type ClientValues,
  updateClient,
} from "@/lib/clients.functions";

type Props = {
  client?: Client | null;
  onSuccess: () => void;
};

type ClientFormState = {
  kind: "ORGANIZATION" | "INDIVIDUAL";
  displayName: string;
  legalName: string;
  city: string;
  address: string;
  telephone: string;
  email: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  identifierType: "RCCM" | "NONE";
  identifierValue: string;
  notes: string;
};

function fromClient(client?: Client | null): ClientFormState {
  return {
    kind: client?.kind === "INDIVIDUAL" ? "INDIVIDUAL" : "ORGANIZATION",
    displayName: client?.display_name ?? "",
    legalName: client?.legal_name ?? "",
    city: client?.city ?? "",
    address: client?.address ?? "",
    telephone: client?.telephone ?? "",
    email: client?.email ?? "",
    contactName: client?.contact_name ?? "",
    contactPhone: client?.contact_phone ?? "",
    contactEmail: client?.contact_email ?? "",
    identifierType: client?.registration_identifier_type === "RCCM"
      ? client.registration_identifier_type
      : "NONE",
    identifierValue: client?.registration_identifier_value ?? "",
    notes: client?.notes ?? "",
  };
}

function optionalValue(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function toValues(form: ClientFormState): ClientValues {
  return {
    kind: form.kind,
    display_name: form.displayName.trim(),
    legal_name: optionalValue(form.legalName),
    city: optionalValue(form.city),
    address: optionalValue(form.address),
    telephone: optionalValue(form.telephone),
    email: optionalValue(form.email),
    contact_name: optionalValue(form.contactName),
    contact_phone: optionalValue(form.contactPhone),
    contact_email: optionalValue(form.contactEmail),
    registration_identifier_type: form.identifierType === "NONE" ? null : form.identifierType,
    registration_identifier_value: form.identifierType === "NONE" ? null : optionalValue(form.identifierValue),
    notes: optionalValue(form.notes),
  };
}

function duplicateMessage(duplicate: ClientDuplicate) {
  return `${duplicate.display_name} · ${duplicate.matched_fields.join(", ")}`;
}

export function ClientForm({ client, onSuccess }: Props) {
  const [form, setForm] = useState<ClientFormState>(() => fromClient(client));
  const [duplicates, setDuplicates] = useState<ClientDuplicate[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(fromClient(client));
    setDuplicates([]);
    setError(null);
  }, [client]);

  const duplicateMutation = useMutation({
    mutationFn: (values: ClientValues) => detectClientDuplicates({
      data: { values, excludeClientId: client?.id ?? null },
    }),
    onSuccess: setDuplicates,
    onError: () => setError("La vérification des doublons est momentanément indisponible."),
  });

  const saveMutation = useMutation({
    mutationFn: async (values: ClientValues) => {
      if (client) return updateClient({ data: { id: client.id, values } });
      return createClient({ data: values });
    },
    onSuccess: () => {
      toast.success(client ? "Client modifié." : "Client créé.");
      onSuccess();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : "Impossible d’enregistrer le client.");
    },
  });

  async function checkDuplicates(): Promise<ClientDuplicate[] | null> {
    setError(null);
    const values = toValues(form);
    if (!values.display_name) {
      setError("Le nom ou la raison sociale est obligatoire.");
      return null;
    }
    try {
      return await duplicateMutation.mutateAsync(values);
    } catch {
      return null;
    }
  }

  async function save() {
    setError(null);
    const values = toValues(form);
    if (!values.display_name) {
      setError("Le nom ou la raison sociale est obligatoire.");
      return;
    }
    if (!client) {
      const foundDuplicates = await checkDuplicates();
      if (foundDuplicates === null) return;
      if (foundDuplicates.length > 0 && !window.confirm("Des clients similaires existent déjà. Créer tout de même ce client ?")) {
        return;
      }
    }
    saveMutation.mutate(values);
  }

  const saving = saveMutation.isPending || duplicateMutation.isPending;

  return (
    <div className="space-y-5">
      {error ? <Alert variant="destructive"><AlertTitle>Action impossible</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {duplicates.length > 0 ? (
        <Alert>
          <AlertTitle>Doublons potentiels détectés</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {duplicates.map((duplicate) => <li key={duplicate.id}>{duplicateMessage(duplicate)}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="client-kind">Type</Label><Select value={form.kind} onValueChange={(value) => setForm((current) => ({ ...current, kind: value === "INDIVIDUAL" ? "INDIVIDUAL" : "ORGANIZATION" }))}><SelectTrigger id="client-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ORGANIZATION">Organisation</SelectItem><SelectItem value="INDIVIDUAL">Personne physique</SelectItem></SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="client-display-name">Nom / société</Label><Input id="client-display-name" value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} /></div>
        <div className="space-y-2"><Label htmlFor="client-legal-name">Raison sociale</Label><Input id="client-legal-name" value={form.legalName} onChange={(event) => setForm((current) => ({ ...current, legalName: event.target.value }))} /></div>
        <div className="space-y-2"><Label htmlFor="client-city">Ville</Label><Input id="client-city" value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} /></div>
      </div>

      <div className="space-y-2"><Label htmlFor="client-address">Adresse</Label><Textarea id="client-address" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} /></div>

      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="client-phone">Téléphone</Label><Input id="client-phone" inputMode="tel" value={form.telephone} onChange={(event) => setForm((current) => ({ ...current, telephone: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="client-email">E-mail</Label><Input id="client-email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></div></div>

      <div className="rounded-lg border p-4"><p className="mb-3 text-sm font-medium">Contact principal</p><div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor="client-contact-name">Nom</Label><Input id="client-contact-name" value={form.contactName} onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="client-contact-phone">Téléphone</Label><Input id="client-contact-phone" inputMode="tel" value={form.contactPhone} onChange={(event) => setForm((current) => ({ ...current, contactPhone: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="client-contact-email">E-mail</Label><Input id="client-contact-email" type="email" value={form.contactEmail} onChange={(event) => setForm((current) => ({ ...current, contactEmail: event.target.value }))} /></div></div></div>

      <div className="rounded-lg border p-4"><p className="mb-3 text-sm font-medium">Informations légales — Côte d’Ivoire</p><div className="grid gap-4 sm:grid-cols-[minmax(0,0.45fr)_minmax(0,0.55fr)]"><div className="space-y-2"><Label>Type</Label><Select value={form.identifierType} onValueChange={(value) => setForm((current) => ({ ...current, identifierType: value === "RCCM" ? value : "NONE", identifierValue: value === "NONE" ? "" : current.identifierValue }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NONE">Non renseigné</SelectItem><SelectItem value="RCCM">RCCM</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="client-identifier">Valeur</Label><Input id="client-identifier" disabled={form.identifierType === "NONE"} value={form.identifierValue} onChange={(event) => setForm((current) => ({ ...current, identifierValue: event.target.value }))} /></div></div><p className="mt-3 text-xs text-muted-foreground">Le RCCM est facultatif. Son format reste contrôlé par la règle configurée côté serveur.</p></div>

      <div className="space-y-2"><Label htmlFor="client-notes">Notes internes</Label><Textarea id="client-notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></div>

      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" type="button" disabled={saving} onClick={() => { void checkDuplicates(); }}>Vérifier les doublons</Button><Button type="button" disabled={saving} onClick={() => { void save(); }}>{saving ? "Enregistrement…" : client ? "Enregistrer les modifications" : "Créer le client"}</Button></div>
    </div>
  );
}
