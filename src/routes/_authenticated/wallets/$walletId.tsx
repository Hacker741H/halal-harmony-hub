import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowUpCircle,
  Banknote,
  CircleDollarSign,
  Landmark,
  ListFilter,
  Plus,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { WalletForm } from "@/components/wallet-form";
import { WalletParentConversionDialog } from "@/components/wallet-parent-conversion-dialog";
import { formatDate, formatXOF } from "@/lib/format";
import { getCommercialSales } from "@/lib/commercial-sales.functions";
import {
  FINANCE_OPERATION_TYPE_LABELS,
  getFinanceOperationsByWallet,
  getFinanceOperationsByWalletGroup,
} from "@/lib/finance.functions";
import { getWallet, getWalletChildren } from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/wallets/$walletId")({
  component: WalletDetailsPage,
});

const format = formatXOF;
const ALL_CHILDREN = "ALL";
const RECEIVABLES = "RECEIVABLES";

const WALLET_TYPE_ICONS: Record<string, typeof WalletCards> = {
  CASH: Banknote,
  WAVE: WalletCards,
  ORANGE_MONEY: WalletCards,
  MTN_MOMO: WalletCards,
  BANK: Landmark,
  SAVINGS: Landmark,
  JEKO: WalletCards,
  ASSET: WalletCards,
};

function WalletDetailsPage() {
  const { walletId } = Route.useParams();
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedChildId, setSelectedChildId] = useState<string>(ALL_CHILDREN);
  const [createOpen, setCreateOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const walletQuery = useQuery({
    queryKey: ["wallet", walletId],
    queryFn: () => getWallet({ data: walletId }),
  });
  const childrenQuery = useQuery({
    queryKey: ["wallet-children", walletId],
    queryFn: () => getWalletChildren({ data: walletId }),
  });
  const children = childrenQuery.data ?? [];
  const hasChildren = children.length > 0;

  // Existing pattern already used by /sales itself ("Sur la page affichée"):
  // no global receivables RPC exists yet, so this sums the currently-loaded
  // page of confirmed sales rather than inventing a new aggregate.
  const receivablesQuery = useQuery({
    queryKey: ["receivables-total-preview"],
    queryFn: () => getCommercialSales({ data: { page: 1, pageSize: 100, search: "", status: "CONFIRMED", clientId: null, farmId: null, from: null, to: null } }),
    enabled: hasChildren,
  });
  const receivablesTotal = (receivablesQuery.data?.sales ?? []).reduce((sum, sale) => sum + (sale.amountDue ?? 0), 0);

  const operationsQuery = useQuery({
    queryKey: hasChildren
      ? ["wallet-operations-group", walletId, selectedChildId]
      : ["wallet-operations", walletId],
    queryFn: () => {
      if (!hasChildren || selectedChildId === RECEIVABLES) return Promise.resolve([]);
      if (selectedChildId === ALL_CHILDREN) return getFinanceOperationsByWalletGroup({ data: [walletId, ...children.map((child) => child.id)] });
      return getFinanceOperationsByWallet({ data: selectedChildId });
    },
    enabled: !hasChildren || selectedChildId !== RECEIVABLES,
  });

  if (walletQuery.isPending) {
    return <p className="text-muted-foreground">Chargement du wallet…</p>;
  }

  if (walletQuery.isError) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <p className="font-medium text-destructive">Impossible de charger ce wallet.</p>
          <p className="text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void walletQuery.refetch()}>Réessayer</Button>
        </CardContent>
      </Card>
    );
  }

  const wallet = walletQuery.data;
  if (!wallet) {
    return (
      <Card>
        <CardContent className="p-6">Wallet introuvable.</CardContent>
      </Card>
    );
  }

  const operations = selectedChildId === RECEIVABLES ? [] : operationsQuery.data ?? [];
  const invalidPeriod = Boolean(fromDate && toDate && fromDate > toDate);
  const displayedOperations = invalidPeriod
    ? []
    : operations.filter(
        (operation) =>
          (!fromDate || operation.operation_date >= fromDate) &&
          (!toDate || operation.operation_date <= toDate),
      );
  const isPeriodFiltered = Boolean(fromDate || toDate);
  const walletType = wallet.type?.toUpperCase();
  const isWave = walletType === "WAVE" || /wave/i.test(wallet.name);
  const walletOwnBalance = Number(wallet.balance ?? 0);
  const walletTypeLabel = walletType === "JEKO" ? "Jèko" : wallet.type;
  const consolidatedBalance = hasChildren
    ? children.reduce((sum, child) => sum + Number(child.balance ?? 0), 0)
    : Number(wallet.balance ?? 0);
  // Group = this wallet plus, when it has children, every sub-wallet -- the
  // same set already passed to getFinanceOperationsByWalletGroup. A
  // transfer with BOTH legs inside the group (e.g. Wave -> Espèces under
  // Marasse) is purely internal: it must move neither the consolidated
  // entrée nor the consolidée sortie, only a transfer crossing the group's
  // boundary counts. It still appears in the journal below, unchanged.
  const groupIds = hasChildren ? new Set<string>([walletId, ...children.map((child) => child.id)]) : null;
  const isInGroup = (id: string | null) => (id ? (groupIds ? groupIds.has(id) : id === walletId) : false);
  const incoming = displayedOperations
    .filter((operation) =>
      operation.type === "TRANSFER"
        ? isInGroup(operation.destination_wallet_id) && !isInGroup(operation.wallet_id)
        : isInGroup(operation.wallet_id) && ["REVENUE", "DEPOSIT"].includes(operation.type),
    )
    .reduce((sum, operation) => sum + Number(operation.amount), 0);
  const outgoing = displayedOperations
    .filter((operation) =>
      operation.type === "TRANSFER"
        ? isInGroup(operation.wallet_id) && !isInGroup(operation.destination_wallet_id)
        : isInGroup(operation.wallet_id) && operation.type === "EXPENSE",
    )
    .reduce((sum, operation) => sum + Number(operation.amount), 0);

  function openCreateSubWallet() {
    // First sub-wallet of a still-funded wallet needs the explicit,
    // controlled distribution flow -- never a silent balance move.
    if (!hasChildren && walletOwnBalance !== 0) {
      setConvertOpen(true);
    } else {
      setCreateOpen(true);
    }
  }

  async function refreshAfterChildChange() {
    setCreateOpen(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["wallets"] }),
      queryClient.invalidateQueries({ queryKey: ["wallet-children", walletId] }),
    ]);
  }

  return (
    <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
      <Button asChild variant="ghost">
        <Link to="/wallets">
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Retour aux wallets
        </Link>
      </Button>

      <OperationalHero
        variant="deep"
        icon={WalletCards}
        eyebrow="Wallet"
        title={wallet.name}
        description={
          hasChildren
            ? "Solde consolidé de ce wallet parent et de tous ses sous-wallets."
            : "Le solde global et les écritures réellement rattachées à ce wallet, sans confondre les flux des autres activités."
        }
        primaryStat={{ label: hasChildren ? "Solde consolidé" : "Solde disponible", value: format(consolidatedBalance), tone: consolidatedBalance < 0 ? "danger" : "neutral" }}
        secondaryStats={hasChildren ? [{ label: "Sous-wallets", value: children.length }] : [{ label: "Mouvements affichés", value: displayedOperations.length }]}
        actions={
          <>
            <Badge variant="success" appearance="soft" className="w-fit">
              Wallet actif · {walletTypeLabel}
            </Badge>
            <Button variant="outline" onClick={openCreateSubWallet}>
              <Plus className="h-4 w-4" />
              Créer un sous-wallet
            </Button>
          </>
        }
      />

      {hasChildren ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedChildId(ALL_CHILDREN)}
            className={`rounded-xl border px-4 py-2.5 text-left transition-ui ${selectedChildId === ALL_CHILDREN ? "border-primary bg-primary/10" : "border-border/75 bg-surface hover:border-primary/25"}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tous</p>
            <p className="mt-0.5 font-semibold tabular-nums">{format(consolidatedBalance)}</p>
          </button>
          {children.map((child) => {
            const Icon = WALLET_TYPE_ICONS[child.type?.toUpperCase() ?? ""] ?? WalletCards;
            const active = selectedChildId === child.id;
            return (
              <button
                key={child.id}
                type="button"
                onClick={() => setSelectedChildId(child.id)}
                className={`flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-left transition-ui ${active ? "border-primary bg-primary/10" : "border-border/75 bg-surface hover:border-primary/25"}`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{child.name}</span>
                  <span className="block font-semibold tabular-nums">{format(Number(child.balance ?? 0))}</span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setSelectedChildId(RECEIVABLES)}
            className={`flex items-center gap-2.5 rounded-xl border border-dashed px-4 py-2.5 text-left transition-ui ${selectedChildId === RECEIVABLES ? "border-info bg-info/10" : "border-border/75 bg-surface hover:border-info/40"}`}
          >
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${selectedChildId === RECEIVABLES ? "bg-info/15 text-info" : "bg-muted text-muted-foreground"}`}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Créances</span>
              <span className="block font-semibold tabular-nums">
                {receivablesQuery.isPending ? "…" : format(receivablesTotal)}
              </span>
            </span>
          </button>
        </div>
      ) : (
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
      )}

      {selectedChildId === RECEIVABLES ? (
        <Card variant="information" className="flex items-start gap-3 p-5">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden="true" />
          <div>
            <p className="font-semibold text-foreground">Créances — montants à recevoir</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ceci n'est pas un wallet transactionnel : ce montant vient des ventes commerciales confirmées non réglées, pas du solde d'un wallet. Il n'est
              jamais inclus dans la trésorerie consolidée ci-dessus.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link to="/sales">Voir les ventes concernées</Link>
            </Button>
          </div>
        </Card>
      ) : null}

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

      {walletType === "JEKO" && !hasChildren ? (
        <Card variant="information" className="flex items-start gap-3 p-5">
          <div className="rounded-xl bg-primary p-2 text-primary-foreground shadow-xs">
            <CircleDollarSign className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Compte marchand Jèko</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Les encaissements Jèko sont crédités ici. Enregistrez un transfert vers Wave uniquement après le reversement réellement reçu.
            </p>
          </div>
        </Card>
      ) : null}

      {selectedChildId !== RECEIVABLES ? (
        <>
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
              <CardTitle>{hasChildren && selectedChildId === ALL_CHILDREN ? "Journal consolidé" : "Journal du wallet"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {operationsQuery.isPending ? (
                <p className="text-muted-foreground">Chargement…</p>
              ) : operationsQuery.isError ? (
                <div className="py-8 text-center">
                  <p className="font-medium text-destructive">Impossible de charger le journal.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
                </div>
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
                        {operation.category || operation.description || FINANCE_OPERATION_TYPE_LABELS[operation.type as keyof typeof FINANCE_OPERATION_TYPE_LABELS]}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(operation.operation_date)} · {FINANCE_OPERATION_TYPE_LABELS[operation.type as keyof typeof FINANCE_OPERATION_TYPE_LABELS] ?? operation.type}
                        {isInGroup(operation.destination_wallet_id) ? " · transfert reçu" : ""}
                      </p>
                      <Badge className="mt-2 w-fit" variant="info" appearance="soft">
                        Wallet concerné : {operation.wallet?.name ?? operation.destination_wallet?.name ?? wallet.name}
                      </Badge>
                    </div>
                    <p
                      className={`font-semibold ${isInGroup(operation.wallet_id) && ["EXPENSE", "TRANSFER"].includes(operation.type) ? "text-destructive" : "text-success"}`}
                    >
                      {isInGroup(operation.wallet_id) && ["EXPENSE", "TRANSFER"].includes(operation.type)
                        ? "−"
                        : "+"}
                      {format(Number(operation.amount))}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nouveau sous-wallet de "{wallet.name}"</DialogTitle>
          </DialogHeader>
          <WalletForm defaultParentWalletId={walletId} onSuccess={() => void refreshAfterChildChange()} />
        </DialogContent>
      </Dialog>

      <WalletParentConversionDialog
        wallet={wallet}
        open={convertOpen}
        onOpenChange={setConvertOpen}
        onSuccess={() => void refreshAfterChildChange()}
      />
    </div>
  );
}
