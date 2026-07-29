import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { FinanceSelector } from "@/components/finance/FinanceSelector";
import { RevenueForm } from "@/components/finance/forms/RevenueForm";
import { ExpenseForm } from "@/components/finance/forms/ExpenseForm";
import { DepositForm } from "@/components/finance/forms/DepositForm";
import { TransferForm } from "@/components/finance/forms/TransferForm";
import {
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  Plus,
  Wallet,
} from "lucide-react";

import {
  getFinanceOperations,
  getFinanceStats,
  getTreasury,
  deleteFinanceOperation,
  type FinanceOperation,
} from "@/lib/finance.functions";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Button } from "@/components/ui/button";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { FinanceForm } from "@/components/finance-form";
import { FinanceTable } from "@/components/finance-table";

export const Route = createFileRoute(
  "/_authenticated/finance",
)({
  head: () => ({
    meta: [
      {
        title: "Finances — HALAL ERP",
      },
    ],
  }),
  component: FinancePage,
});

function FinancePage() {
  const queryClient = useQueryClient();

  const [open, setOpen] =
    useState(false);
const [selectorOpen, setSelectorOpen] =
  useState(false);

const [type, setType] = useState<
  "REVENUE" |
  "EXPENSE" |
  "DEPOSIT" |
  "TRANSFER" |
  null
>(null);
  const [selectedOperation, setSelectedOperation] =
    useState<FinanceOperation | null>(
      null,
    );

  const {
    data: operations = [],
    isLoading,
  } = useQuery({
    queryKey: ["finance-operations"],
    queryFn: () =>
      getFinanceOperations(),
  });

  const {
    data: stats,
  } = useQuery({
    queryKey: ["finance-stats"],
    queryFn: () =>
      getFinanceStats(),
  });

  const {
    data: treasury = 0,
  } = useQuery({
    queryKey: ["treasury"],
    queryFn: () => getTreasury(),
  });

  function create() {
  setSelectedOperation(null);

  setType(null);

  setSelectorOpen(true);
}

  function edit(
  operation: FinanceOperation,
) {
  setSelectedOperation(operation);

  setType(
    operation.type === "REVENUE" ||
      operation.type === "EXPENSE" ||
      operation.type === "DEPOSIT" ||
      operation.type === "TRANSFER"
      ? operation.type
      : null,
  );

  setOpen(true);

  }  async function remove(
    operation: FinanceOperation,
  ) {
    if (
      !confirm(
        "Supprimer cette opération ?",
      )
    ) {
      return;
    }

    try {
      await deleteFinanceOperation({
        data: {
          id: operation.id,
        },
      });

      await queryClient.invalidateQueries({
        queryKey: [
          "finance-operations",
        ],
      });

      await queryClient.invalidateQueries({
        queryKey: [
          "finance-stats",
        ],
      });

      await queryClient.invalidateQueries({
        queryKey: ["wallets"],
      });

      await queryClient.invalidateQueries({
        queryKey: [
          "wallet-stats",
        ],
      });

      await queryClient.invalidateQueries({
        queryKey: ["treasury"],
      });

      alert("✅ Opération supprimée.");
    } catch (error) {
      console.error(error);

      alert(
        error instanceof Error
          ? error.message
          : JSON.stringify(error, null, 2),
      );
    }
  }

  function refresh() {
    setOpen(false);

    setSelectedOperation(null);

    queryClient.invalidateQueries({
      queryKey: [
        "finance-operations",
      ],
    });

    queryClient.invalidateQueries({
      queryKey: [
        "finance-stats",
      ],
    });

    queryClient.invalidateQueries({
      queryKey: ["wallets"],
    });

    queryClient.invalidateQueries({
      queryKey: [
        "wallet-stats",
      ],
    });

    queryClient.invalidateQueries({
      queryKey: ["treasury"],
    });
  }

  return (
    <>      <div className="space-y-6">

        <div className="flex items-center justify-between">

          <div className="flex items-center gap-4">

            <div className="rounded-xl bg-primary/10 p-4">
              <Wallet className="h-8 w-8 text-primary" />
            </div>

            <div>
              <h1 className="text-3xl font-bold">
                Finances
              </h1>

              <p className="text-muted-foreground">
                Gérez toutes les opérations financières de HALAL ERP.
              </p>
            </div>

          </div>

          <Button onClick={create}>
            <Plus className="mr-2 h-4 w-4" />
            Nouvelle opération
          </Button>

        </div>

        <div className="grid gap-4 md:grid-cols-4">

          <Card>

            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Trésorerie
              </CardTitle>
            </CardHeader>

            <CardContent>

              <div className="flex items-center gap-2">

                <Wallet className="h-5 w-5 text-primary" />

                <span className="text-2xl font-bold">
                  {Number(treasury).toLocaleString()} FCFA
                </span>

              </div>

            </CardContent>

          </Card>

          <Card>

            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Recettes
              </CardTitle>
            </CardHeader>

            <CardContent>

              <div className="flex items-center gap-2">

                <ArrowUpCircle className="h-5 w-5 text-green-600" />

                <span className="text-2xl font-bold">
                  {(stats?.recettes ?? 0).toLocaleString()} FCFA
                </span>

              </div>

            </CardContent>

          </Card>

          <Card>

            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Dépenses
              </CardTitle>
            </CardHeader>

            <CardContent>

              <div className="flex items-center gap-2">

                <ArrowDownCircle className="h-5 w-5 text-red-600" />

                <span className="text-2xl font-bold">
                  {(stats?.depenses ?? 0).toLocaleString()} FCFA
                </span>

              </div>

            </CardContent>

          </Card>

          <Card>

            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Résultat
              </CardTitle>
            </CardHeader>

            <CardContent>

              <div className="flex items-center gap-2">

                <Banknote className="h-5 w-5 text-yellow-600" />

                <span className="text-2xl font-bold">
                  {(stats?.resultat ?? 0).toLocaleString()} FCFA
                </span>

              </div>

            </CardContent>

          </Card>

        </div>

        <FinanceTable
          operations={operations}
          loading={isLoading}
          onEdit={edit}
          onDelete={remove}
        />

      </div>   <FinanceSelector
  open={selectorOpen}
  onOpenChange={setSelectorOpen}
  onSelect={(value) => {
    setType(value);

    setSelectorOpen(false);

    setOpen(true);
  }}
/>   <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);

          if (!value) {
            setSelectedOperation(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">

          <DialogHeader>
            <DialogTitle>
              {selectedOperation
                ? "Modifier une opération"
                : "Nouvelle opération"}
            </DialogTitle>
          </DialogHeader>

          {type === "REVENUE" && (
  <RevenueForm
    operation={selectedOperation}
    onSuccess={refresh}
  />
)}

{type === "EXPENSE" && (
  <ExpenseForm
    operation={selectedOperation}
    onSuccess={refresh}
  />
)}

{type === "DEPOSIT" && (
  <DepositForm
    operation={selectedOperation}
    onSuccess={refresh}
  />
)}

{type === "TRANSFER" && (
  <TransferForm
    operation={selectedOperation}
    onSuccess={refresh}
  />
)}

{type === null && (
  <FinanceForm
    operation={selectedOperation}
    onSuccess={refresh}
  />
)}

        </DialogContent>
      </Dialog>

      {!isLoading &&
        operations.length === 0 && (
          <Card>

            <CardContent className="py-16">

              <div className="text-center">

                <Wallet className="mx-auto h-16 w-16 text-muted-foreground" />

                <h2 className="mt-4 text-xl font-semibold">
                  Aucune opération enregistrée
                </h2>

                <p className="mt-2 text-muted-foreground">
                  Les recettes, dépenses, versements et transferts
                  apparaîtront ici.
                </p>

                <Button
                  className="mt-6"
                  onClick={create}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Ajouter une opération
                </Button>

              </div>

            </CardContent>

          </Card>
        )}

    </>
  );
}
