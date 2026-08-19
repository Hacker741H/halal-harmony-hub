import { useEffect, useRef, useState, type ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { FinanceTable } from "@/components/finance-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ModuleHero } from "@/components/ui/module-hero";
import { useConfirm } from "@/hooks/use-confirm";
import { formatXOF } from "@/lib/format";
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
  icon: LucideIcon;
  createLabel: string;
  Form: ComponentType<FinanceFormProps>;
  quickCreate?: boolean;
  onQuickCreateHandled?: () => void;
};

export function FinanceOperationPage({
  title,
  description,
  type,
  icon,
  createLabel,
  Form,
  quickCreate = false,
  onQuickCreateHandled,
}: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedOperation, setSelectedOperation] = useState<FinanceOperation | null>(null);
  const handledQuickCreate = useRef(false);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    if (!quickCreate) {
      handledQuickCreate.current = false;
      return;
    }
    if (!handledQuickCreate.current) {
      setSelectedOperation(null);
      setOpen(true);
      handledQuickCreate.current = true;
    }
  }, [quickCreate]);

  const { data: operations = [], isLoading, isError } = useQuery({
    queryKey: ["finance-operations", type],
    queryFn: () => getFinanceOperationsByType({ data: type }),
  });

  const refresh = async () => {
    setOpen(false);
    setSelectedOperation(null);
    onQuickCreateHandled?.();
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

  const remove = (operation: FinanceOperation) => {
    confirm({
      title: "Supprimer cette opération ?",
      description: `Cette opération de ${formatXOF(operation.amount)} sera définitivement supprimée. Cette action est irréversible.`,
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteFinanceOperation({ data: { id: operation.id } });
          await refresh();
          toast.success("Opération supprimée.");
        } catch (error) {
          console.error(error);
          toast.error(error instanceof Error ? error.message : "Impossible de supprimer l'opération.");
          throw error;
        }
      },
    });
  };

  return (
    <>
      <div className="space-y-7">
        <ModuleHero
          icon={icon}
          eyebrow="Finance centrale"
          title={title}
          description={description}
          actions={
            <Button onClick={create}>
              <Plus className="h-4 w-4" />
              {createLabel}
            </Button>
          }
        />
        <Card variant="section" className="overflow-hidden">
          <CardHeader className="border-b border-border/70">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Journal filtré</p>
                <CardTitle className="mt-1 text-xl">{title} enregistrées</CardTitle>
              </div>
              <p className="text-sm text-muted-foreground">Recherchez ou filtrez les opérations de ce type.</p>
            </div>
          </CardHeader>
          <CardContent className="p-5 sm:p-6">
            <FinanceTable operations={operations} loading={isLoading} error={isError} onEdit={edit} onDelete={remove} />
          </CardContent>
        </Card>
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) {
            setSelectedOperation(null);
            onQuickCreateHandled?.();
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selectedOperation ? `Modifier : ${title.toLowerCase()}` : createLabel}</DialogTitle>
          </DialogHeader>
          <Form operation={selectedOperation} onSuccess={refresh} />
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
