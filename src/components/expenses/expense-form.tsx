import { useEffect, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WalletSelect } from "@/components/selects/entity-selects";
import {
  createExpense,
  updateExpense,
  type Expense,
} from "@/lib/expenses.functions";
import { getWallets } from "@/lib/wallet.functions";

type Props = {
  farmId: string;
  expense?: Expense | null;
  onSuccess: () => void;
};

export function ExpenseForm({ farmId, expense, onSuccess }: Props) {
  const isEditing = Boolean(expense);
  const [loading, setLoading] = useState(false);
  const { data: wallets = [] } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => getWallets(),
  });

  const [form, setForm] = useState({
    amount: "",
    category: "",
    description: "",
    operation_date: new Date().toISOString().slice(0, 10),
    supplier: "",
    wallet_id: "",
  });

  useEffect(() => {
    if (!expense) return;

    setForm({
      amount: String(expense.amount),
      category: expense.category ?? "",
      description: expense.description ?? "",
      operation_date: expense.operation_date,
      supplier: expense.supplier ?? "",
      wallet_id: expense.wallet_id,
    });
  }, [expense]);

  async function save() {
    if (!form.wallet_id || !form.category.trim() || Number(form.amount) <= 0) {
      alert("Le wallet, la catégorie et un montant strictement positif sont obligatoires.");
      return;
    }

    const values = {
      amount: Number(form.amount),
      category: form.category.trim(),
      description: form.description.trim() || null,
      farm_id: farmId,
      operation_date: form.operation_date,
      supplier: form.supplier.trim() || null,
      wallet_id: form.wallet_id,
    };

    try {
      setLoading(true);

      if (isEditing && expense) {
        await updateExpense({ data: { id: expense.id, values } });
      } else {
        await createExpense({ data: values });
      }

      onSuccess();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Erreur lors de l'enregistrement.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Date</Label>
          <Input
            type="date"
            value={form.operation_date}
            onChange={(event) => setForm({ ...form, operation_date: event.target.value })}
          />
        </div>

        <div>
          <Label htmlFor="expense-wallet">Wallet</Label>
          <WalletSelect
            id="expense-wallet"
            value={form.wallet_id}
            onValueChange={(value) => setForm({ ...form, wallet_id: value })}
            placeholder="Sélectionner..."
          />
        </div>

        <div>
          <Label>Catégorie</Label>
          <Input
            placeholder="Carburant"
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
          />
        </div>

        <div>
          <Label>Montant (FCFA)</Label>
          <Input
            type="number"
            min="1"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
          />
        </div>

        <div className="md:col-span-2">
          <Label>Fournisseur</Label>
          <Input
            value={form.supplier}
            onChange={(event) => setForm({ ...form, supplier: event.target.value })}
          />
        </div>

        <div className="md:col-span-2">
          <Label>Description</Label>
          <Textarea
            rows={5}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </div>
      </div>

      <Button className="w-full" disabled={loading} onClick={save}>
        {loading ? "Enregistrement..." : isEditing ? "Mettre à jour" : "Créer la dépense"}
      </Button>
    </div>
  );
}
