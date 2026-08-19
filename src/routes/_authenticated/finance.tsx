import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, Banknote, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";

import { FinanceSelector } from "@/components/finance/FinanceSelector";
import { DepositForm } from "@/components/finance/forms/DepositForm";
import { ExpenseForm } from "@/components/finance/forms/ExpenseForm";
import { RevenueForm } from "@/components/finance/forms/RevenueForm";
import { TransferForm } from "@/components/finance/forms/TransferForm";
import { FinanceForm } from "@/components/finance-form";
import { FinanceTable } from "@/components/finance-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MetricCard } from "@/components/ui/metric-card";
import { ModuleHero } from "@/components/ui/module-hero";
import { useConfirm } from "@/hooks/use-confirm";
import {
  deleteFinanceOperation,
  getFinanceOperations,
  getFinanceStats,
  getTreasury,
  type FinanceOperation,
} from "@/lib/finance.functions";

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({ meta: [{ title: "Finances — HALAL ERP" }] }),
  component: FinancePage,
});

type FinanceType = "REVENUE" | "EXPENSE" | "DEPOSIT" | "TRANSFER" | null;

function FinancePage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [type, setType] = useState<FinanceType>(null);
  const [selectedOperation, setSelectedOperation] = useState<FinanceOperation | null>(null);
  const { confirm, dialog } = useConfirm();

  const { data: operations = [], isLoading, isError } = useQuery({
    queryKey: ["finance-operations"],
    queryFn: () => getFinanceOperations(),
  });
  const { data: stats } = useQuery({ queryKey: ["finance-stats"], queryFn: () => getFinanceStats() });
  const { data: treasury = 0 } = useQuery({ queryKey: ["treasury"], queryFn: () => getTreasury() });

  function create() {
    setSelectedOperation(null);
    setType(null);
    setSelectorOpen(true);
  }

  function edit(operation: FinanceOperation) {
    setSelectedOperation(operation);
    setType(
      operation.type === "REVENUE" || operation.type === "EXPENSE" || operation.type === "DEPOSIT" || operation.type === "TRANSFER"
        ? operation.type
        : null,
    );
    setOpen(true);
  }

  function remove(operation: FinanceOperation) {
    const amountLabel = `${Number(operation.amount).toLocaleString("fr-FR")} FCFA`;
    confirm({
      title: "Supprimer cette opération ?",
      description: `Cette opération de ${amountLabel}${operation.category ? ` (${operation.category})` : ""} sera définitivement supprimée. Cette action est irréversible.`,
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteFinanceOperation({ data: { id: operation.id } });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["finance-operations"] }),
            queryClient.invalidateQueries({ queryKey: ["finance-stats"] }),
            queryClient.invalidateQueries({ queryKey: ["wallets"] }),
            queryClient.invalidateQueries({ queryKey: ["wallet-stats"] }),
            queryClient.invalidateQueries({ queryKey: ["treasury"] }),
          ]);
          toast.success("Opération supprimée.");
        } catch (error) {
          console.error(error);
          toast.error(error instanceof Error ? error.message : "Impossible de supprimer l'opération.");
          throw error;
        }
      },
    });
  }

  function refresh() {
    setOpen(false);
    setSelectedOperation(null);
    void queryClient.invalidateQueries({ queryKey: ["finance-operations"] });
    void queryClient.invalidateQueries({ queryKey: ["finance-stats"] });
    void queryClient.invalidateQueries({ queryKey: ["wallets"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet-stats"] });
    void queryClient.invalidateQueries({ queryKey: ["treasury"] });
  }

  return (
    <>
      <div className="space-y-5">
        <ModuleHero
          icon={Wallet}
          eyebrow="Finance centrale"
          title="Journal financier"
          description="Suivez la trésorerie, les recettes et les dépenses à partir du journal unique de l’ERP."
          actions={
            <Button onClick={create}>
              <Plus className="h-4 w-4" />
              Nouvelle opération
            </Button>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Trésorerie"
            value={`${Number(treasury).toLocaleString("fr-FR")} FCFA`}
            description="Solde consolidé des wallets"
            icon={Wallet}
            tone="info"
          />
          <MetricCard
            label="Recettes"
            value={`${(stats?.recettes ?? 0).toLocaleString("fr-FR")} FCFA`}
            description="Période actuellement chargée"
            icon={ArrowUpCircle}
            tone="success"
          />
          <MetricCard
            label="Dépenses"
            value={`${(stats?.depenses ?? 0).toLocaleString("fr-FR")} FCFA`}
            description="Période actuellement chargée"
            icon={ArrowDownCircle}
            tone="danger"
          />
          <MetricCard
            label="Résultat"
            value={`${(stats?.resultat ?? 0).toLocaleString("fr-FR")} FCFA`}
            description="Recettes moins dépenses"
            icon={Banknote}
            tone="primary"
          />
        </div>

        <Card variant="section" className="overflow-hidden">
          <CardHeader className="border-b border-border/70">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Registre central</p>
                <CardTitle className="mt-1 text-xl">Opérations financières</CardTitle>
              </div>
              <p className="text-sm text-muted-foreground">Filtrez le journal selon le wallet, le module, la période ou le montant.</p>
            </div>
          </CardHeader>
          <CardContent className="p-5 sm:p-6">
            <FinanceTable operations={operations} loading={isLoading} error={isError} onEdit={edit} onDelete={remove} />
          </CardContent>
        </Card>

        {!isLoading && !isError && operations.length === 0 ? (
          <Card variant="information">
            <CardContent className="py-12 text-center">
              <Wallet className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
              <h2 className="mt-4 text-xl font-semibold">Aucune opération enregistrée</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                Les recettes, dépenses, versements et transferts apparaîtront ici dès leur enregistrement.
              </p>
              <Button className="mt-6" onClick={create}>
                <Plus className="h-4 w-4" />
                Ajouter une opération
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <FinanceSelector
        open={selectorOpen}
        onOpenChange={setSelectorOpen}
        onSelect={(value) => {
          setType(value);
          setSelectorOpen(false);
          setOpen(true);
        }}
      />
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setSelectedOperation(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selectedOperation ? "Modifier une opération" : "Nouvelle opération"}</DialogTitle>
          </DialogHeader>
          {type === "REVENUE" ? <RevenueForm operation={selectedOperation} onSuccess={refresh} /> : null}
          {type === "EXPENSE" ? <ExpenseForm operation={selectedOperation} onSuccess={refresh} /> : null}
          {type === "DEPOSIT" ? <DepositForm operation={selectedOperation} onSuccess={refresh} /> : null}
          {type === "TRANSFER" ? <TransferForm operation={selectedOperation} onSuccess={refresh} /> : null}
          {type === null ? <FinanceForm operation={selectedOperation} onSuccess={refresh} /> : null}
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
