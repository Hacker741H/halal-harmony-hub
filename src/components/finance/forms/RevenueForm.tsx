import { useEffect, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
      toast.error("Choisissez un wallet.");
      return;
    }

    if (!form.client.trim()) {
      toast.error("Le client est obligatoire.");
      return;
    }

    if (!form.amount) {
      toast.error("Le montant est obligatoire.");
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

        toast.success("Recette mise à jour.");
      } else {
        await createFinanceOperation({
          data: { operation: values },
        });

        toast.success("Recette enregistrée.");
      }

      onSuccess();
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Une erreur est survenue.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">

      <div className="grid gap-5 md:grid-cols-2">

        <div>
          <Label htmlFor="revenue-wallet">Wallet</Label>

          <Select
            value={form.wallet_id || undefined}
            onValueChange={(value) =>
              setForm({
                ...form,
                wallet_id: value,
              })
            }
          >
            <SelectTrigger id="revenue-wallet">
              <SelectValue placeholder="Sélectionner..." />
            </SelectTrigger>
            <SelectContent>
              {wallets.map(
                (wallet: Wallet) => (
                  <SelectItem
                    key={wallet.id}
                    value={wallet.id}
                  >
                    {wallet.name}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
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

          <Label htmlFor="revenue-payment-method">Moyen de paiement</Label>

          <Select
            value={form.payment_method}
            onValueChange={(value) =>
              setForm({
                ...form,
                payment_method: value,
              })
            }
          >
            <SelectTrigger id="revenue-payment-method"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ESPECES">Espèces</SelectItem>
              <SelectItem value="WAVE">Wave</SelectItem>
              <SelectItem value="ORANGE_MONEY">Orange Money</SelectItem>
              <SelectItem value="MTN_MONEY">MTN Money</SelectItem>
              <SelectItem value="BANQUE">Banque</SelectItem>
            </SelectContent>
          </Select>

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
