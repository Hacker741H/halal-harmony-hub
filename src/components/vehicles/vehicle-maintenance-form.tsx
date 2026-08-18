import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createVehicleMaintenance,
  getVehicleMaintenanceFinanceOperation,
  updateVehicleMaintenance,
  type VehicleMaintenance,
} from "@/lib/vehicles.functions";
import { getWallets } from "@/lib/wallet.functions";

type Props = {
  vehicleId: string;
  maintenance?: VehicleMaintenance | null;
  onSuccess: () => void;
  onCancel: () => void;
};

export function VehicleMaintenanceForm({
  vehicleId,
  maintenance,
  onSuccess,
  onCancel,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState(maintenance?.date ?? "");
  const [type, setType] = useState(maintenance?.type ?? "");
  const [cost, setCost] = useState(maintenance?.cout?.toString() ?? "");
  const [kilometrage, setKilometrage] = useState(
    maintenance?.kilometrage?.toString() ?? "",
  );
  const [provider, setProvider] = useState(maintenance?.prestataire ?? "");
  const [notes, setNotes] = useState(maintenance?.notes ?? "");
  const [walletId, setWalletId] = useState("");

  const { data: wallets = [] } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => getWallets(),
  });

  const { data: financeOperation } = useQuery({
    queryKey: ["vehicle-maintenance-finance", maintenance?.id],
    queryFn: () =>
      getVehicleMaintenanceFinanceOperation({ data: maintenance!.id }),
    enabled: Boolean(maintenance),
  });

  useEffect(() => {
    setWalletId(financeOperation?.wallet_id ?? "");
  }, [financeOperation?.wallet_id]);

  async function save() {
    const numericCost = cost ? Number(cost) : 0;
    const numericKilometrage = kilometrage ? Number(kilometrage) : null;

    if (!date || !type.trim()) {
      toast.error("La date et le type d'entretien sont obligatoires.");
      return;
    }
    if (!Number.isFinite(numericCost) || numericCost < 0) {
      toast.error("Le coût doit être un montant valide.");
      return;
    }
    if (
      numericKilometrage !== null &&
      (!Number.isInteger(numericKilometrage) || numericKilometrage < 0)
    ) {
      toast.error("Le kilométrage doit être un entier positif.");
      return;
    }
    if (numericCost > 0 && !walletId) {
      toast.error("Sélectionnez le wallet qui règle cet entretien.");
      return;
    }

    const values = {
      vehicle_id: vehicleId,
      date,
      type: type.trim(),
      cout: numericCost,
      kilometrage: numericKilometrage,
      prestataire: provider.trim() || null,
      notes: notes.trim() || null,
      wallet_id: numericCost > 0 ? walletId : null,
    };

    try {
      setLoading(true);
      if (maintenance) {
        await updateVehicleMaintenance({
          data: { id: maintenance.id, ...values },
        });
      } else {
        await createVehicleMaintenance({ data: values });
      }
      onSuccess();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Impossible d'enregistrer l'entretien.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div>
          <Label>Type d'entretien</Label>
          <Input value={type} onChange={(event) => setType(event.target.value)} />
        </div>
        <div>
          <Label>Coût (FCFA)</Label>
          <Input type="number" min="0" value={cost} onChange={(event) => setCost(event.target.value)} />
        </div>
        <div>
          <Label>Wallet de paiement</Label>
          <select
            className="w-full rounded-md border px-3 py-2"
            value={walletId}
            disabled={Number(cost || 0) <= 0}
            onChange={(event) => setWalletId(event.target.value)}
          >
            <option value="">Sélectionner un wallet</option>
            {wallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Une dépense sera créée automatiquement si le coût est supérieur à zéro.
          </p>
        </div>
        <div>
          <Label>Kilométrage</Label>
          <Input type="number" min="0" value={kilometrage} onChange={(event) => setKilometrage(event.target.value)} />
        </div>
        <div>
          <Label>Prestataire</Label>
          <Input value={provider} onChange={(event) => setProvider(event.target.value)} />
        </div>
      </div>

      <div>
        <Label>Notes</Label>
        <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Annuler
        </Button>
        <Button type="button" onClick={save} disabled={loading}>
          {loading ? "Enregistrement..." : maintenance ? "Mettre à jour" : "Ajouter l'entretien"}
        </Button>
      </div>
    </div>
  );
}
