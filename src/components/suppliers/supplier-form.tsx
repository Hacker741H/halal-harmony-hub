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
  SUPPLIER_COUNTRY_CODES,
  createSupplier,
  detectSupplierDuplicates,
  updateSupplier,
  type Supplier,
  type SupplierDuplicate,
  type SupplierValues,
} from "@/lib/suppliers.functions";

const COUNTRY_LABELS: Record<(typeof SUPPLIER_COUNTRY_CODES)[number], string> = {
  CI: "Côte d’Ivoire",
  SN: "Sénégal",
};

type Props = {
  supplier?: Supplier | null;
  onSuccess: () => void;
};

type SupplierFormState = {
  displayName: string;
  legalName: string;
  countryCode: (typeof SUPPLIER_COUNTRY_CODES)[number];
  city: string;
  address: string;
  telephone: string;
  email: string;
  notes: string;
};

function fromSupplier(supplier?: Supplier | null): SupplierFormState {
  return {
    displayName: supplier?.display_name ?? "",
    legalName: supplier?.legal_name ?? "",
    countryCode: (SUPPLIER_COUNTRY_CODES as readonly string[]).includes(supplier?.country_code ?? "")
      ? (supplier!.country_code as (typeof SUPPLIER_COUNTRY_CODES)[number])
      : "CI",
    city: supplier?.city ?? "",
    address: supplier?.address ?? "",
    telephone: supplier?.telephone ?? "",
    email: supplier?.email ?? "",
    notes: supplier?.notes ?? "",
  };
}

function optionalValue(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function toValues(form: SupplierFormState): SupplierValues {
  return {
    display_name: form.displayName.trim(),
    legal_name: optionalValue(form.legalName),
    country_code: form.countryCode,
    city: optionalValue(form.city),
    address: optionalValue(form.address),
    telephone: optionalValue(form.telephone),
    email: optionalValue(form.email),
    notes: optionalValue(form.notes),
  };
}

function duplicateMessage(duplicate: SupplierDuplicate) {
  return `${duplicate.display_name} · ${duplicate.matched_fields.join(", ")}`;
}

export function SupplierForm({ supplier, onSuccess }: Props) {
  const [form, setForm] = useState<SupplierFormState>(() => fromSupplier(supplier));
  const [duplicates, setDuplicates] = useState<SupplierDuplicate[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(fromSupplier(supplier));
    setDuplicates([]);
    setError(null);
  }, [supplier]);

  const duplicateMutation = useMutation({
    mutationFn: (values: SupplierValues) => detectSupplierDuplicates({
      data: { values, excludeSupplierId: supplier?.id ?? null },
    }),
    onSuccess: setDuplicates,
    onError: () => setError("La vérification des doublons est momentanément indisponible."),
  });

  const saveMutation = useMutation({
    mutationFn: async (values: SupplierValues) => {
      if (supplier) return updateSupplier({ data: { id: supplier.id, values } });
      return createSupplier({ data: values });
    },
    onSuccess: () => {
      toast.success(supplier ? "Fournisseur modifié." : "Fournisseur créé.");
      onSuccess();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : "Impossible d’enregistrer le fournisseur.");
    },
  });

  async function checkDuplicates(): Promise<SupplierDuplicate[] | null> {
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
    if (!supplier) {
      const foundDuplicates = await checkDuplicates();
      if (foundDuplicates === null) return;
      if (foundDuplicates.length > 0 && !window.confirm("Des fournisseurs similaires existent déjà. Créer tout de même ce fournisseur ?")) {
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
        <div className="space-y-2"><Label htmlFor="supplier-display-name">Nom / société</Label><Input id="supplier-display-name" value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} /></div>
        <div className="space-y-2"><Label htmlFor="supplier-legal-name">Raison sociale</Label><Input id="supplier-legal-name" value={form.legalName} onChange={(event) => setForm((current) => ({ ...current, legalName: event.target.value }))} /></div>
        <div className="space-y-2"><Label htmlFor="supplier-country">Pays</Label><Select value={form.countryCode} onValueChange={(value) => setForm((current) => ({ ...current, countryCode: value === "SN" ? "SN" : "CI" }))}><SelectTrigger id="supplier-country"><SelectValue /></SelectTrigger><SelectContent>{SUPPLIER_COUNTRY_CODES.map((code) => <SelectItem key={code} value={code}>{COUNTRY_LABELS[code]}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="supplier-city">Ville</Label><Input id="supplier-city" value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} /></div>
      </div>

      <div className="space-y-2"><Label htmlFor="supplier-address">Adresse</Label><Textarea id="supplier-address" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} /></div>

      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="supplier-phone">Téléphone</Label><Input id="supplier-phone" inputMode="tel" value={form.telephone} onChange={(event) => setForm((current) => ({ ...current, telephone: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="supplier-email">E-mail</Label><Input id="supplier-email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></div></div>

      <div className="space-y-2"><Label htmlFor="supplier-notes">Notes internes</Label><Textarea id="supplier-notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></div>

      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" type="button" disabled={saving} onClick={() => { void checkDuplicates(); }}>Vérifier les doublons</Button><Button type="button" disabled={saving} onClick={() => { void save(); }}>{saving ? "Enregistrement…" : supplier ? "Enregistrer les modifications" : "Créer le fournisseur"}</Button></div>
    </div>
  );
}
