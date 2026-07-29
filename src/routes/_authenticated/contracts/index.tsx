import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileSignature, Plus } from "lucide-react";

import { ContractForm } from "@/components/contracts/contract-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getContracts } from "@/lib/contracts.functions";

export const Route = createFileRoute("/_authenticated/contracts/")({
  component: ContractsPage,
});

function ContractsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: contracts = [], isPending } = useQuery({
    queryKey: ["contracts"],
    queryFn: () => getContracts(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <FileSignature className="h-7 w-7" />
            Contrats
          </h1>
          <p className="text-muted-foreground">La parole vaut cher quand l’ambition prend de la valeur.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nouveau contrat
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Liste des contrats</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isPending ? (
            <p>Chargement…</p>
          ) : contracts.length === 0 ? (
            <p className="text-muted-foreground">Aucun contrat.</p>
          ) : (
            contracts.map((contract) => (
              <Link
                key={contract.id}
                to="/contracts/$contractId"
                params={{ contractId: contract.id }}
                className="block rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                <p className="font-medium">
                  {contract.reference || contract.type || "Contrat sans référence"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {[contract.partie, contract.statut, contract.date_fin]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Nouveau contrat</DialogTitle>
          </DialogHeader>
          <ContractForm
            onSuccess={() => {
              void queryClient.invalidateQueries({ queryKey: ["contracts"] });
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
