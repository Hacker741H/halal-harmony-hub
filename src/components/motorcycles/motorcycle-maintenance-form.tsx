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
  createMotorcycleMaintenance,
  getMotorcycleMaintenanceFinanceOperation,
  updateMotorcycleMaintenance,
  type MotorcycleMaintenance,
} from "@/lib/motorcycle-maintenances.functions";
import { getWallets } from "@/lib/wallet.functions";
import { notifyMutationError } from "@/lib/notify-mutation-error";

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
      toast.error("La date est obligatoire.");
      return;
    }

    const numericCost = cost ? Number(cost) : 0;
    if (!Number.isFinite(numericCost) || numericCost < 0) {
      toast.error("Le coût doit être un montant valide.");
      return;
    }
    if (numericCost > 0 && !walletId) {
      toast.error("Sélectionnez le wallet réglant cet entretien.");
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
        toast.success("Entretien mis à jour.");
      } else {
        await createMotorcycleMaintenance({
          data: payload,
        });
        toast.success("Entretien ajouté.");
      }

      onSuccess();
    } catch (error) {
      console.error(error);
      notifyMutationError(error, "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">

        <div>
          <Label htmlFor="motorcycle-maintenance-type">Type d'entretien</Label>

          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="motorcycle-maintenance-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Vidange">Vidange</SelectItem>
              <SelectItem value="Pneus">Pneus</SelectItem>
              <SelectItem value="Freins">Freins</SelectItem>
              <SelectItem value="Chaîne">Chaîne</SelectItem>
              <SelectItem value="Batterie">Batterie</SelectItem>
              <SelectItem value="Assurance">Assurance</SelectItem>
              <SelectItem value="Visite technique">Visite technique</SelectItem>
              <SelectItem value="Réparation">Réparation</SelectItem>
              <SelectItem value="Autre">Autre</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="motorcycle-maintenance-date">Date</Label>

          <Input
            id="motorcycle-maintenance-date"
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
          <Label htmlFor="motorcycle-maintenance-kilometrage">Kilométrage</Label>

          <Input
            id="motorcycle-maintenance-kilometrage"
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
          <Label htmlFor="motorcycle-maintenance-cost">Coût (FCFA)</Label>

          <Input
            id="motorcycle-maintenance-cost"
            type="number"
            value={cost}
            onChange={(e) =>
              setCost(e.target.value)
            }
          />
        </div>

        <div>
          <Label htmlFor="motorcycle-maintenance-wallet">Wallet de paiement</Label>

          <WalletSelect
            id="motorcycle-maintenance-wallet"
            value={walletId}
            onValueChange={setWalletId}
            disabled={Number(cost || 0) <= 0}
            placeholder="Sélectionner un wallet"
          />

          <p className="mt-1 text-xs text-muted-foreground">
            Une dépense sera créée automatiquement si le coût est supérieur à zéro.
          </p>
        </div>

        <div>
          <Label htmlFor="motorcycle-maintenance-garage">Garage</Label>

          <Input
            id="motorcycle-maintenance-garage"
            value={garage}
            onChange={(e) =>
              setGarage(e.target.value)
            }
          />
        </div>

        <div>
          <Label htmlFor="motorcycle-maintenance-next-date">Prochaine date</Label>

          <Input
            id="motorcycle-maintenance-next-date"
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
          <Label htmlFor="motorcycle-maintenance-next-kilometrage">Prochain kilométrage</Label>

          <Input
            id="motorcycle-maintenance-next-kilometrage"
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

        <Label htmlFor="motorcycle-maintenance-description" className="sr-only">Description</Label>
        <Textarea
          id="motorcycle-maintenance-description"
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

      <div className="flex justify-end gap-2">

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
