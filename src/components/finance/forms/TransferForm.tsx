import { useEffect, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  createFinanceOperation,
  updateFinanceOperation,
  type FinanceOperation,
  type FinanceOperationValues,
} from "@/lib/finance.functions";

import {
  getWallets,
  type Wallet,
} from "@/lib/wallet.functions";

type Props = {
  operation?: FinanceOperation | null;
  onSuccess: () => void;
};

export function TransferForm({
  operation,
  onSuccess,
}: Props) {
  const {
    data: wallets = [],
  } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => getWallets(),
  });

  const [loading, setLoading] =
    useState(false);

  const [form, setForm] =
    useState({
      wallet_id: "",
      destination_wallet_id: "",
      amount: "",
      operation_date: new Date()
        .toISOString()
        .substring(0, 10),
      reference: "",
      description: "",
    });

  useEffect(() => {
    if (!operation) return;

    setForm({
      wallet_id:
        operation.wallet_id,

      destination_wallet_id:
        operation.destination_wallet_id ??
        "",

      amount: String(
        operation.amount,
      ),

      operation_date:
        operation.operation_date,

      reference:
        operation.reference ?? "",

      description:
        operation.description ??
        "",
    });
  }, [operation]);

  const isEditing =
    !!operation;  async function save() {
    if (!form.wallet_id) {
      alert("Choisissez un wallet source.");
      return;
    }

    if (!form.destination_wallet_id) {
      alert("Choisissez un wallet destination.");
      return;
    }

    if (
      form.wallet_id ===
      form.destination_wallet_id
    ) {
      alert(
        "Les deux wallets doivent être différents.",
      );
      return;
    }

    if (
      Number(form.amount) <= 0
    ) {
      alert("Montant invalide.");
      return;
    }

    try {
      setLoading(true);

      const values: FinanceOperationValues = {
        wallet_id:
          form.wallet_id,

        destination_wallet_id:
          form.destination_wallet_id,

        type: "TRANSFER",

        amount: Number(
          form.amount,
        ),

        operation_date:
          form.operation_date,

        reference:
          form.reference || null,

        description:
          form.description || null,

        category: null,
      };

      if (
        isEditing &&
        operation
      ) {
        await updateFinanceOperation({
          data: {
            id: operation.id,
            values,
          },
        });

        alert(
          "✅ Transfert mis à jour.",
        );
      } else {
        console.log("Valeurs envoyées :", values);
        const result = await createFinanceOperation({
  data: { operation: values },
});

console.log("Résultat :", result);

        alert(
          "✅ Transfert enregistré.",
        );
      }

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
    <div className="space-y-5">

      <div className="grid gap-4 md:grid-cols-2">        <div>

          <Label>
            Wallet source
          </Label>

          <select
            className="w-full rounded-md border p-2"
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
              Choisir...
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
            Wallet destination
          </Label>

          <select
            className="w-full rounded-md border p-2"
            value={
              form.destination_wallet_id
            }
            onChange={(e) =>
              setForm({
                ...form,
                destination_wallet_id:
                  e.target.value,
              })
            }
          >
            <option value="">
              Choisir...
            </option>

            {wallets
              .filter(
                (wallet) =>
                  wallet.id !==
                  form.wallet_id,
              )
              .map(
                (
                  wallet: Wallet,
                ) => (
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
            Montant (FCFA)
          </Label>

          <Input
            type="number"
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

        <div>

          <Label>
            Référence de facture / dossier
          </Label>

          <Input
            value={form.reference}
            onChange={(e) =>
              setForm({
                ...form,
                reference:
                  e.target.value,
              })
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">Utilisez la même référence pour regrouper les mouvements liés.</p>

        </div>

        <div>

          <Label>
            Motif
          </Label>

          <Input
            value={
              form.description
            }
            onChange={(e) =>
              setForm({
                ...form,
                description:
                  e.target.value,
              })
            }
          />

        </div>

      </div>      <div className="rounded-xl border bg-muted/30 p-4">

        <h3 className="font-semibold">
          Résumé du transfert
        </h3>

        <div className="mt-3 grid gap-2 text-sm">

          <div className="flex justify-between">

            <span>Depuis</span>

            <span className="font-medium">
              {wallets.find(
                (w) =>
                  w.id === form.wallet_id,
              )?.name ?? "-"}
            </span>

          </div>

          <div className="flex justify-between">

            <span>Vers</span>

            <span className="font-medium">
              {wallets.find(
                (w) =>
                  w.id ===
                  form.destination_wallet_id,
              )?.name ?? "-"}
            </span>

          </div>

          <div className="flex justify-between">

            <span>Montant</span>

            <span className="font-bold">
              {Number(
                form.amount || 0,
              ).toLocaleString()} FCFA
            </span>

          </div>

        </div>

      </div>

      <Button
        className="w-full"
        disabled={loading}
        onClick={save}
      >
        {loading
          ? isEditing
            ? "Mise à jour..."
            : "Transfert..."
          : isEditing
          ? "Mettre à jour le transfert"
          : "Effectuer le transfert"}
      </Button>

    </div>
  );
}
