import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  createHarvest,
  updateHarvest,
  type Harvest,
} from "@/lib/harvests.functions";
import { getWallets } from "@/lib/wallet.functions";

type Props = {
  farmId: string;
  harvest?: Harvest | null;
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

export function HarvestForm({
  farmId,
  harvest,
  onSuccess,
}: Props) {
  const isEditing = !!harvest;

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [form, setForm] = useState({
    date_recolte: "",
    produit: "",
    quantite_kg: "",
    prix_kg: "",
    acheteur: "",
    observations: "",
    sale_wallet_id: "",
  });

  useEffect(() => {
    if (!harvest) return;

    setForm({
      date_recolte: harvest.date_recolte ?? "",
      produit: harvest.produit ?? "",
      quantite_kg: harvest.quantite_kg?.toString() ?? "",
      prix_kg: harvest.prix_kg?.toString() ?? "",
      acheteur: harvest.acheteur ?? "",
      observations: harvest.observations ?? "",
      sale_wallet_id: harvest.sale_wallet_id ?? "",
    });
  }, [harvest]);

  const { data: wallets = [] } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => getWallets(),
  });

  async function save() {
    const dateRecolte = form.date_recolte.trim();
    const produit = form.produit.trim();
    const quantiteKg = Number(form.quantite_kg);
    const prixKg = Number(form.prix_kg);

    if (!dateRecolte || !produit) {
      setErrorMessage("La date de récolte et le produit sont obligatoires.");
      return;
    }

    if (!Number.isFinite(quantiteKg) || quantiteKg <= 0) {
      setErrorMessage("La quantité doit être supérieure à zéro.");
      return;
    }

    if (!Number.isFinite(prixKg) || prixKg < 0) {
      setErrorMessage("Le prix au kilo doit être égal ou supérieur à zéro.");
      return;
    }

    try {
      setLoading(true);
      setErrorMessage(null);

      const values = {
        farm_id: farmId,
        date_recolte: dateRecolte,
        produit,
        quantite_kg: quantiteKg,
        prix_kg: prixKg,
        acheteur: form.acheteur.trim() || null,
        observations: form.observations.trim() || null,
        sale_wallet_id: form.sale_wallet_id || null,
      };

      if (isEditing && harvest) {
        await updateHarvest({
          data: {
            id: harvest.id,
            values,
          },
        });
      } else {
        await createHarvest({
          data: values,
        });
      }

      onSuccess();
    } catch (error: unknown) {
      console.error(error);
      setErrorMessage(
        getErrorMessage(error) ??
          "Impossible d’enregistrer la récolte. Réessayez.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">

        <div>
          <Label>Date de récolte</Label>
          <Input
            type="date"
            required
            value={form.date_recolte}
            onChange={(e) =>
              setForm({
                ...form,
                date_recolte: e.target.value,
              })
            }
          />
        </div>

        <div>
          <Label>Produit</Label>
          <Input
            placeholder="Hévéa"
            required
            value={form.produit}
            onChange={(e) =>
              setForm({
                ...form,
                produit: e.target.value,
              })
            }
          />
        </div>

        <div>
          <Label>Quantité (kg)</Label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            required
            value={form.quantite_kg}
            onChange={(e) =>
              setForm({
                ...form,
                quantite_kg: e.target.value,
              })
            }
          />
        </div>

        <div>
          <Label>Prix / kg (FCFA)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            required
            value={form.prix_kg}
            onChange={(e) =>
              setForm({
                ...form,
                prix_kg: e.target.value,
              })
            }
          />
        </div>

        <div className="md:col-span-2">
          <Label>Acheteur</Label>
          <Input
            value={form.acheteur}
            onChange={(e) =>
              setForm({
                ...form,
                acheteur: e.target.value,
              })
            }
          />
        </div>

        <div className="md:col-span-2">
          <Label>Wallet d'encaissement</Label>
          <select
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            value={form.sale_wallet_id}
            onChange={(event) =>
              setForm({ ...form, sale_wallet_id: event.target.value })
            }
          >
            <option value="">Récolte non encore encaissée</option>
            {wallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Un wallet crée ou met à jour automatiquement la recette de vente.
          </p>
        </div>

      </div>

      <div>
        <Label>Observations</Label>
        <Textarea
          rows={5}
          value={form.observations}
          onChange={(e) =>
            setForm({
              ...form,
              observations: e.target.value,
            })
          }
        />
      </div>

      {errorMessage && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {errorMessage}
        </p>
      )}

      <Button
        className="w-full"
        disabled={loading}
        onClick={save}
      >
        {loading
          ? "Enregistrement..."
          : isEditing
          ? "Mettre à jour"
          : "Créer la récolte"}
      </Button>
    </div>
  );
}
