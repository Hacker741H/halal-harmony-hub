import { useEffect, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  createFinanceOperation,
  updateFinanceOperation,
  type FinanceOperation,
} from "@/lib/finance.functions";

import {
  getWallets,
  type Wallet,
} from "@/lib/wallet.functions";

type FinanceType =
  | "REVENUE"
  | "EXPENSE"
  | "DEPOSIT";

type Props = {
  onSuccess: () => void;
  operation?: FinanceOperation | null;
  defaultType?: FinanceType;
};

export function FinanceForm({
  onSuccess,
  operation,
  defaultType = "REVENUE",
}: Props) {
  const {
    data: wallets = [],
  } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => getWallets(),
  });

  const [loading, setLoading] =
    useState(false);

  const [form, setForm] = useState({
    wallet_id: "",
    type: defaultType,
    amount: "",
    category: "",
    description: "",
    operation_date: new Date()
      .toISOString()
      .substring(0, 10),
    reference: "",
  });

  useEffect(() => {
    if (!operation) {
      setForm({
        wallet_id: "",
        type: defaultType,
        amount: "",
        category: "",
        description: "",
        operation_date: new Date()
          .toISOString()
          .substring(0, 10),
        reference: "",
      });

      return;
    }

    setForm({
      wallet_id: operation.wallet_id,
      type:
        operation.type === "REVENUE" ||
        operation.type === "EXPENSE" ||
        operation.type === "DEPOSIT"
          ? operation.type
          : defaultType,
      amount: String(operation.amount),
      category: operation.category ?? "",
      description:
        operation.description ?? "",
      operation_date:
        operation.operation_date ??
        new Date()
          .toISOString()
          .substring(0, 10),
      reference:
        operation.reference ?? "",
    });
  }, [
    operation,
    defaultType,
  ]);

  const isEditing =
    !!operation;

  async function save() {
    if (!form.wallet_id) {
      alert(
        "Choisissez un wallet.",
      );
      return;
    }

    if (!form.amount) {
      alert(
        "Le montant est obligatoire.",
      );
      return;
    }

    if (
      Number(form.amount) <= 0
    ) {
      alert(
        "Le montant doit être supérieur à zéro.",
      );
      return;
    }

    try {
      setLoading(true);

      const values = {
        wallet_id:
          form.wallet_id,
        type:
          form.type,
        amount:
          Number(form.amount),
        category:
          form.category.trim() ||
          null,
        description:
          form.description.trim() ||
          null,
        operation_date:
          form.operation_date,
        reference:
          form.reference.trim() ||
          null,
      };      if (isEditing && operation) {
        await updateFinanceOperation({
          data: {
            id: operation.id,
            values,
          },
        });

        alert(
          "✅ Opération mise à jour.",
        );
      } else {
        await createFinanceOperation({
          data: { operation: values },
        });

        alert(
          "✅ Opération enregistrée.",
        );
      }

      setForm({
        wallet_id: "",
        type: defaultType,
        amount: "",
        category: "",
        description: "",
        operation_date: new Date()
          .toISOString()
          .substring(0, 10),
        reference: "",
      });

      onSuccess();
    } catch (error) {
      console.error(error);

      alert(
        error instanceof Error
          ? error.message
          : JSON.stringify(error, null, 2),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">

      <div className="grid gap-5 md:grid-cols-2">

        <div>

          <Label>
            Wallet
          </Label>

          <select
            className="w-full rounded-md border px-3 py-2"
            value={form.wallet_id}
            onChange={(e) =>
              setForm({
                ...form,
                wallet_id:
                  e.target.value,
              })
            }
          >
            <option value="">
              Sélectionner un wallet...
            </option>

            {wallets.map(
              (wallet: Wallet) => (
                <option
                  key={wallet.id}
                  value={wallet.id}
                >
                  {wallet.name}
                </option>
              ),
            )}
          </select>

        </div>

        <div>

          <Label>
            Type d'opération
          </Label>

          <Input
            value={form.type}
            disabled
            className="bg-muted font-semibold"
          />

        </div>

        <div>

          <Label>
            Montant (FCFA)
          </Label>

          <Input
            type="number"
            placeholder="0"
            value={form.amount}
            onChange={(e) =>
              setForm({
                ...form,
                amount:
                  e.target.value,
              })
            }
          />

        </div>

        <div>

          <Label>
            Catégorie
          </Label>

          <Input
            placeholder={
              form.type ===
              "REVENUE"
                ? "Vente, Transport..."
                : form.type ===
                  "EXPENSE"
                ? "Carburant, Salaire..."
                : "Versement"
            }
            value={form.category}
            onChange={(e) =>
              setForm({
                ...form,
                category:
                  e.target.value,
              })
            }
          />

        </div>        <div>

          <Label>
            Description
          </Label>

          <Input
            placeholder={
              form.type ===
              "REVENUE"
                ? "Ex : Paiement transport Sago"
                : form.type ===
                  "EXPENSE"
                ? "Ex : Achat carburant"
                : "Ex : Dépôt Wave"
            }
            value={form.description}
            onChange={(e) =>
              setForm({
                ...form,
                description:
                  e.target.value,
              })
            }
          />

        </div>

        <div>

          <Label>
            Date
          </Label>

          <Input
            type="date"
            value={
              form.operation_date
            }
            onChange={(e) =>
              setForm({
                ...form,
                operation_date:
                  e.target.value,
              })
            }
          />

        </div>

        <div className="md:col-span-2">

          <Label>
            Référence
          </Label>

          <Input
            placeholder={
              form.type ===
              "REVENUE"
                ? "REC-2026-0001"
                : form.type ===
                  "EXPENSE"
                ? "DEP-2026-0001"
                : "VER-2026-0001"
            }
            value={form.reference}
            onChange={(e) =>
              setForm({
                ...form,
                reference:
                  e.target.value,
              })
            }
          />

        </div>

      </div>

      <div className="rounded-xl border bg-muted/30 p-4">

        <h3 className="font-semibold">
          Résumé de l'opération
        </h3>

        <div className="mt-3 grid gap-2 text-sm">

          <div className="flex justify-between">
            <span>
              Type
            </span>

            <span className="font-medium">
              {form.type}
            </span>
          </div>

          <div className="flex justify-between">
            <span>
              Wallet
            </span>

            <span className="font-medium">
              {wallets.find(
                (w) =>
                  w.id ===
                  form.wallet_id,
              )?.name ?? "-"}
            </span>
          </div>

          <div className="flex justify-between">
            <span>
              Montant
            </span>

            <span className="font-bold">
              {form.amount || 0} FCFA
            </span>
          </div>

        </div>

      </div>      <Button
        className="w-full"
        disabled={loading}
        onClick={save}
      >
        {loading ? (
          isEditing ? (
            "Mise à jour..."
          ) : (
            "Enregistrement..."
          )
        ) : isEditing ? (
          "Mettre à jour l'opération"
        ) : form.type ===
          "REVENUE" ? (
          "Enregistrer la recette"
        ) : form.type ===
          "EXPENSE" ? (
          "Enregistrer la dépense"
        ) : (
          "Enregistrer le versement"
        )}
      </Button>

    </div>
  );
}
