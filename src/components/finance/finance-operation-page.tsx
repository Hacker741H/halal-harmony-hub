import { useState, type ComponentType, type ReactNode } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { FinanceTable } from "@/components/finance-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteFinanceOperation,
  getFinanceOperationsByType,
  type FinanceOperation,
} from "@/lib/finance.functions";
import type { FinanceOperationType } from "@/lib/finance.service";

type FinanceFormProps = {
  operation?: FinanceOperation | null;
  onSuccess: () => void;
};

type Props = {
  title: string;
  description: string;
  type: FinanceOperationType;
  icon: ReactNode;
  createLabel: string;
  Form: ComponentType<FinanceFormProps>;
};

export function FinanceOperationPage({
  title,
  description,
  type,
  icon,
  createLabel,
  Form,
}: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedOperation, setSelectedOperation] =
    useState<FinanceOperation | null>(null);

  const { data: operations = [], isLoading } = useQuery({
    queryKey: ["finance-operations", type],
    queryFn: () => getFinanceOperationsByType({ data: type }),
  });

  const refresh = async () => {
    setOpen(false);
    setSelectedOperation(null);

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["finance-operations"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-stats"] }),
      queryClient.invalidateQueries({ queryKey: ["wallets"] }),
      queryClient.invalidateQueries({ queryKey: ["wallet-stats"] }),
      queryClient.invalidateQueries({ queryKey: ["treasury"] }),
    ]);
  };

  const create = () => {
    setSelectedOperation(null);
    setOpen(true);
  };

  const edit = (operation: FinanceOperation) => {
    setSelectedOperation(operation);
    setOpen(true);
  };

  const remove = async (operation: FinanceOperation) => {
    if (!confirm("Supprimer cette opération ?")) return;

    try {
      await deleteFinanceOperation({ data: { id: operation.id } });
      await refresh();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Impossible de supprimer l'opération.");
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-primary/10 p-4">{icon}</div>
            <div>
              <h1 className="text-3xl font-bold">{title}</h1>
              <p className="text-muted-foreground">{description}</p>
            </div>
          </div>

          <Button onClick={create}>
            <Plus className="mr-2 h-4 w-4" />
            {createLabel}
          </Button>
        </div>

        <FinanceTable
          operations={operations}
          loading={isLoading}
          onEdit={edit}
          onDelete={remove}
        />
      </div>

      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setSelectedOperation(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selectedOperation ? `Modifier : ${title.toLowerCase()}` : createLabel}
            </DialogTitle>
          </DialogHeader>
          <Form operation={selectedOperation} onSuccess={refresh} />
        </DialogContent>
      </Dialog>
    </>
  );
}
