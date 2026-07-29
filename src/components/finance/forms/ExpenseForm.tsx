import { FinanceForm } from "@/components/finance-form";

import type {
  FinanceOperation,
} from "@/lib/finance.functions";

type Props = {
  operation?: FinanceOperation | null;
  onSuccess: () => void;
};

export function ExpenseForm({
  operation,
  onSuccess,
}: Props) {
  return (
    <FinanceForm
      operation={operation}
      defaultType="EXPENSE"
      onSuccess={onSuccess}
    />
  );
}
