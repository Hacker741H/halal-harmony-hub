import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WalletSelect } from "@/components/selects/entity-selects";
import {
  createVehicle,
  updateVehicle,
  VEHICLE_STATUSES,
  VEHICLE_STATUS_LABELS,
  type Vehicle,
  type VehicleStatus,
  type VehicleValues,
} from "@/lib/vehicles.functions";
import { getWallets } from "@/lib/wallet.functions";
import { getDrivers, type DriverWithEmployee } from "@/lib/drivers.functions";

type Props = {
  vehicle?: Vehicle | null;
  onSuccess: () => void;
};

type VehicleFormState = {
  registration: string;
  brand: string;
  chassis_number: string;
  model: string;
  type: string;
  color: string;
  year: string;
  kilometrage: string;
  status: VehicleStatus;
  purchase_price: string;
  purchase_date: string;
  purchase_wallet_id: string;
  supplier: string;
  driver_id: string;
  engine_number: string;
  description: string;
  photo_url: string;
};

function emptyForm(): VehicleFormState {
  return {
    registration: "",
    brand: "",
    chassis_number: "",
    model: "",
    type: "",
    color: "",
    year: "",
    kilometrage: "0",
    status: "EN_SERVICE",
    purchase_price: "",
    purchase_date: new Date().toISOString().slice(0, 10),
    purchase_wallet_id: "",
    supplier: "",
    driver_id: "",
    engine_number: "",
    description: "",
    photo_url: "",
  };
}

function toVehicleForm(vehicle: Vehicle): VehicleFormState {
  return {
    registration: vehicle.registration,
    brand: vehicle.brand ?? "",
    chassis_number: vehicle.chassis_number ?? "",
    model: vehicle.model ?? "",
    type: vehicle.type ?? "",
    color: vehicle.color ?? "",
    year: vehicle.year?.toString() ?? "",
    kilometrage: vehicle.kilometrage?.toString() ?? "0",
    status: VEHICLE_STATUSES.includes(vehicle.status as VehicleStatus)
      ? (vehicle.status as VehicleStatus)
      : "EN_SERVICE",
    purchase_price: vehicle.purchase_price?.toString() ?? "",
    purchase_date: vehicle.purchase_date ?? new Date().toISOString().slice(0, 10),
    purchase_wallet_id: vehicle.purchase_wallet_id ?? "",
    supplier: vehicle.supplier ?? "",
    driver_id: vehicle.driver_id ?? "",
    engine_number: vehicle.engine_number ?? "",
    description: vehicle.description ?? "",
    photo_url: vehicle.photo_url ?? "",
  };
}

function optionalText(value: string) {
  return value.trim() || null;
}

export default function VehicleForm({ vehicle, onSuccess }: Props) {
  const { data: wallets = [] } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => getWallets(),
  });
  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => getDrivers(),
  });
  const [form, setForm] = useState<VehicleFormState>(emptyForm);
  const [loading, setLoading] = useState(false);
  const isEditing = Boolean(vehicle);

  useEffect(() => {
    setForm(vehicle ? toVehicleForm(vehicle) : emptyForm());
  }, [vehicle]);

  async function save() {
    if (!form.registration.trim()) {
      toast.error("L'immatriculation est obligatoire.");
      return;
    }

    if (!form.brand.trim()) {
      toast.error("La marque est obligatoire.");
      return;
    }

    if (!form.model.trim()) {
      toast.error("Le modèle est obligatoire.");
      return;
    }

    const purchasePrice = form.purchase_price
      ? Number(form.purchase_price)
      : null;

    if (purchasePrice && !form.purchase_wallet_id) {
      toast.error("Sélectionnez le wallet utilisé pour l'achat.");
      return;
    }

    const values: VehicleValues = {
      registration: form.registration.trim(),
      brand: optionalText(form.brand),
      chassis_number: optionalText(form.chassis_number),
      model: optionalText(form.model),
      type: optionalText(form.type),
      color: optionalText(form.color),
      year: form.year ? Number(form.year) : null,
      kilometrage: form.kilometrage ? Number(form.kilometrage) : null,
      status: form.status,
      purchase_price: purchasePrice,
      purchase_date: form.purchase_date || null,
      purchase_wallet_id: form.purchase_wallet_id || null,
      supplier: optionalText(form.supplier),
      driver_id: form.driver_id || null,
      engine_number: optionalText(form.engine_number),
      description: optionalText(form.description),
      photo_url: optionalText(form.photo_url),
    };

    try {
      setLoading(true);

      if (isEditing && vehicle) {
        await updateVehicle({
          data: {
            id: vehicle.id,
            values,
          },
        });
        toast.success("Véhicule mis à jour.");
      } else {
        await createVehicle({ data: values });
        toast.success("Véhicule créé.");
      }

      onSuccess();
    } catch (error: unknown) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Impossible d'enregistrer le véhicule.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border p-5">
        <h2 className="mb-4 text-lg font-bold">Informations générales</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="vehicle-registration">Immatriculation *</Label>
            <Input id="vehicle-registration" value={form.registration} onChange={(event) => setForm({ ...form, registration: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="vehicle-brand">Marque *</Label>
            <Input id="vehicle-brand" value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="vehicle-model">Modèle *</Label>
            <Input id="vehicle-model" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="vehicle-type">Type</Label>
            <Input id="vehicle-type" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="vehicle-year">Année</Label>
            <Input id="vehicle-year" type="number" min="1886" value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="vehicle-kilometrage">Kilométrage</Label>
            <Input id="vehicle-kilometrage" type="number" min="0" value={form.kilometrage} onChange={(event) => setForm({ ...form, kilometrage: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="vehicle-color">Couleur</Label>
            <Input id="vehicle-color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="vehicle-status">Statut</Label>
            <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as VehicleStatus })}>
              <SelectTrigger id="vehicle-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VEHICLE_STATUSES.map((status) => <SelectItem key={status} value={status}>{VEHICLE_STATUS_LABELS[status]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="vehicle-chassis-number">Numéro de châssis</Label>
            <Input id="vehicle-chassis-number" value={form.chassis_number} onChange={(event) => setForm({ ...form, chassis_number: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="vehicle-engine-number">Numéro moteur</Label>
            <Input id="vehicle-engine-number" value={form.engine_number} onChange={(event) => setForm({ ...form, engine_number: event.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="vehicle-driver">Chauffeur affecté</Label>
            <Select value={form.driver_id || undefined} disabled>
              <SelectTrigger id="vehicle-driver">
                <SelectValue placeholder="Aucun chauffeur affecté" />
              </SelectTrigger>
              <SelectContent>
                {drivers.map((driver: DriverWithEmployee) => (
                  <SelectItem key={driver.id} value={driver.id}>
                    {[driver.employees?.nom, driver.employees?.prenom].filter(Boolean).join(" ") || "Chauffeur sans nom"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="rounded-xl border p-5">
        <h2 className="mb-4 text-lg font-bold">Achat du véhicule</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="vehicle-purchase-price">Prix d'achat (FCFA)</Label>
            <Input id="vehicle-purchase-price" type="number" min="0" value={form.purchase_price} onChange={(event) => setForm({ ...form, purchase_price: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="vehicle-purchase-date">Date d'achat</Label>
            <Input id="vehicle-purchase-date" type="date" value={form.purchase_date} onChange={(event) => setForm({ ...form, purchase_date: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="vehicle-purchase-wallet">Wallet de paiement</Label>
            <WalletSelect
              id="vehicle-purchase-wallet"
              value={form.purchase_wallet_id}
              onValueChange={(value) => setForm({ ...form, purchase_wallet_id: value })}
              placeholder="Choisir…"
            />
          </div>
          <div>
            <Label htmlFor="vehicle-supplier">Fournisseur</Label>
            <Input id="vehicle-supplier" value={form.supplier} onChange={(event) => setForm({ ...form, supplier: event.target.value })} />
          </div>
        </div>
      </section>

      <section className="rounded-xl border p-5">
        <h2 className="mb-4 text-lg font-bold">Description et photo</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="vehicle-photo">URL de la photo</Label>
            <Input id="vehicle-photo" type="url" value={form.photo_url} onChange={(event) => setForm({ ...form, photo_url: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="vehicle-description">Description</Label>
            <Textarea id="vehicle-description" rows={4} placeholder="Description du véhicule…" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-muted/30 p-5">
        <h2 className="text-lg font-bold">Résumé financier</h2>
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-4"><span>Prix d'achat</span><span className="font-semibold">{Number(form.purchase_price || 0).toLocaleString("fr-FR")} FCFA</span></div>
          <div className="flex justify-between gap-4"><span>Wallet</span><span>{wallets.find((wallet) => wallet.id === form.purchase_wallet_id)?.name ?? "-"}</span></div>
          <div className="flex justify-between gap-4"><span>Fournisseur</span><span>{form.supplier || "-"}</span></div>
        </div>
      </section>

      <Button className="w-full" disabled={loading} onClick={save}>
        {loading ? (isEditing ? "Mise à jour…" : "Création…") : (isEditing ? "Mettre à jour le véhicule" : "Créer le véhicule")}
      </Button>
    </div>
  );
}
