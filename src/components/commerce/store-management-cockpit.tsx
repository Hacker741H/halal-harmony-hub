import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfMonth, format, startOfMonth, startOfYear, subDays, subMonths } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertCircle, ArrowRight, Banknote, CalendarDays, CircleDollarSign, History, Package, ReceiptText, RefreshCw, ShieldAlert, Store, TriangleAlert, WalletCards } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CashRemittanceWorkspace } from "@/components/commerce/cash-remittance-workspace";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cancelCommerceStoreExpense,
  cancelCommerceStorePlannedExpense,
  confirmCommerceStoreExpense,
  createCommerceStoreExpense,
  createCommerceStorePlannedExpense,
  getCommerceStoreCockpit,
  getCommercePosLocations,
  payCommerceStorePlannedExpense,
  type CommercePosLocation,
  type CommerceStoreCockpit,
  type StoreExpenseCategory,
} from "@/lib/commerce-pos.functions";

const money = (amount: number | null | undefined) => amount === null || amount === undefined ? "Non certifiable" : `${amount.toLocaleString("fr-FR")} FCFA`;
const number = (value: number) => value.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const day = (value: string) => format(new Date(`${value.slice(0, 10)}T00:00:00`), "d MMM yyyy", { locale: fr });
const dateTime = (value: string | null) => value ? format(new Date(value), "d MMM yyyy · HH:mm", { locale: fr }) : "Aucune activité";

const categories: Array<{ value: StoreExpenseCategory; label: string }> = [
  { value: "RENT", label: "Loyer" }, { value: "ELECTRICITY", label: "Électricité" }, { value: "WATER", label: "Eau" },
  { value: "INTERNET", label: "Internet / téléphone" }, { value: "MAINTENANCE", label: "Entretien" }, { value: "REPAIR", label: "Réparation" },
  { value: "TRANSPORT", label: "Transport" }, { value: "SUPPLIES", label: "Fournitures" }, { value: "TAX_FEE", label: "Taxes / frais" },
  { value: "SALARY_BONUS", label: "Salaires / primes" }, { value: "OTHER", label: "Autre" },
];
const categoryLabel = (value: string) => categories.find((category) => category.value === value)?.label ?? value;

type PeriodKey = "today" | "week" | "month" | "previousMonth" | "year" | "opening" | "custom";
const periodLabels: Record<PeriodKey, string> = {
  today: "Aujourd’hui", week: "7 jours", month: "Ce mois", previousMonth: "Mois précédent", year: "Cette année", opening: "Depuis l’ouverture", custom: "Personnalisé",
};

export function CommerceStoreManagementWorkspace({ onOpenCashier }: { onOpenCashier: () => void }) {
  const locationsQuery = useQuery({ queryKey: ["commerce-pos-locations"], queryFn: () => getCommercePosLocations() });
  const [locationId, setLocationId] = useState("");
  const selectedLocationId = locationId || locationsQuery.data?.[0]?.id || "";

  if (locationsQuery.isPending) return <CockpitSkeleton />;
  if (locationsQuery.isError) return <Card variant="information"><CardContent className="p-5">Impossible de charger les magasins auxquels vous avez accès.</CardContent></Card>;
  if (!locationsQuery.data?.length) return <Card variant="information"><CardHeader><CardTitle>Aucun magasin accessible</CardTitle></CardHeader><CardContent>Une affectation active à un magasin Commerce est nécessaire.</CardContent></Card>;

  return <StoreManagementCockpit locations={locationsQuery.data} locationId={selectedLocationId} onLocationChange={setLocationId} onOpenCashier={onOpenCashier} />;
}

function resolvePeriod(key: PeriodKey, openedAt?: string, custom?: { from: string; to: string }) {
  const today = new Date();
  const iso = (date: Date) => format(date, "yyyy-MM-dd");
  if (key === "today") return { from: iso(today), to: iso(today) };
  if (key === "week") return { from: iso(subDays(today, 6)), to: iso(today) };
  if (key === "previousMonth") { const previous = subMonths(today, 1); return { from: iso(startOfMonth(previous)), to: iso(endOfMonth(previous)) }; }
  if (key === "year") return { from: iso(startOfYear(today)), to: iso(today) };
  if (key === "opening" && openedAt) return { from: openedAt, to: iso(today) };
  if (key === "custom" && custom) return custom;
  return { from: iso(startOfMonth(today)), to: iso(today) };
}

export function StoreManagementCockpit({
  locations, locationId, onLocationChange, actions, onOpenCashier,
}: {
  locations: CommercePosLocation[];
  locationId: string;
  onLocationChange: (locationId: string) => void;
  actions?: ReactNode;
  onOpenCashier: () => void;
}) {
  const queryClient = useQueryClient();
  const [periodKey, setPeriodKey] = useState<PeriodKey>("month");
  const [customPeriod, setCustomPeriod] = useState(() => resolvePeriod("month"));
  const openedAt = queryClient.getQueryData<CommerceStoreCockpit>(["commerce-store-cockpit", locationId, customPeriod.from, customPeriod.to])?.location.openedAt;
  const period = resolvePeriod(periodKey, openedAt, customPeriod);
  const query = useQuery({
    queryKey: ["commerce-store-cockpit", locationId, period.from, period.to],
    queryFn: () => getCommerceStoreCockpit({ data: { locationId, from: period.from, to: period.to } }),
    enabled: Boolean(locationId),
  });
  const cockpit = query.data;
  const mainWallet = cockpit?.wallets.find((wallet) => wallet.isPrimary) ?? cockpit?.wallets[0];
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["commerce-store-cockpit", locationId] });
  };
  const mutate = useMutation({
    mutationFn: async (action: { type: "confirm-expense" | "cancel-expense" | "pay-charge" | "cancel-charge"; id: string; reason?: string }) => {
      if (action.type === "confirm-expense") {
        if (!mainWallet) throw new Error("Aucun wallet actif n’est associé au magasin.");
        return confirmCommerceStoreExpense({ data: { expenseId: action.id, walletId: mainWallet.id } });
      }
      if (action.type === "pay-charge") {
        if (!mainWallet) throw new Error("Aucun wallet actif n’est associé au magasin.");
        return payCommerceStorePlannedExpense({ data: { chargeId: action.id, walletId: mainWallet.id } });
      }
      if (action.type === "cancel-expense") return cancelCommerceStoreExpense({ data: { expenseId: action.id, reason: action.reason ?? "Annulation depuis le cockpit" } });
      return cancelCommerceStorePlannedExpense({ data: { chargeId: action.id, reason: action.reason ?? "Annulation depuis le cockpit" } });
    },
    onSuccess: async () => { await invalidate(); toast.success("Mise à jour enregistrée."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "La mise à jour a échoué."),
  });
  const cancelWithReason = (type: "cancel-expense" | "cancel-charge", id: string) => {
    const reason = window.prompt("Motif d’annulation (obligatoire)")?.trim();
    if (reason) mutate.mutate({ type, id, reason });
  };
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-4">
      <Card variant="section" className="overflow-hidden border-primary/20">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-primary">Cockpit magasin 360°</span>{cockpit ? <Status value={cockpit.location.status} /> : null}</div>
              <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight sm:text-3xl">{cockpit?.location.name ?? locations.find((location) => location.id === locationId)?.name ?? "Magasin"}</h1>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                <span>{cockpit?.location.address || "Localisation non renseignée"}</span>
                <span>Responsable : <strong className="font-medium text-foreground">{cockpit?.location.manager?.name ?? "Non affecté"}</strong></span>
                <span>Dernière activité : <strong className="font-medium text-foreground">{dateTime(cockpit?.location.lastActivityAt ?? null)}</strong></span>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 xl:w-auto xl:min-w-[28rem]">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><Select value={locationId} onValueChange={onLocationChange}><SelectTrigger className="h-10"><SelectValue /></SelectTrigger><SelectContent>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent></Select><Button className="h-10" onClick={onOpenCashier}><Store className="size-4" /> Ouvrir la caisse <ArrowRight className="size-4" /></Button></div>
              {actions ? <div className="flex flex-wrap justify-end gap-2">{actions}</div> : null}
            </div>
          </div>
          <div className="mt-4 border-t border-border/70 pt-3">
            <div className="flex flex-wrap items-center gap-1.5">{(Object.keys(periodLabels) as PeriodKey[]).map((key) => <Button key={key} type="button" size="sm" variant={periodKey === key ? "default" : "outline"} onClick={() => setPeriodKey(key)}>{periodLabels[key]}</Button>)}<Button type="button" size="icon-sm" variant="ghost" aria-label="Actualiser" onClick={() => void query.refetch()}><RefreshCw className={`size-4 ${query.isFetching ? "animate-spin" : ""}`} /></Button></div>
            {periodKey === "custom" ? <div className="mt-3 flex flex-wrap items-end gap-3"><div><Label htmlFor="cockpit-from" className="text-xs">Du</Label><Input id="cockpit-from" type="date" value={customPeriod.from} max={customPeriod.to} onChange={(event) => setCustomPeriod((current) => ({ ...current, from: event.target.value }))} /></div><div><Label htmlFor="cockpit-to" className="text-xs">Au</Label><Input id="cockpit-to" type="date" value={customPeriod.to} min={customPeriod.from} onChange={(event) => setCustomPeriod((current) => ({ ...current, to: event.target.value }))} /></div></div> : null}
          </div>
        </CardContent>
      </Card>

      {query.isPending ? <CockpitSkeleton /> : null}
      {query.isError ? <Card variant="information"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5"><div><p className="font-semibold">Le cockpit ne peut pas être chargé</p><p className="mt-1 text-sm text-muted-foreground">Les données du magasin n’ont pas été modifiées.</p></div><Button variant="outline" onClick={() => void query.refetch()}>Réessayer</Button></CardContent></Card> : null}
      {cockpit ? <>
        {!cockpit.costCertification?.selectedPeriodCertified && cockpit.access.financial ? <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/[0.08] p-3 text-sm"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" /><p><strong>Marge historique non certifiable sur toute la période.</strong> Le CMV, la marge brute et le résultat restent masqués lorsque chaque ligne article ne possède pas son snapshot STORE-02.</p></div> : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="Indicateurs essentiels">
          <Kpi label="CA total" value={money(cockpit.profitability?.totalRevenue)} detail={`Articles ${money(cockpit.profitability?.articleRevenue)} · Services ${money(cockpit.profitability?.serviceRevenue)}`} icon={CircleDollarSign} onClick={() => scrollTo("store-sales")} />
          <Kpi label="CMV" value={money(cockpit.profitability?.costOfGoodsSold)} detail="Snapshots historiques STORE-02" icon={Package} onClick={() => scrollTo("store-stock")} />
          <Kpi label="Marge brute" value={money(cockpit.profitability?.grossMargin)} detail="CA total − CMV" icon={ReceiptText} onClick={() => scrollTo("store-sales")} />
          <Kpi label="Dépenses" value={money(cockpit.profitability?.operatingExpenses)} detail="Confirmées sur la période" icon={Banknote} onClick={() => scrollTo("store-expenses")} />
          <Kpi label="Résultat net" value={money(cockpit.profitability?.netResult)} detail="Marge brute − dépenses" icon={ArrowRight} onClick={() => scrollTo("store-expenses")} />
          <Kpi label="Wallet principal" value={mainWallet ? money(mainWallet.balance) : "Non configuré"} detail="Trésorerie distincte du résultat" icon={WalletCards} onClick={() => scrollTo("store-finance")} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,.6fr)]">
          <Card variant="section" id="store-attention"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-lg"><TriangleAlert className="size-5 text-warning" /> À comprendre aujourd’hui</CardTitle></CardHeader><CardContent>{cockpit.attention.length ? <div className="divide-y divide-border/60">{cockpit.attention.map((alert) => <button key={`${alert.type}-${alert.id}`} type="button" className="flex w-full items-start gap-3 py-3 text-left" onClick={() => scrollTo(alert.type.includes("STOCK") ? "store-stock" : alert.type.includes("SYNC") ? "store-sync" : alert.type.includes("CASH") ? "store-cash" : alert.type.includes("WALLET") ? "store-finance" : "store-expenses")}><span className={`mt-1 size-2 rounded-full ${alert.priority === 1 ? "bg-destructive" : "bg-warning"}`} /><span className="min-w-0"><span className="block font-medium">{alert.title}</span><span className="mt-0.5 block text-sm text-muted-foreground">{alert.detail}</span></span><ArrowRight className="ml-auto mt-1 size-4 shrink-0 text-muted-foreground" /></button>)}</div> : <Empty label="Aucun élément déterminable ne nécessite une action immédiate." />}</CardContent></Card>
          <Card variant="information"><CardHeader className="pb-3"><CardTitle className="text-lg">Période analysée</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><DataRow label="Du" value={day(cockpit.period.from)} /><DataRow label="Au" value={day(cockpit.period.to)} /><DataRow label="Tickets" value={String(cockpit.sales?.ticketCount ?? 0)} /><DataRow label="Panier moyen" value={money(cockpit.sales?.averageBasket)} /><DataRow label="Wallets actifs" value={String(cockpit.wallets.length)} /></CardContent></Card>
        </section>

        <StockSection cockpit={cockpit} />
        <ExpensesSection cockpit={cockpit} locationId={locationId} mainWalletName={mainWallet?.name} pending={mutate.isPending} onMutate={(action) => mutate.mutate(action)} onCancel={cancelWithReason} onSaved={invalidate} />
        <SalesSection cockpit={cockpit} />
        <CashAndSyncSection cockpit={cockpit} />
        <CashRemittanceWorkspace locationId={locationId} />
        <FinanceSection cockpit={cockpit} />
        <TimelineSection cockpit={cockpit} />
      </> : null}
    </div>
  );
}

function CockpitSkeleton() { return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-28" />)}</div><div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div></div>; }
function Status({ value }: { value: string }) { return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${value === "ACTIVE" || value === "CONFIRMED" || value === "SYNCED" || value === "PROCESSED" || value === "PAID" ? "bg-success/10 text-success" : value === "CANCELLED" ? "bg-muted text-muted-foreground" : value === "REVIEW_REQUIRED" || value === "CONFLICT" || value === "OVERDUE" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>{value.replaceAll("_", " ")}</span>; }
function Empty({ label }: { label: string }) { return <div className="flex min-h-24 items-center justify-center text-center text-sm text-muted-foreground">{label}</div>; }
function DataRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium tabular-nums">{value}</span></div>; }
function Kpi({ label, value, detail, icon: Icon, onClick }: { label: string; value: string; detail: string; icon: typeof Store; onClick: () => void }) { return <button type="button" onClick={onClick} className="rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex items-start justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span><Icon className="size-4 text-primary" /></div><span className="mt-3 block text-xl font-semibold tabular-nums">{value}</span><span className="mt-1 block truncate text-xs text-muted-foreground" title={detail}>{detail}</span></button>; }

function StockSection({ cockpit }: { cockpit: CommerceStoreCockpit }) {
  return <Card variant="section" id="store-stock"><CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-lg">Stock & valorisation</CardTitle><p className="mt-1 text-sm text-muted-foreground">La marge potentielle est non réalisée et n’entre pas dans le résultat.</p></div>{cockpit.stock && !cockpit.stock.isComplete ? <Status value="INCOMPLET" /> : null}</div></CardHeader><CardContent>{!cockpit.access.stockValuation || !cockpit.stock ? <Restricted label="La valorisation, le CUMP et les prix d’achat sont réservés aux permissions STORE-02." /> : <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><DataRow label="Valeur au coût" value={money(cockpit.stock.costValue)} /><DataRow label="Vente potentielle" value={money(cockpit.stock.potentialSaleValue)} /><DataRow label="Marge potentielle" value={money(cockpit.stock.potentialMargin)} /><DataRow label="Références" value={String(cockpit.stock.itemCount)} /><DataRow label="Stock faible" value={String(cockpit.stock.lowStockCount)} /></div><details className="mt-4 rounded-lg border border-border"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Ouvrir le détail sensible ({cockpit.stock.items.length})</summary><div className="overflow-x-auto border-t border-border"><table className="w-full min-w-[980px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><Th>Référence</Th><Th>Désignation</Th><Th right>Quantité</Th><Th right>CUMP</Th><Th right>Valeur coût</Th><Th right>Prix vente</Th><Th right>Vente potentielle</Th><Th right>Marge potentielle</Th></tr></thead><tbody className="divide-y divide-border/60">{cockpit.stock.items.map((item) => <tr key={item.id} className={item.isLow ? "bg-warning/[0.05]" : undefined}><Td>{item.sku ?? "—"}</Td><Td strong>{item.name}</Td><Td right>{number(item.quantity)} {item.unit ?? ""}</Td><Td right>{money(item.unitCost)}</Td><Td right>{money(item.costValue)}</Td><Td right>{money(item.salePrice)}</Td><Td right>{money(item.potentialSaleValue)}</Td><Td right>{money(item.potentialMargin)}</Td></tr>)}</tbody></table></div></details></>}</CardContent></Card>;
}

function ExpensesSection({ cockpit, locationId, mainWalletName, pending, onMutate, onCancel, onSaved }: { cockpit: CommerceStoreCockpit; locationId: string; mainWalletName?: string; pending: boolean; onMutate: (action: { type: "confirm-expense" | "cancel-expense" | "pay-charge" | "cancel-charge"; id: string }) => void; onCancel: (type: "cancel-expense" | "cancel-charge", id: string) => void; onSaved: () => Promise<void> }) {
  const [tab, setTab] = useState<"paid" | "planned">("paid");
  return <Card variant="section" id="store-expenses"><CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-lg">Dépenses & charges</CardTitle><p className="mt-1 text-sm text-muted-foreground">Une charge à venir n’affecte le résultat qu’après paiement confirmé via STORE-02.</p></div><div className="flex gap-2">{cockpit.access.expensesCreate ? <><ExpenseCreateDialog locationId={locationId} planned={false} onSaved={onSaved} /><ExpenseCreateDialog locationId={locationId} planned onSaved={onSaved} /></> : null}</div></div></CardHeader><CardContent>{!cockpit.expenses ? <Restricted label="Les dépenses sensibles sont masquées pour ce rôle." /> : <><div className="mb-3 flex gap-1"><Button size="sm" variant={tab === "paid" ? "default" : "outline"} onClick={() => setTab("paid")}>Dépenses réelles</Button><Button size="sm" variant={tab === "planned" ? "default" : "outline"} onClick={() => setTab("planned")}>Charges à venir</Button></div>{tab === "paid" ? cockpit.expenses.rows.length ? <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[900px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><Th>Date</Th><Th>Catégorie / description</Th><Th right>Montant</Th><Th>Wallet</Th><Th>Créateur / confirmation</Th><Th>Finance</Th><Th>Statut / actions</Th></tr></thead><tbody className="divide-y divide-border/60">{cockpit.expenses.rows.map((expense) => <tr key={expense.id}><Td>{day(expense.expenseDate)}</Td><Td><strong>{categoryLabel(expense.category)}</strong><span className="block text-xs text-muted-foreground">{expense.description}</span></Td><Td right strong>{money(expense.amount)}</Td><Td>{expense.walletName ?? "—"}</Td><Td>{expense.createdBy}<span className="block text-xs text-muted-foreground">{expense.confirmedBy ? `Confirmé par ${expense.confirmedBy}` : "Non confirmée"}</span></Td><Td>{expense.financeReference ?? "—"}</Td><Td><div className="flex items-center gap-2"><Status value={expense.status} />{expense.status === "DRAFT" && cockpit.access.expensesConfirm ? <><Button size="sm" disabled={pending || !mainWalletName} title={`Wallet : ${mainWalletName ?? "absent"}`} onClick={() => onMutate({ type: "confirm-expense", id: expense.id })}>Confirmer</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => onCancel("cancel-expense", expense.id)}>Annuler</Button></> : null}</div></Td></tr>)}</tbody></table></div> : <Empty label="Aucune dépense sur cette période." /> : cockpit.expenses.planned.length ? <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[820px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><Th>Échéance</Th><Th>Catégorie / description</Th><Th right>Montant attendu</Th><Th>Référence</Th><Th>Statut</Th><Th>Actions</Th></tr></thead><tbody className="divide-y divide-border/60">{cockpit.expenses.planned.map((charge) => <tr key={charge.id} className={charge.timing === "OVERDUE" ? "bg-destructive/[0.04]" : undefined}><Td>{day(charge.dueDate)}</Td><Td><strong>{categoryLabel(charge.category)}</strong><span className="block text-xs text-muted-foreground">{charge.description}</span></Td><Td right strong>{money(charge.expectedAmount)}</Td><Td>{charge.reference ?? "—"}</Td><Td><Status value={charge.timing} /></Td><Td>{charge.status === "PLANNED" && cockpit.access.expensesConfirm ? <div className="flex gap-2"><Button size="sm" disabled={pending || !mainWalletName} title={`Wallet : ${mainWalletName ?? "absent"}`} onClick={() => onMutate({ type: "pay-charge", id: charge.id })}>Marquer payée</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => onCancel("cancel-charge", charge.id)}>Annuler</Button></div> : "—"}</Td></tr>)}</tbody></table></div> : <Empty label="Aucune charge planifiée." />}</>}</CardContent></Card>;
}

function ExpenseCreateDialog({ locationId, planned, onSaved }: { locationId: string; planned: boolean; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<StoreExpenseCategory>("OTHER");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const mutation = useMutation({
    mutationFn: () => planned
      ? createCommerceStorePlannedExpense({ data: { businessLocationId: locationId, category, expectedAmount: Number(amount), dueDate: date, description, reference: reference.trim() || null } })
      : createCommerceStoreExpense({ data: { businessLocationId: locationId, category, amount: Number(amount), expenseDate: date, description, reference: reference.trim() || null } }),
    onSuccess: async () => { setOpen(false); setAmount(""); setDescription(""); setReference(""); await onSaved(); toast.success(planned ? "Charge à venir ajoutée." : "Dépense brouillon ajoutée."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Création impossible."),
  });
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant={planned ? "outline" : "default"}>{planned ? <CalendarDays className="size-4" /> : <ReceiptText className="size-4" />}{planned ? "Planifier une charge" : "Nouvelle dépense"}</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{planned ? "Nouvelle charge à venir" : "Nouvelle dépense"}</DialogTitle><DialogDescription>{planned ? "Aucun impact financier avant son paiement confirmé." : "La dépense reste brouillon jusqu’à confirmation sur un wallet."}</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><div className="grid gap-2"><Label>Catégorie</Label><Select value={category} onValueChange={(value) => setCategory(value as StoreExpenseCategory)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor={`${planned ? "charge" : "expense"}-amount`}>Montant FCFA</Label><Input id={`${planned ? "charge" : "expense"}-amount`} type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor={`${planned ? "charge" : "expense"}-date`}>{planned ? "Échéance" : "Date"}</Label><Input id={`${planned ? "charge" : "expense"}-date`} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div></div><div className="grid gap-2"><Label htmlFor={`${planned ? "charge" : "expense"}-description`}>Description</Label><Input id={`${planned ? "charge" : "expense"}-description`} value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor={`${planned ? "charge" : "expense"}-reference`}>Référence (optionnelle)</Label><Input id={`${planned ? "charge" : "expense"}-reference`} value={reference} maxLength={160} onChange={(event) => setReference(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Fermer</Button><Button loading={mutation.isPending} disabled={!description.trim() || Number(amount) <= 0 || !date} onClick={() => mutation.mutate()}>Enregistrer</Button></DialogFooter></DialogContent></Dialog>;
}

function SalesSection({ cockpit }: { cockpit: CommerceStoreCockpit }) { return <Card variant="section" id="store-sales"><CardHeader className="pb-3"><CardTitle className="text-lg">Ventes & services</CardTitle></CardHeader><CardContent>{!cockpit.sales ? <Restricted label="Les montants commerciaux sont réservés aux permissions financières." /> : <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,.6fr)]"><div><div className="mb-3 grid gap-3 sm:grid-cols-3"><DataRow label="Tickets" value={String(cockpit.sales.ticketCount)} /><DataRow label="Panier moyen" value={money(cockpit.sales.averageBasket)} /><DataRow label="Annulations" value={String(cockpit.sales.cancelledCount)} /></div>{cockpit.sales.recent.length ? <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[700px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><Th>Ticket</Th><Th>Date</Th><Th>Contenu</Th><Th right>Total</Th><Th>Statut</Th></tr></thead><tbody className="divide-y divide-border/60">{cockpit.sales.recent.map((sale) => <tr key={sale.id}><Td strong>{sale.saleNumber}</Td><Td>{day(sale.saleDate)}</Td><Td>{sale.articleLines} article(s) · {sale.serviceLines} service(s)</Td><Td right strong>{money(sale.total)}</Td><Td><Status value={sale.status} /></Td></tr>)}</tbody></table></div> : <Empty label="Aucune vente sur cette période." />}</div><div className="space-y-4"><CompactRanking title="Meilleures ventes" rows={cockpit.sales.topItems.map((item) => ({ name: item.name, detail: `${number(item.quantity)} · ${money(item.revenue)}` }))} /><CompactRanking title="Services réalisés" rows={cockpit.sales.services.map((item) => ({ name: item.name, detail: `${number(item.quantity)} · ${money(item.revenue)}` }))} /></div></div>}</CardContent></Card>; }

function CashAndSyncSection({ cockpit }: { cockpit: CommerceStoreCockpit }) { return <div className="grid gap-4 xl:grid-cols-2"><Card variant="section" id="store-cash"><CardHeader className="pb-3"><CardTitle className="text-lg">Caisses</CardTitle></CardHeader><CardContent>{!cockpit.cash ? <Restricted label="Les clôtures sont réservées aux permissions caisse." /> : <><div className="mb-3 grid gap-3 sm:grid-cols-2"><DataRow label="À vérifier" value={String(cockpit.cash.reviewRequiredCount)} /><DataRow label="Sessions sans clôture serveur" value={String(cockpit.cash.unclosedSessionCount)} /></div>{cockpit.cash.closures.length ? <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><Th>Session / terminal</Th><Th>Caissier</Th><Th>Clôture</Th><Th right>Théorique</Th><Th right>Compté</Th><Th right>Écart</Th><Th>Statut</Th></tr></thead><tbody className="divide-y divide-border/60">{cockpit.cash.closures.map((closure) => <tr key={closure.id}><Td><strong>{closure.cashSessionId}</strong><span className="block text-xs text-muted-foreground">{closure.terminalId}</span></Td><Td>{closure.cashier}</Td><Td>{dateTime(closure.closedAt)}</Td><Td right>{money(closure.theoreticalCash)}</Td><Td right>{money(closure.countedCash)}</Td><Td right strong>{money(closure.difference)}</Td><Td><Status value={closure.status} /></Td></tr>)}</tbody></table></div> : <Empty label="Aucune clôture sur cette période." />}</>}</CardContent></Card><Card variant="section" id="store-sync"><CardHeader className="pb-3"><CardTitle className="text-lg">Synchronisation POS</CardTitle></CardHeader><CardContent>{!cockpit.sync ? <Restricted label="Les reçus de synchronisation sont réservés aux permissions caisse." /> : <><div className="mb-3 grid gap-3 sm:grid-cols-3"><DataRow label="Synchronisés" value={String(cockpit.sync.processedCount)} /><DataRow label="Conflits" value={String(cockpit.sync.conflictCount)} /><DataRow label="En attente" value={cockpit.sync.pendingCount === null ? "Local uniquement" : String(cockpit.sync.pendingCount)} /></div>{cockpit.sync.receipts.length ? <div className="divide-y divide-border/60 rounded-lg border border-border">{cockpit.sync.receipts.slice(0, 12).map((receipt) => <div key={receipt.id} className="flex flex-wrap items-center gap-3 p-3 text-sm"><div className="min-w-0 flex-1"><p className="truncate font-medium">{receipt.offlineSaleId}</p><p className="truncate text-xs text-muted-foreground">{receipt.terminalId} · {receipt.cashier} · {dateTime(receipt.receivedAtServer)}</p>{receipt.errorMessage ? <p className="mt-1 text-xs text-destructive">{receipt.errorMessage}</p> : null}</div><Status value={receipt.status} /></div>)}</div> : <Empty label="Aucune synchronisation reçue sur cette période." />}</>}</CardContent></Card></div>; }

function FinanceSection({ cockpit }: { cockpit: CommerceStoreCockpit }) { const walletTotal = useMemo(() => cockpit.wallets.reduce((sum, wallet) => sum + wallet.balance, 0), [cockpit.wallets]); return <Card variant="section" id="store-finance"><CardHeader className="pb-3"><CardTitle className="text-lg">Versements & trésorerie</CardTitle></CardHeader><CardContent>{!cockpit.finance ? <Restricted label="Le journal financier et les soldes sont réservés aux permissions STORE-02." /> : <><div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><DataRow label="Solde wallets" value={money(walletTotal)} /><DataRow label="Entrées période" value={money(cockpit.finance.inflows)} /><DataRow label="Sorties période" value={money(cockpit.finance.outflows)} /><DataRow label="Versements" value={String(cockpit.remittances.length)} /></div>{cockpit.finance.operations.length ? <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[820px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><Th>Date</Th><Th>Type</Th><Th>Catégorie / description</Th><Th>Wallet</Th><Th>Référence</Th><Th right>Montant</Th><Th>Statut</Th></tr></thead><tbody className="divide-y divide-border/60">{cockpit.finance.operations.map((operation) => <tr key={operation.id}><Td>{day(operation.date)}</Td><Td>{operation.type}</Td><Td><strong>{operation.category ?? "Opération"}</strong><span className="block text-xs text-muted-foreground">{operation.description ?? "—"}</span></Td><Td>{operation.walletName ?? "—"}</Td><Td>{operation.reference ?? "—"}</Td><Td right strong>{money(operation.amount)}</Td><Td><Status value={operation.status ?? "VALIDE"} /></Td></tr>)}</tbody></table></div> : <Empty label="Aucune opération financière sur cette période." />}</>}</CardContent></Card>; }

function TimelineSection({ cockpit }: { cockpit: CommerceStoreCockpit }) { return <Card variant="section" id="store-history"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-lg"><History className="size-5 text-primary" /> Historique du magasin</CardTitle></CardHeader><CardContent>{cockpit.timeline.length ? <div className="relative ml-2 border-l border-border pl-5">{cockpit.timeline.map((event) => <div key={`${event.type}-${event.id}`} className="relative pb-4"><span className="absolute -left-[1.57rem] top-1.5 size-2.5 rounded-full border-2 border-card bg-primary" /><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{event.title}</p><p className="mt-0.5 text-sm text-muted-foreground">{event.type.replaceAll("_", " ")} · {event.detail ?? "Aucun détail financier exposé"}</p></div><div className="text-right"><p className="text-xs text-muted-foreground">{dateTime(event.occurredAt)}</p>{event.status ? <div className="mt-1"><Status value={event.status} /></div> : null}</div></div></div>)}</div> : <Empty label="Aucun événement sur cette période." />}</CardContent></Card>; }
function Restricted({ label }: { label: string }) { return <div className="flex min-h-28 items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-4 text-center text-sm text-muted-foreground"><AlertCircle className="size-4 shrink-0" />{label}</div>; }
function CompactRanking({ title, rows }: { title: string; rows: Array<{ name: string; detail: string }> }) { return <div className="rounded-lg border border-border"><h3 className="border-b border-border px-3 py-2 text-sm font-semibold">{title}</h3>{rows.length ? <ol className="divide-y divide-border/60">{rows.map((row, index) => <li key={`${row.name}-${index}`} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="w-5 text-xs text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 truncate font-medium">{row.name}</span><span className="text-xs tabular-nums text-muted-foreground">{row.detail}</span></li>)}</ol> : <Empty label="Aucune donnée exacte." />}</div>; }
function Th({ children, right }: { children: ReactNode; right?: boolean }) { return <th className={`px-3 py-2 font-semibold ${right ? "text-right" : ""}`}>{children}</th>; }
function Td({ children, right, strong }: { children: ReactNode; right?: boolean; strong?: boolean }) { return <td className={`px-3 py-2.5 align-top ${right ? "text-right tabular-nums" : ""} ${strong ? "font-medium" : ""}`}>{children}</td>; }
