import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Expense } from "@/lib/expenses.functions";

type Props = {
  expenses: Expense[];
  loading?: boolean;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
};

export function ExpenseTable({ expenses, loading, onEdit, onDelete }: Props) {
  if (loading) return <div>Chargement...</div>;

  if (!expenses.length) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        Aucune dépense enregistrée.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="p-3 text-left">Date</th>
            <th className="p-3 text-left">Catégorie</th>
            <th className="p-3 text-left">Fournisseur</th>
            <th className="p-3 text-right">Montant</th>
            <th className="p-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((expense) => (
            <tr key={expense.id} className="border-t">
              <td className="p-3">{expense.operation_date}</td>
              <td className="p-3">{expense.category ?? "-"}</td>
              <td className="p-3">{expense.supplier ?? "-"}</td>
              <td className="p-3 text-right font-medium">
                {Number(expense.amount).toLocaleString("fr-FR")} FCFA
              </td>
              <td className="p-3">
                <div className="flex justify-end gap-2">
                  <Button size="icon" variant="outline" onClick={() => onEdit(expense)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="destructive" onClick={() => onDelete(expense)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
