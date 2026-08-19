import { useEffect, useState } from "react";

import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CircleCheck, FileSignature, Files, Plus } from "lucide-react";
import { z } from "zod";

import { ContractForm } from "@/components/contracts/contract-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getContracts } from "@/lib/contracts.functions";

export const Route = createFileRoute("/_authenticated/contracts/")({
  validateSearch: z.object({ create: z.literal("true").optional() }),
  component: ContractsPage,
});

function ContractsPage() {
  const { create } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: contracts = [], isPending, isError, refetch } = useQuery({
    queryKey: ["contracts"],
    queryFn: () => getContracts(),
  });

  useEffect(() => {
    if (create === "true") setOpen(true);
  }, [create]);

  const clearQuickCreate = () => {
    if (create === "true") void navigate({ search: {}, replace: true });
  };

  const activeContracts = contracts.filter((contract) => {
    const status = contract.statut?.toLowerCase();
    return status === "actif" || status === "active";
  }).length;
  const datedContracts = contracts.filter((contract) => Boolean(contract.date_fin)).length;

  return (
    <div className="space-y-7">
      <PageHeader
        title="Contrats et engagements"
        description="Centralisez les contrats, leurs références et les échéances déjà saisies dans l’ERP."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Nouveau contrat
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Contrats" value={contracts.length} description="Documents contractuels enregistrés" icon={Files} />
        <MetricCard label="Actifs" value={activeContracts} description="Statut actif renseigné" icon={CircleCheck} tone="success" />
        <MetricCard label="Avec échéance" value={datedContracts} description="Une date de fin est renseignée" icon={CalendarDays} tone="info" />
      </div>

      <Card variant="section" className="overflow-hidden">
        <CardHeader className="border-b border-border/70">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Registre contractuel</p>
              <CardTitle className="mt-1 text-xl">Liste des contrats</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              {isPending ? "Chargement des contrats…" : "Chaque ligne mène vers la fiche complète du contrat."}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-5 sm:p-6">
          {isPending ? (
            <div className="space-y-3" aria-label="Chargement des contrats">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : isError ? (
            <ErrorState title="Impossible de charger les contrats." onRetry={() => void refetch()} />
          ) : contracts.length === 0 ? (
            <EmptyState icon={FileSignature} title="Aucun contrat enregistré" description="Créez le premier contrat pour le voir apparaître ici." />
          ) : (
            contracts.map((contract) => (
              <Link
                key={contract.id}
                to="/contracts/$contractId"
                params={{ contractId: contract.id }}
                className="group block rounded-xl border border-border/75 bg-surface px-4 py-4 transition-ui hover:border-primary/25 hover:bg-surface-hover hover:shadow-xs"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">
                      {contract.reference || contract.type || "Contrat sans référence"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[contract.partie, contract.statut, contract.date_fin].filter(Boolean).join(" · ") || "Informations à compléter"}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-primary transition-transform transition-ui group-hover:translate-x-0.5">Ouvrir</span>
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) clearQuickCreate();
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Nouveau contrat</DialogTitle>
          </DialogHeader>
          <ContractForm
            onSuccess={() => {
              void queryClient.invalidateQueries({ queryKey: ["contracts"] });
              setOpen(false);
              clearQuickCreate();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
