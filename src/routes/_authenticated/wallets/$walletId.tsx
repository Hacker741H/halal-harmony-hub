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
  Search,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WalletForm } from "@/components/wallet-form";
import { WalletParentConversionDialog } from "@/components/wallet-parent-conversion-dialog";
import { formatDateTimeMedium, formatXOF } from "@/lib/format";
import { getCommercialSales } from "@/lib/commercial-sales.functions";
import {
  FINANCE_MODULE_LABELS,
  FINANCE_OPERATION_STATUS_LABELS,
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
const ALL_TYPES = "ALL";

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
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES);
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
      // Un wallet simple (sans sous-wallet) doit toujours afficher ses
      // propres opérations -- l'absence de sous-wallet ne doit jamais
      // masquer l'historique. Seul un wallet PARENT avec au moins un enfant
      // bascule vers la vue groupée (régression corrigée : cette condition
      // renvoyait [] pour tout wallet sans enfant, quel que soit son
      // historique réel).
      if (selectedChildId === RECEIVABLES) return Promise.resolve([]);
      if (!hasChildren) return getFinanceOperationsByWallet({ data: walletId });
      if (selectedChildId === ALL_CHILDREN) return getFinanceOperationsByWalletGroup({ data: [walletId, ...children.map((child) => child.id)] });
      return getFinanceOperationsByWallet({ data: selectedChildId });
    },
    enabled: selectedChildId !== RECEIVABLES,
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
  // Une opération ANNULÉE reste visible dans le journal (avec son statut),
  // mais ne doit jamais gonfler entrées/sorties -- elle ne s'est jamais
  // vraiment produite.
  function computeFlows(list: typeof operations) {
    const incoming = list
      .filter((operation) =>
        operation.status !== "CANCELLED" &&
        (operation.type === "TRANSFER"
          ? isInGroup(operation.destination_wallet_id) && !isInGroup(operation.wallet_id)
          : isInGroup(operation.wallet_id) && ["REVENUE", "DEPOSIT"].includes(operation.type)),
      )
      .reduce((sum, operation) => sum + Number(operation.amount), 0);
    const outgoing = list
      .filter((operation) =>
        operation.status !== "CANCELLED" &&
        (operation.type === "TRANSFER"
          ? isInGroup(operation.wallet_id) && !isInGroup(operation.destination_wallet_id)
          : isInGroup(operation.wallet_id) && operation.type === "EXPENSE"),
      )
      .reduce((sum, operation) => sum + Number(operation.amount), 0);
    return { incoming, outgoing };
  }
  // Vue "à date" (jamais filtrée par période) : le résumé toujours visible
  // juste sous le hero. La ligne période-filtrée plus bas, elle, reflète le
  // filtre de date choisi juste au-dessus du journal.
  const allTimeFlows = computeFlows(operations);
  const { incoming, outgoing } = computeFlows(displayedOperations);
  const searchTerm = search.trim().toLowerCase();
  const visibleOperations = displayedOperations.filter((operation) => {
    if (typeFilter !== ALL_TYPES && operation.type !== typeFilter) return false;
    if (!searchTerm) return true;
    return [operation.category, operation.description, operation.reference]
      .filter(Boolean)
      .some((field) => field!.toLowerCase().includes(searchTerm));
  });

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
        description={hasChildren ? `Wallet parent · consolidé avec ${children.length} sous-wallet${children.length > 1 ? "s" : ""}` : `Wallet principal · ${walletTypeLabel}`}
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={hasChildren ? "Solde consolidé" : "Solde disponible"}
          value={format(consolidatedBalance)}
          description="Toutes les opérations comprises"
          icon={WalletCards}
          tone={consolidatedBalance < 0 ? "danger" : "primary"}
        />
        <MetricCard icon={ArrowUpCircle} label="Entrées" value={format(allTimeFlows.incoming)} description="Depuis l’ouverture du wallet" tone="success" />
        <MetricCard icon={ArrowDownCircle} label="Sorties" value={format(allTimeFlows.outgoing)} description="Depuis l’ouverture du wallet" tone="danger" />
        <MetricCard
          icon={Repeat}
          label="Opérations"
          value={operations.length}
          description="Écritures au total pour ce wallet"
          tone="info"
        />
      </div>

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
      ) : null}

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
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>{hasChildren && selectedChildId === ALL_CHILDREN ? "Journal consolidé" : "Journal du wallet"}</CardTitle>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Rechercher (libellé, référence)…"
                    className="pl-8 sm:w-56"
                  />
                </div>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-10 sm:w-44">
                    <span className="flex items-center gap-2">
                      <ListFilter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <SelectValue />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_TYPES}>Tous les types</SelectItem>
                    {Object.entries(FINANCE_OPERATION_TYPE_LABELS).map(([type, label]) => (
                      <SelectItem key={type} value={type}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {operationsQuery.isPending ? (
                <p className="text-muted-foreground">Chargement…</p>
              ) : operationsQuery.isError ? (
                <div className="py-8 text-center">
                  <p className="font-medium text-destructive">Impossible de charger le journal.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
                </div>
              ) : visibleOperations.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">
                  {displayedOperations.length > 0
                    ? "Aucune opération ne correspond à ce filtre."
                    : isPeriodFiltered
                      ? "Aucune opération sur cette période."
                      : "Aucune opération pour ce wallet."}
                </p>
              ) : (
                <div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">
                  {visibleOperations.map((operation) => {
                    const isOutflow = isInGroup(operation.wallet_id) && ["EXPENSE", "TRANSFER"].includes(operation.type);
                    const isCancelled = operation.status === "CANCELLED";
                    const statusLabel = FINANCE_OPERATION_STATUS_LABELS[operation.status ?? ""] ?? operation.status ?? "Validée";
                    const moduleLabel = operation.module
                      ? FINANCE_MODULE_LABELS[operation.module as keyof typeof FINANCE_MODULE_LABELS] ?? operation.module
                      : null;
                    return (
                      <div
                        key={operation.id}
                        className={`flex flex-col justify-between gap-3 rounded-xl border p-4 transition-ui hover:shadow-xs sm:flex-row sm:items-start ${isCancelled ? "border-destructive/20 bg-destructive/[0.03]" : "border-border/75 bg-surface/70 hover:border-primary/25"}`}
                      >
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground">
                              {operation.category || operation.description || FINANCE_OPERATION_TYPE_LABELS[operation.type as keyof typeof FINANCE_OPERATION_TYPE_LABELS]}
                            </p>
                            <Badge variant={isCancelled ? "danger" : "success"} appearance="soft">{statusLabel}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {formatDateTimeMedium(operation.created_at)} · {FINANCE_OPERATION_TYPE_LABELS[operation.type as keyof typeof FINANCE_OPERATION_TYPE_LABELS] ?? operation.type}
                            {isInGroup(operation.destination_wallet_id) ? " · transfert reçu" : ""}
                          </p>
                          {operation.reference ? (
                            <p className="truncate text-xs text-muted-foreground">Réf. {operation.reference}</p>
                          ) : null}
                          <div className="flex flex-wrap gap-1.5">
                            <Badge variant="info" appearance="soft">
                              Wallet concerné : {operation.wallet?.name ?? operation.destination_wallet?.name ?? wallet.name}
                            </Badge>
                            {moduleLabel ? (
                              <Badge variant="neutral" appearance="outline">{moduleLabel}</Badge>
                            ) : null}
                          </div>
                        </div>
                        <p
                          className={`shrink-0 font-semibold tabular-nums ${isCancelled ? "text-muted-foreground line-through" : isOutflow ? "text-destructive" : "text-success"}`}
                        >
                          {isOutflow ? "−" : "+"}
                          {format(Number(operation.amount))}
                        </p>
                      </div>
                    );
                  })}
                </div>
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
