import { useEffect, useState } from "react";

import { useQuery } from "@tanstack/react-query";

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

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  operation?: FinanceOperation | null;
  onSuccess: () => void;
};

export function RevenueForm({
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
      client: "",
      project: "",
      category: "",
      payment_method: "ESPECES",
      payment_reference: "",
      amount: "",
      operation_date: new Date()
        .toISOString()
        .substring(0, 10),
      reference: "",
      description: "",
      notes: "",
    });

  useEffect(() => {
    if (!operation) return;

    setForm({
      wallet_id:
        operation.wallet_id,
      client:
        operation.client ?? "",
      project:
        operation.project ?? "",
      category:
        operation.category ?? "",
      payment_method:
        operation.payment_method ??
        "ESPECES",
      payment_reference:
        operation.payment_reference ??
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
      notes:
        operation.notes ?? "",
    });
  }, [operation]);

  const isEditing =
    !!operation;  async function save() {
    if (!form.wallet_id) {
      alert("Choisissez un wallet.");
      return;
    }

    if (!form.client.trim()) {
      alert("Le client est obligatoire.");
      return;
    }

    if (!form.amount) {
      alert("Le montant est obligatoire.");
      return;
    }

    try {
      setLoading(true);

      const values: FinanceOperationValues = {
        wallet_id: form.wallet_id,
        type: "REVENUE",
        amount: Number(form.amount),

        client: form.client || null,
        project: form.project || null,

        category: form.category || null,

        payment_method:
          form.payment_method || null,

        payment_reference:
          form.payment_reference ||
          null,

        reference:
          form.reference || null,

        description:
          form.description || null,

        notes:
          form.notes || null,

        operation_date:
          form.operation_date,
      };

      if (isEditing && operation) {
        await updateFinanceOperation({
          data: {
            id: operation.id,
            values,
          },
        });
      } else {
        await createFinanceOperation({
          data: { operation: values },
        });
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
    <div className="space-y-6">

      <div className="grid gap-5 md:grid-cols-2">

        <div>
          <Label>Wallet</Label>

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
              Sélectionner...
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

          <Label>Client</Label>

          <Input
            placeholder="Nom du client"
            value={form.client}
            onChange={(e) =>
              setForm({
                ...form,
                client:
                  e.target.value,
              })
            }
          />

        </div>

        <div>

          <Label>Projet</Label>

          <Input
            placeholder="Projet"
            value={form.project}
            onChange={(e) =>
              setForm({
                ...form,
                project:
                  e.target.value,
              })
            }
          />

        </div>

        <div>

          <Label>Catégorie</Label>

          <Input
            placeholder="Transport, Vente..."
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

          <Label>Moyen de paiement</Label>

          <select
            className="w-full rounded-md border px-3 py-2"
            value={form.payment_method}
            onChange={(e) =>
              setForm({
                ...form,
                payment_method:
                  e.target.value,
              })
            }
          >
            <option value="ESPECES">
              Espèces
            </option>

            <option value="WAVE">
              Wave
            </option>

            <option value="ORANGE_MONEY">
              Orange Money
            </option>

            <option value="MTN_MONEY">
              MTN Money
            </option>

            <option value="BANQUE">
              Banque
            </option>

          </select>

        </div>

        <div>

          <Label>
            Référence du paiement
          </Label>

          <Input
            placeholder="Transaction..."
            value={
              form.payment_reference
            }
            onChange={(e) =>
              setForm({
                ...form,
                payment_reference:
                  e.target.value,
              })
            }
          />

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

          <Label>Date</Label>

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
            Référence de facture / dossier
          </Label>

          <Input
            placeholder="REC-2026-0001"
            value={form.reference}
            onChange={(e) =>
              setForm({
                ...form,
                reference:
                  e.target.value,
              })
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">Utilisez la même référence pour regrouper les opérations liées.</p>

        </div>

        <div className="md:col-span-2">

          <Label>Description</Label>

          <Input
            placeholder="Description de la recette"
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

        <div className="md:col-span-2">

          <Label>Notes</Label>

          <Input
            placeholder="Observations..."
            value={form.notes}
            onChange={(e) =>
              setForm({
                ...form,
                notes:
                  e.target.value,
              })
            }
          />

        </div>

      </div>      <div className="rounded-xl border bg-muted/30 p-4">

        <h3 className="font-semibold">
          Résumé de la recette
        </h3>

        <div className="mt-3 grid gap-2 text-sm">

          <div className="flex justify-between">
            <span>Client</span>

            <span className="font-medium">
              {form.client || "-"}
            </span>
          </div>

          <div className="flex justify-between">
            <span>Wallet</span>

            <span className="font-medium">
              {wallets.find(
                (w) =>
                  w.id === form.wallet_id,
              )?.name ?? "-"}
            </span>
          </div>

          <div className="flex justify-between">
            <span>Montant</span>

            <span className="font-bold text-green-600">
              {Number(
                form.amount || 0,
              ).toLocaleString()} FCFA
            </span>
          </div>

          <div className="flex justify-between">
            <span>Paiement</span>

            <span className="font-medium">
              {form.payment_method}
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
            : "Enregistrement..."
          : isEditing
          ? "Mettre à jour la recette"
          : "Enregistrer la recette"}
      </Button>

    </div>
  );
}
