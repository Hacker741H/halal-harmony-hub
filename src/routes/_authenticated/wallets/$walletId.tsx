import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowUpCircle,
  CircleDollarSign,
  ListFilter,
  RefreshCw,
  Repeat,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { ModuleHero } from "@/components/ui/module-hero";
import { getFinanceOperationsByWallet } from "@/lib/finance.functions";
import { getWallet } from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/wallets/$walletId")({
  component: WalletDetailsPage,
});

const format = (value: number) => `${value.toLocaleString("fr-FR")} FCFA`;

function WalletDetailsPage() {
  const { walletId } = Route.useParams();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const walletQuery = useQuery({
    queryKey: ["wallet", walletId],
    queryFn: () => getWallet({ data: walletId }),
  });
  const operationsQuery = useQuery({
    queryKey: ["wallet-operations", walletId],
    queryFn: () => getFinanceOperationsByWallet({ data: walletId }),
  });

  if (walletQuery.isPending) {
    return <p className="text-muted-foreground">Chargement du wallet…</p>;
  }

  const wallet = walletQuery.data;
  if (!wallet) {
    return (
      <Card>
        <CardContent className="p-6">Wallet introuvable.</CardContent>
      </Card>
    );
  }

  const operations = operationsQuery.data ?? [];
  const invalidPeriod = Boolean(fromDate && toDate && fromDate > toDate);
  const displayedOperations = invalidPeriod
    ? []
    : operations.filter(
        (operation) =>
          (!fromDate || operation.operation_date >= fromDate) &&
          (!toDate || operation.operation_date <= toDate),
      );
  const isPeriodFiltered = Boolean(fromDate || toDate);
  const isWave = wallet.type === "WAVE" || /wave/i.test(wallet.name);
  const incoming = displayedOperations
    .filter(
      (operation) =>
        (operation.wallet_id === walletId && ["REVENUE", "DEPOSIT"].includes(operation.type)) ||
        (operation.destination_wallet_id === walletId && operation.type === "TRANSFER"),
    )
    .reduce((sum, operation) => sum + Number(operation.amount), 0);
  const outgoing = displayedOperations
    .filter((operation) => operation.wallet_id === walletId && ["EXPENSE", "TRANSFER"].includes(operation.type))
    .reduce((sum, operation) => sum + Number(operation.amount), 0);

  return (
    <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
      <Button asChild variant="ghost">
        <Link to="/wallets">
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Retour aux wallets
        </Link>
      </Button>

      <ModuleHero
        icon={WalletCards}
        eyebrow="Trésorerie & mouvements"
        title={wallet.name}
        description="Le solde global et les écritures réellement rattachées à ce wallet, sans confondre les flux des autres activités."
        className={isWave ? "border-info/25" : undefined}
        actions={
          <Badge variant="success" appearance="soft" className="w-fit">
            Wallet actif · {wallet.type}
          </Badge>
        }
      >
        <div className="grid gap-3 sm:max-w-xl sm:grid-cols-2">
          <MetricCard
            label="Solde disponible"
            value={format(Number(wallet.balance ?? 0))}
            description="Toutes les opérations comprises"
            icon={WalletCards}
            tone="primary"
          />
          <MetricCard
            label="Mouvements affichés"
            value={displayedOperations.length}
            description={isPeriodFiltered ? "Sur la période sélectionnée" : "Depuis l’ouverture du wallet"}
            icon={ListFilter}
            tone="info"
          />
        </div>
      </ModuleHero>

      {isWave ? (
        <Card variant="information" className="grid gap-4 p-5 md:grid-cols-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-info p-2 text-info-foreground shadow-xs">
              <img src="/wave-logo.svg" alt="Wave" className="h-8 w-8" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Wave Business</p>
              <p className="text-sm text-muted-foreground">Connexion API en attente</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 text-info" aria-hidden="true" />
            Dernière synchronisation : non disponible
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-info" aria-hidden="true" />
            Clé API requise et stockée côté serveur
          </div>
        </Card>
      ) : null}

      <Card variant="section" className="flex flex-col gap-4 p-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-medium text-foreground">Période des mouvements affichés</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isPeriodFiltered
              ? "Les entrées, sorties et l’historique ci-dessous sont filtrés. Le solde disponible reste le solde global du wallet."
              : "Choisissez la même période qu’un rapport Chauffeur pour rapprocher les montants."}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto] sm:items-end">
          <label className="grid gap-1.5 text-sm font-medium text-muted-foreground">
            <span>Du</span>
            <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-muted-foreground">
            <span>Au</span>
            <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
            disabled={!isPeriodFiltered}
          >
            Tout afficher
          </Button>
        </div>
      </Card>

      {invalidPeriod ? (
        <p className="text-sm font-medium text-destructive">
          La date de fin doit être postérieure ou égale à la date de début.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={ArrowUpCircle} label="Entrées" value={format(incoming)} description="Flux entrants rattachés" tone="success" />
        <MetricCard icon={ArrowDownCircle} label="Sorties" value={format(outgoing)} description="Flux sortants rattachés" tone="danger" />
        <MetricCard
          icon={CircleDollarSign}
          label={isPeriodFiltered ? "Solde de la période" : "Solde des mouvements"}
          value={format(incoming - outgoing)}
          description="Entrées moins sorties affichées"
          tone="info"
        />
        <MetricCard
          icon={Repeat}
          label="Opérations"
          value={`${displayedOperations.length} opération${displayedOperations.length > 1 ? "s" : ""}`}
          description="Écritures visibles dans le journal"
          tone="primary"
        />
      </div>

      <Card variant="analytics">
        <CardHeader>
          <CardTitle>Journal du wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {operationsQuery.isPending ? (
            <p className="text-muted-foreground">Chargement…</p>
          ) : displayedOperations.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              {isPeriodFiltered ? "Aucune opération sur cette période." : "Aucune opération pour ce wallet."}
            </p>
          ) : (
            displayedOperations.map((operation) => (
              <div
                key={operation.id}
                className="group flex flex-col justify-between gap-3 rounded-xl border border-border/75 bg-surface/70 p-4 transition-ui hover:border-primary/25 hover:shadow-xs sm:flex-row sm:items-center"
              >
                <div>
                  <p className="font-medium">
                    {operation.category || operation.description || operation.type}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {operation.operation_date} · {operation.type}
                    {operation.destination_wallet_id === walletId ? " · transfert reçu" : ""}
                  </p>
                  <Badge className="mt-2 w-fit" variant="info" appearance="soft">
                    Wallet concerné : {wallet.name}
                  </Badge>
                </div>
                <p
                  className={`font-semibold ${operation.wallet_id === walletId && ["EXPENSE", "TRANSFER"].includes(operation.type) ? "text-destructive" : "text-success"}`}
                >
                  {operation.wallet_id === walletId && ["EXPENSE", "TRANSFER"].includes(operation.type)
                    ? "−"
                    : "+"}
                  {format(Number(operation.amount))}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
