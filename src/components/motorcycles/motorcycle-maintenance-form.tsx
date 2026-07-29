import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  createMotorcycleMaintenance,
  getMotorcycleMaintenanceFinanceOperation,
  updateMotorcycleMaintenance,
  type MotorcycleMaintenance,
} from "@/lib/motorcycle-maintenances.functions";
import { getWallets } from "@/lib/wallet.functions";

type Props = {
  motorcycleId: string;
  maintenance?: MotorcycleMaintenance | null;
  onSuccess: () => void;
  onCancel: () => void;
};

export function MotorcycleMaintenanceForm({
  motorcycleId,
  maintenance,
  onSuccess,
  onCancel,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [type, setType] = useState(
    maintenance?.type ?? "Vidange",
  );

  const [maintenanceDate, setMaintenanceDate] = useState(
    maintenance?.maintenance_date ?? "",
  );

  const [kilometrage, setKilometrage] = useState(
    maintenance?.kilometrage?.toString() ?? "",
  );

  const [cost, setCost] = useState(
    maintenance?.cost?.toString() ?? "",
  );

  const [garage, setGarage] = useState(
    maintenance?.garage ?? "",
  );

  const [nextDate, setNextDate] = useState(
    maintenance?.next_date ?? "",
  );

  const [nextKilometrage, setNextKilometrage] = useState(
    maintenance?.next_kilometrage?.toString() ?? "",
  );

  const [description, setDescription] = useState(
    maintenance?.description ?? "",
  );

  const [walletId, setWalletId] = useState("");

  const { data: wallets = [] } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => getWallets(),
  });

  const { data: financeOperation } = useQuery({
    queryKey: ["motorcycle-maintenance-finance", maintenance?.id],
    queryFn: () =>
      getMotorcycleMaintenanceFinanceOperation({ data: maintenance!.id }),
    enabled: Boolean(maintenance),
  });

  useEffect(() => {
    setWalletId(financeOperation?.wallet_id ?? "");
  }, [financeOperation?.wallet_id]);

  async function save() {
    if (!maintenanceDate) {
      alert("La date est obligatoire.");
      return;
    }

    const numericCost = cost ? Number(cost) : 0;
    if (!Number.isFinite(numericCost) || numericCost < 0) {
      alert("Le coût doit être un montant valide.");
      return;
    }
    if (numericCost > 0 && !walletId) {
      alert("Sélectionnez le wallet réglant cet entretien.");
      return;
    }

    try {
      setLoading(true);

      const payload = {
        motorcycle_id: motorcycleId,
        type,
        maintenance_date: maintenanceDate,
        kilometrage: kilometrage
          ? Number(kilometrage)
          : null,
        cost: numericCost,
        garage: garage || null,
        next_date: nextDate || null,
        next_kilometrage: nextKilometrage
          ? Number(nextKilometrage)
          : null,
        description: description || null,
        wallet_id: numericCost > 0 ? walletId : null,
      };

      if (maintenance) {
        await updateMotorcycleMaintenance({
          data: {
            id: maintenance.id,
            ...payload,
          },
        });
      } else {
        await createMotorcycleMaintenance({
          data: payload,
        });
      }

      onSuccess();
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error
          ? error.message
          :
          "Une erreur est survenue.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">

        <div>
          <Label>Type d'entretien</Label>

          <select
            className="w-full rounded-md border px-3 py-2"
            value={type}
            onChange={(e) =>
              setType(e.target.value)
            }
          >
            <option>Vidange</option>
            <option>Pneus</option>
            <option>Freins</option>
            <option>Chaîne</option>
            <option>Batterie</option>
            <option>Assurance</option>
            <option>Visite technique</option>
            <option>Réparation</option>
            <option>Autre</option>
          </select>
        </div>

        <div>
          <Label>Date</Label>

          <Input
            type="date"
            value={maintenanceDate}
            onChange={(e) =>
              setMaintenanceDate(
                e.target.value,
              )
            }
          />
        </div>

        <div>
          <Label>Kilométrage</Label>

          <Input
            type="number"
            value={kilometrage}
            onChange={(e) =>
              setKilometrage(
                e.target.value,
              )
            }
          />
        </div>

        <div>
          <Label>Coût (FCFA)</Label>

          <Input
            type="number"
            value={cost}
            onChange={(e) =>
              setCost(e.target.value)
            }
          />
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
              <option key={wallet.id} value={wallet.id}>
                {wallet.name}
              </option>
            ))}
          </select>

          <p className="mt-1 text-xs text-muted-foreground">
            Une dépense sera créée automatiquement si le coût est supérieur à zéro.
          </p>
        </div>

        <div>
          <Label>Garage</Label>

          <Input
            value={garage}
            onChange={(e) =>
              setGarage(e.target.value)
            }
          />
        </div>

        <div>
          <Label>Prochaine date</Label>

          <Input
            type="date"
            value={nextDate}
            onChange={(e) =>
              setNextDate(
                e.target.value,
              )
            }
          />
        </div>

        <div>
          <Label>Prochain kilométrage</Label>

          <Input
            type="number"
            value={nextKilometrage}
            onChange={(e) =>
              setNextKilometrage(
                e.target.value,
              )
            }
          />
        </div>

      </div>

      <div className="border rounded-lg p-4 space-y-4">

        <h3 className="font-semibold">
          Description
        </h3>

        <Textarea
          rows={5}
          placeholder="Description de l'entretien..."
          value={description}
          onChange={(e) =>
            setDescription(
              e.target.value,
            )
          }
        />

      </div>

      <div className="flex justify-end">

        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={loading}
        >
          Annuler
        </Button>

        <Button
          type="button"
          onClick={save}
          disabled={loading}
        >
          {loading
            ? "Enregistrement..."
            : maintenance
              ? "Mettre à jour"
              : "Ajouter l'entretien"}
        </Button>

      </div>
    </div>
  );
}
