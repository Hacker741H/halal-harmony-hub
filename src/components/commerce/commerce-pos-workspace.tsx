import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Banknote, BarChart3, Check, CheckCircle2, CircleDollarSign, CloudOff, CloudUpload, CreditCard, ListTodo, LogOut, Minus, Package, PackagePlus, Pencil, Plus, ReceiptText, Search, ShoppingCart, Smartphone, Store, TrendingUp, TriangleAlert, Trash2, UserPlus, UserRoundX, WalletCards, Warehouse, Wrench, X } from "lucide-react";
import { toast } from "sonner";

import { PosCashSessionClose } from "@/components/commerce/pos-cash-session-close";
import { StoreManagementCockpit } from "@/components/commerce/store-management-cockpit";
import { ClientSelect } from "@/components/selects/entity-selects";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  assignCommerceLocationUser,
  configureCommerceLocationItem,
  createCommerceCashSale,
  endCommerceLocationAssignment,
  getCommerceInventoryCatalogue,
  getCommerceLocationAssignments,
  getCommerceManagementDashboard,
  getCommercePosLocations,
  getCommercePosWorkspace,
  getCommerceSetupOptions,
  receiveCommerceInventoryItem,
  setupCommerceLocation,
  updateCommerceLocation,
  type CommercePosLocation,
} from "@/lib/commerce-pos.functions";
import { getWallets } from "@/lib/wallet.functions";
import { useCommercePosSession } from "@/hooks/use-commerce-pos-session";
import { useCurrentUserAccess } from "@/hooks/use-current-user-access";
import { usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/integrations/supabase/client";
import { cachePosOfflineLocations, findPosOfflineDraftLocation, getCachedPosOfflineLocations } from "@/lib/commerce-pos-offline";
import { createCommercePosId, findCommercePosDraftLocation, getCommercePosStockConflicts, type CommercePosDraftLine, type CommercePosPaymentMethod, type CommercePosSuspendedTicket } from "@/lib/commerce-pos-session";

type CartLine = CommercePosDraftLine;
type PaymentMethod = CommercePosPaymentMethod;

const money = (amount: number) => `${amount.toLocaleString("fr-FR")} FCFA`;

const paymentMethods: Array<{ value: PaymentMethod; label: string; icon: typeof Banknote }> = [
  { value: "CASH", label: "Espèces", icon: Banknote },
  { value: "WAVE", label: "Wave", icon: Smartphone },
  { value: "JEKO", label: "Jèko", icon: Smartphone },
  { value: "CARD", label: "Carte", icon: CreditCard },
  { value: "OTHER", label: "Autre", icon: WalletCards },
];

export function CommercePosWorkspace() {
  const { canAny, isPending } = usePermissions();
  const [workspaceMode, setWorkspaceMode] = useState<"management" | "cashier">("management");
  const canUseManagementWorkspace = canAny(["locations.manage", "commerce.stock.receive", "sales.finance.read", "store.financial.read", "store.stock_valuation.read", "store.expenses.read"]);

  if (isPending) return <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-48 lg:col-span-2" /><Skeleton className="h-48" /></div>;
  if (canUseManagementWorkspace && workspaceMode === "management") {
    return <CommerceManagementWorkspace onOpenCashier={() => setWorkspaceMode("cashier")} />;
  }
  return <CommerceCashierWorkspace onBackToManagement={canUseManagementWorkspace ? () => setWorkspaceMode("management") : undefined} />;
}

function CommerceManagementWorkspace({ onOpenCashier }: { onOpenCashier: () => void }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canManageStock = can("commerce.stock.receive");
  const canReceiveCommerceInventory = canManageStock && can("stocks.manage");
  const canManageLocations = can("locations.manage") && can("locations.wallets.manage") && can("locations.assign");
  const locationsQuery = useQuery({ queryKey: ["commerce-pos-locations"], queryFn: () => getCommercePosLocations() });
  const [locationId, setLocationId] = useState("");
  const selectedLocationId = locationId || locationsQuery.data?.[0]?.id || "";
  const dashboardQuery = useQuery({
    queryKey: ["commerce-management-dashboard", selectedLocationId],
    queryFn: () => getCommerceManagementDashboard({ data: { locationId: selectedLocationId } }),
    enabled: Boolean(selectedLocationId),
  });
  const dashboard = dashboardQuery.data;
  const managementLocations = locationsQuery.data ?? [];
  const refreshDashboard = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["commerce-store-cockpit", selectedLocationId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-management-dashboard", selectedLocationId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", selectedLocationId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-locations"] }),
    ]);
  };
  const handleLocationSaved = async (savedLocationId: string) => {
    setLocationId(savedLocationId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-locations"] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-store-cockpit", savedLocationId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-management-dashboard", savedLocationId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", savedLocationId] }),
    ]);
  };

  if (locationsQuery.isPending) {
    return <div className="grid gap-4 lg:grid-cols-4"><Skeleton className="h-56 lg:col-span-4" /><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div>;
  }
  if (locationsQuery.isError) {
    return <Card variant="information"><CardContent className="p-6">Impossible de charger les magasins auxquels vous avez accès.</CardContent></Card>;
  }
  if (!locationsQuery.data?.length) {
    return canManageLocations
      ? <CommerceLocationSetup onDone={handleLocationSaved} />
      : <Card variant="information"><CardHeader><CardTitle>Aucun magasin accessible</CardTitle></CardHeader><CardContent>Un administrateur doit vous affecter à un magasin Commerce avant de pouvoir en consulter le pilotage.</CardContent></Card>;
  }

  return <StoreManagementCockpit
    locations={managementLocations}
    locationId={selectedLocationId}
    onLocationChange={setLocationId}
    onOpenCashier={onOpenCashier}
    actions={<>
      {canManageLocations ? <><CommerceLocationDialog mode="create" onDone={handleLocationSaved} /><CommerceLocationDialog mode="edit" location={dashboard?.location} primaryWalletId={dashboard?.cashDrawer?.id ?? ""} onDone={handleLocationSaved} /></> : null}
      {canReceiveCommerceInventory ? <CommerceQuickInventoryReceipt locationId={selectedLocationId} locationName={dashboard?.location.name ?? managementLocations.find((location) => location.id === selectedLocationId)?.name ?? "ce magasin"} onSaved={refreshDashboard} /> : null}
      {canManageStock ? <CommerceInventorySetup locationId={selectedLocationId} onSaved={refreshDashboard} /> : null}
    </>}
  />;

  /* STORE-03 replaces the legacy presentation below while its setup dialogs remain reusable. */
  /*
  return (
    <div className="space-y-5">
      <Card variant="glass" className="overflow-hidden border-primary/15 bg-gradient-to-br from-primary/[0.12] via-surface to-surface shadow-sm">
        <CardContent className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:p-7">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary"><BarChart3 className="size-4" /> Pilotage Commerce</div>
            <div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Magasin & activité</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{dashboard?.financialAccess ? "Suivez les encaissements, les ventes confirmées et la disponibilité en rayon." : "Suivez la disponibilité en rayon et les alertes de stock selon vos droits."} La caisse reste un espace distinct, réservé à l’encaissement.</p></div>
            <div className="max-w-md space-y-2"><Label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Point de vente suivi</Label><Select value={selectedLocationId} onValueChange={setLocationId}><SelectTrigger className="h-12 bg-surface font-semibold"><SelectValue /></SelectTrigger><SelectContent>{locationsQuery.data.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {canManageLocations ? <><CommerceLocationDialog mode="create" onDone={handleLocationSaved} /><CommerceLocationDialog mode="edit" location={dashboard?.location} primaryWalletId={dashboard?.cashDrawer?.id ?? ""} onDone={handleLocationSaved} /></> : null}
            {canReceiveCommerceInventory ? <CommerceQuickInventoryReceipt locationId={selectedLocationId} locationName={dashboard?.location.name ?? locationsQuery.data.find((location) => location.id === selectedLocationId)?.name ?? "ce magasin"} onSaved={refreshDashboard} /> : null}
            {canManageStock ? <CommerceInventorySetup locationId={selectedLocationId} onSaved={refreshDashboard} /> : null}
            <Button type="button" onClick={onOpenCashier}><Store /> Ouvrir la caisse <ArrowRight /></Button>
          </div>
        </CardContent>
      </Card>

      <CommerceSalesJourney
        locationId={selectedLocationId}
        canManageStock={canManageStock}
        canReceiveCommerceInventory={canReceiveCommerceInventory}
        locationName={dashboard?.location.name ?? locationsQuery.data.find((location) => location.id === selectedLocationId)?.name ?? "ce magasin"}
        onInventorySaved={refreshDashboard}
        onOpenCashier={onOpenCashier}
      />

      {dashboardQuery.isPending ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div> : null}
      {dashboardQuery.isError ? <Card variant="information"><CardHeader><CardTitle>Le pilotage ne peut pas être chargé</CardTitle></CardHeader><CardContent className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Les ventes et les indicateurs restent inchangés. Réessayez ou vérifiez votre affectation au magasin.</p><Button type="button" variant="outline" onClick={() => void dashboardQuery.refetch()}>Réessayer</Button></CardContent></Card> : null}
      {dashboard ? (
        <>
          {dashboard.financialAccess && dashboard.today && dashboard.week && dashboard.month ? <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Indicateurs financiers du magasin">
            <CommerceMetric icon={CircleDollarSign} label="Encaissements du jour" value={money(dashboard.today.received)} detail={`${dashboard.today.salesCount} vente${dashboard.today.salesCount > 1 ? "s" : ""} confirmée${dashboard.today.salesCount > 1 ? "s" : ""}`} tone="success" />
            <CommerceMetric icon={TrendingUp} label="Encaissements de la semaine" value={money(dashboard.week.received)} detail={`${dashboard.week.salesCount} vente${dashboard.week.salesCount > 1 ? "s" : ""} confirmée${dashboard.week.salesCount > 1 ? "s" : ""}`} tone="info" />
            <CommerceMetric icon={BarChart3} label="Encaissements du mois" value={money(dashboard.month.received)} detail={`${dashboard.month.salesCount} vente${dashboard.month.salesCount > 1 ? "s" : ""} confirmée${dashboard.month.salesCount > 1 ? "s" : ""}`} tone="primary" />
            <CommerceMetric icon={WalletCards} label="Caisse du magasin" value={dashboard.cashDrawer ? money(dashboard.cashDrawer.balance) : "À configurer"} detail={dashboard.cashDrawer?.name ?? "Aucun wallet de caisse principal"} tone="neutral" />
          </section> : <Card variant="information"><CardContent className="flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="font-semibold">Pilotage stock disponible</p><p className="mt-1 text-sm text-muted-foreground">Les montants de vente et le solde de caisse restent masqués tant que la permission financière Commerce n’est pas accordée.</p></div><span className="rounded-full bg-muted px-3 py-1.5 text-sm font-semibold">Accès financier restreint</span></CardContent></Card>}

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.8fr)]">
            <Card variant="section" className="overflow-hidden">
              <CardHeader className="border-b border-border/70 pb-4"><div className="flex items-start justify-between gap-4"><div><CardTitle>Dernières ventes confirmées</CardTitle><p className="mt-1 text-sm text-muted-foreground">{dashboard.financialAccess ? "Encaissements réellement enregistrés dans le magasin suivi." : "Cette liste est réservée aux utilisateurs autorisés à consulter les montants commerciaux."}</p></div><Button type="button" variant="ghost" size="sm" onClick={onOpenCashier}>Caisse <ArrowRight /></Button></div></CardHeader>
              <CardContent className="p-0">
                {!dashboard.financialAccess ? <div className="flex min-h-52 flex-col items-center justify-center gap-2 px-6 text-center"><CircleDollarSign className="size-7 text-muted-foreground" /><p className="font-semibold">Accès aux ventes restreint</p><p className="max-w-md text-sm text-muted-foreground">Votre rôle peut piloter le stock, mais ne peut pas afficher les montants ni l’historique des ventes.</p></div> : dashboard.recentSales.length ? <div className="divide-y divide-border/70">{dashboard.recentSales.map((sale) => <div key={sale.saleNumber} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div className="min-w-0"><p className="font-semibold">{sale.saleNumber}</p><p className="mt-1 text-sm text-muted-foreground">{new Date(`${sale.saleDate}T00:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })} · Confirmée</p></div><p className="font-semibold tabular-nums text-success">{money(sale.amount)}</p></div>)}</div> : <div className="flex min-h-52 flex-col items-center justify-center gap-2 px-6 text-center"><Store className="size-7 text-primary" /><p className="font-semibold">Aucune vente confirmée pour le moment</p><p className="max-w-md text-sm text-muted-foreground">Les tickets encaissés depuis la caisse apparaîtront ici automatiquement.</p><Button type="button" size="sm" onClick={onOpenCashier}>Ouvrir la caisse</Button></div>}
              </CardContent>
            </Card>

            <div className="space-y-5">
              <Card variant="information"><CardHeader><CardTitle className="flex items-center gap-2"><Package className="size-5 text-primary" /> État du stock</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/[0.18] px-3 py-3"><span className="text-sm text-muted-foreground">Articles en rayon</span><span className="font-semibold tabular-nums">{dashboard.inventory.itemsCount}</span></div><div className="flex items-center justify-between rounded-xl border border-warning/20 bg-warning/[0.08] px-3 py-3"><span className="flex items-center gap-2 text-sm text-warning"><TriangleAlert className="size-4" /> Sous le seuil</span><span className="font-semibold tabular-nums text-warning">{dashboard.inventory.lowStockCount}</span></div><div className="flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/[0.07] px-3 py-3"><span className="flex items-center gap-2 text-sm text-destructive"><TriangleAlert className="size-4" /> Ruptures</span><span className="font-semibold tabular-nums text-destructive">{dashboard.inventory.outOfStockCount}</span></div></CardContent></Card>
              <Card variant="information"><CardHeader><CardTitle>Rentabilité du magasin</CardTitle></CardHeader><CardContent><p className="text-sm leading-6 text-muted-foreground">Le prix d’achat est conservé à chaque réception et le prix de vente est défini à la mise en rayon. Le bénéfice net n’est pas encore affiché : les dépenses générales ne sont pas liées explicitement à ce magasin. Aucun zéro trompeur n’est présenté.</p></CardContent></Card>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
  */
}

function CommerceMetric({ icon: Icon, label, value, detail, tone }: { icon: typeof CircleDollarSign; label: string; value: string; detail: string; tone: "success" | "info" | "primary" | "neutral" }) {
  const tones = {
    success: "bg-success/[0.10] text-success",
    info: "bg-info/[0.10] text-info",
    primary: "bg-primary/[0.10] text-primary",
    neutral: "bg-muted text-foreground",
  };
  return <Card variant="kpi" className="min-w-0"><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-4 truncate text-2xl font-semibold tracking-tight tabular-nums" title={value}>{value}</p><p className="mt-2 truncate text-sm text-muted-foreground" title={detail}>{detail}</p></div><span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="size-5" /></span></div></CardContent></Card>;
}

function CommerceSalesJourneyLegacy({ locationId, canManageStock, onInventorySaved, onOpenCashier }: { locationId: string; canManageStock: boolean; onInventorySaved: () => void; onOpenCashier: () => void }) {
  return (
    <Card variant="section" className="overflow-hidden">
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Parcours de vente</p>
            <CardTitle className="mt-1">De l’achat à l’encaissement</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Suivez ces trois étapes dans cet ordre : chaque montant est alors enregistré une seule fois.</p>
          </div>
          <span className="rounded-full border border-primary/15 bg-primary/[0.08] px-3 py-1.5 text-xs font-semibold text-primary">Stock · Rayon · Caisse</span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-5 pt-5 lg:grid-cols-3">
        <CommerceJourneyStep
          index="1"
          icon={Warehouse}
          title="Réceptionner l’achat"
          detail="Enregistrez la quantité, le prix d’achat et le wallet qui paie le fournisseur."
          action={<Button asChild variant="outline" size="sm"><Link to="/stocks">Ouvrir les Stocks <ArrowRight /></Link></Button>}
        />
        <CommerceJourneyStep
          index="2"
          icon={PackagePlus}
          title="Mettre en rayon"
          detail="Affectez les articles au magasin et définissez leur prix de vente. Aucun wallet ne bouge ici."
          action={canManageStock ? <CommerceInventorySetup locationId={locationId} onSaved={onInventorySaved} /> : <span className="text-xs font-medium text-muted-foreground">Réservé au gestionnaire de stock</span>}
        />
        <CommerceJourneyStep
          index="3"
          icon={ReceiptText}
          title="Encaisser à la caisse"
          detail="Le ticket réduit le stock et crédite automatiquement le wallet principal du magasin."
          action={<Button type="button" size="sm" onClick={onOpenCashier}>Ouvrir la caisse <ArrowRight /></Button>}
        />
      </CardContent>
      <div className="border-t border-warning/20 bg-warning/[0.06] px-5 py-3 text-sm text-muted-foreground">
        <span className="font-semibold text-warning">À éviter :</span> n’utilisez pas « Vente client » dans Stocks pour une vente déjà encaissée à la caisse, sinon la recette et la sortie de stock peuvent être enregistrées deux fois.
      </div>
    </Card>
  );
}

function CommerceSalesJourney({ locationId, locationName, canManageStock, canReceiveCommerceInventory, onInventorySaved, onOpenCashier }: { locationId: string; locationName: string; canManageStock: boolean; canReceiveCommerceInventory: boolean; onInventorySaved: () => void; onOpenCashier: () => void }) {
  return (
    <Card variant="section" className="overflow-hidden">
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Parcours de vente simplifie</p>
            <CardTitle className="mt-1">Du fournisseur a la caisse</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Un seul formulaire suffit pour creer le produit, l acheter, le mettre en rayon et definir son prix de vente.</p>
          </div>
          <span className="rounded-full border border-primary/15 bg-primary/[0.08] px-3 py-1.5 text-xs font-semibold text-primary">Produit · Achat · Rayon · Caisse</span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-5 pt-5 lg:grid-cols-3">
        <CommerceJourneyStep
          index="1"
          icon={Warehouse}
          title="Ajouter un produit au magasin"
          detail="Nom, quantite recue, prix d achat, prix de vente, wallet debite et magasin sont reunis dans une seule action."
          action={canReceiveCommerceInventory
            ? <CommerceQuickInventoryReceipt locationId={locationId} locationName={locationName} onSaved={onInventorySaved} triggerVariant="outline" />
            : <span className="text-xs font-medium text-muted-foreground">Necessite les droits Stock et achat</span>}
        />
        <CommerceJourneyStep
          index="2"
          icon={PackagePlus}
          title="Ajuster un article existant"
          detail="Utilisez cette action seulement pour modifier la quantite en rayon, le prix de vente ou le seuil d alerte d un article deja cree."
          action={canManageStock ? <CommerceInventorySetup locationId={locationId} onSaved={onInventorySaved} /> : <span className="text-xs font-medium text-muted-foreground">Reserve au gestionnaire de stock</span>}
        />
        <CommerceJourneyStep
          index="3"
          icon={ReceiptText}
          title="Encaisser a la caisse"
          detail="Le ticket reduit le stock et credite automatiquement le wallet principal du magasin."
          action={<Button type="button" size="sm" onClick={onOpenCashier}>Ouvrir la caisse <ArrowRight /></Button>}
        />
      </CardContent>
      <div className="border-t border-warning/20 bg-warning/[0.06] px-5 py-3 text-sm text-muted-foreground">
        <span className="font-semibold text-warning">A eviter :</span> n utilisez pas Vente client dans Stocks pour une vente deja encaissee a la caisse, sinon la recette et la sortie de stock peuvent etre enregistrees deux fois.
      </div>
    </Card>
  );
}

function CommerceJourneyStep({ index, icon: Icon, title, detail, action }: { index: string; icon: typeof Warehouse; title: string; detail: string; action: ReactNode }) {
  return <div className="rounded-2xl border border-border/75 bg-muted/[0.14] p-4"><div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.10] text-sm font-bold text-primary">{index}</span><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-primary shadow-xs"><Icon className="size-4" /></span><div className="min-w-0"><p className="font-semibold">{title}</p><p className="mt-1 text-sm leading-5 text-muted-foreground">{detail}</p></div></div><div className="mt-4 pl-12">{action}</div></div>;
}

type CashierDraftAction =
  | { type: "DISCARD" }
  | { type: "CHANGE_LOCATION"; locationId: string }
  | { type: "RETURN_TO_MANAGEMENT" };

function useCommerceCashierUserId() {
  const [userId, setUserId] = useState("");

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setUserId(data.user?.id ?? "");
    });
    return () => { active = false; };
  }, []);

  return userId;
}

function isIndeterminateCheckoutError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.toLowerCase().includes("fetch")) return true;
  if (!(error instanceof Error)) return false;
  return /network|timeout|timed out|failed to fetch|load failed/i.test(error.message);
}

function CommerceCashierWorkspace({ onBackToManagement }: { onBackToManagement?: () => void }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canManageStock = can("commerce.stock.receive");
  const canManageLocations = can("locations.manage") && can("locations.wallets.manage") && can("locations.assign");
  const canSeeTodayRevenue = can("store.financial.read");
  const [cashierTab, setCashierTab] = useState<"CAISSE" | "VENTES" | "SESSION">("CAISSE");
  const locationsQuery = useQuery({ queryKey: ["commerce-pos-locations"], queryFn: () => getCommercePosLocations() });
  const currentUserQuery = useCurrentUserAccess();
  const currentUserId = useCommerceCashierUserId();
  const cashierName = currentUserQuery.data?.fullName?.trim()
    || currentUserQuery.data?.username
    || (currentUserQuery.isLoading ? "Chargement…" : "Caissier non identifié");
  const [locationId, setLocationId] = useState("");
  const [cachedLocations, setCachedLocations] = useState<CommercePosLocation[]>([]);
  const availableLocations = locationsQuery.data?.length ? locationsQuery.data : cachedLocations;
  const selectedLocationId = locationId || availableLocations[0]?.id || "";
  const workspaceQuery = useQuery({
    queryKey: ["commerce-pos-workspace", selectedLocationId],
    queryFn: () => getCommercePosWorkspace({ data: { locationId: selectedLocationId } }),
    enabled: Boolean(selectedLocationId),
  });
  const workspace = workspaceQuery.data;
  const posSession = useCommercePosSession({
    locationId: selectedLocationId,
    userId: currentUserId,
    catalogue: workspace?.items,
    catalogueRevision: workspaceQuery.dataUpdatedAt,
  });
  const [search, setSearch] = useState("");
  const [quickQuantity, setQuickQuantity] = useState("1");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [editingPriceLineId, setEditingPriceLineId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [serviceNote, setServiceNote] = useState("");
  const [suspendedTicketsOpen, setSuspendedTicketsOpen] = useState(false);
  const [pendingSuspendedDeletion, setPendingSuspendedDeletion] = useState<CommercePosSuspendedTicket | null>(null);
  const [showClient, setShowClient] = useState(false);
  const [pendingDraftAction, setPendingDraftAction] = useState<CashierDraftAction | null>(null);
  const quickEntryRef = useRef<HTMLInputElement>(null);
  const draft = posSession.draft;
  const cart = posSession.isReady ? draft?.lines ?? [] : [];
  const clientId = posSession.isReady ? draft?.clientId ?? "" : "";
  const method: PaymentMethod = posSession.isReady ? draft?.paymentMethod ?? "CASH" : "CASH";
  const cashReceived = posSession.isReady ? draft?.cashReceived ?? null : null;
  const checkoutState = posSession.isReady ? draft?.checkoutState ?? "READY" : "READY";
  const primaryCashDrawerWallet = workspace?.wallets.find((wallet) => wallet.isPrimary && wallet.purpose === "CASH_DRAWER");
  const primaryCashDrawerWalletId = primaryCashDrawerWallet?.id ?? "";

  useEffect(() => {
    if (!selectedLocationId || posSession.syncRevision === 0) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", selectedLocationId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-management-dashboard", selectedLocationId] }),
    ]);
  }, [posSession.syncRevision, queryClient, selectedLocationId]);
  useEffect(() => {
    if (!currentUserId) return;
    let active = true;
    if (locationsQuery.data?.length) {
      setCachedLocations(locationsQuery.data);
      void cachePosOfflineLocations(currentUserId, locationsQuery.data).catch((error: unknown) => {
        console.warn("Les points de vente hors connexion n’ont pas pu être mémorisés.", error);
      });
      return () => { active = false; };
    }
    void getCachedPosOfflineLocations(currentUserId)
      .then((locations) => {
        if (active && locations.length) setCachedLocations(locations);
      })
      .catch((error: unknown) => console.warn("Les points de vente mémorisés sont indisponibles.", error));
    return () => { active = false; };
  }, [currentUserId, locationsQuery.data]);

  useEffect(() => {
    if (locationId || !currentUserId || !availableLocations.length || typeof window === "undefined") return;
    let active = true;
    void (async () => {
      let restoredLocationId: string | null = null;
      try {
        restoredLocationId = await findPosOfflineDraftLocation(availableLocations.map((location) => location.id), currentUserId);
      } catch (error) {
        console.warn("Le brouillon hors connexion n’a pas pu être localisé.", error);
      }
      if (!restoredLocationId) {
        restoredLocationId = findCommercePosDraftLocation(window.localStorage, availableLocations.map((location) => location.id), currentUserId);
      }
      if (active) setLocationId(restoredLocationId ?? availableLocations[0].id);
    })();
    return () => { active = false; };
  }, [availableLocations, currentUserId, locationId]);

  useEffect(() => {
    if (!posSession.isRestored || !draft?.clientId) return;
    setShowClient(true);
  }, [draft?.clientId, posSession.isRestored]);

  useEffect(() => {
    if (!posSession.isReady || !draft || typeof window === "undefined") return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!draft.lines.length && draft.checkoutState === "READY") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [draft, posSession.isReady]);
  const activeCatalogue = workspace?.items ?? posSession.catalogueItems;
  const isUsingOfflineCatalogue = !workspace && posSession.catalogueItems.length > 0;
  const currentLocationName = workspace?.location.name ?? availableLocations.find((location) => location.id === selectedLocationId)?.name ?? "Point de vente";
  const items = useMemo(
    () => activeCatalogue.filter((item) => `${item.name} ${item.sku ?? ""}`.toLowerCase().includes(search.toLowerCase())),
    [activeCatalogue, search],
  );
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of activeCatalogue) {
      const trimmed = item.category?.trim();
      if (trimmed) set.add(trimmed);
    }
    return Array.from(set).sort((left, right) => left.localeCompare(right, "fr"));
  }, [activeCatalogue]);
  const gridItems = useMemo(
    () => activeCategory ? items.filter((item) => (item.category?.trim() || null) === activeCategory) : items,
    [items, activeCategory],
  );
  const total = cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const stockConflicts = useMemo(
    () => getCommercePosStockConflicts(cart, activeCatalogue.map((item) => ({ itemId: item.id, label: item.name, availableQuantity: item.quantity }))),
    [activeCatalogue, cart],
  );
  const cashChange = method === "CASH" && cashReceived !== null ? Math.max(cashReceived - total, 0) : 0;
  const refreshWorkspace = () => queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", selectedLocationId] });
  const updateDraft = useCallback((updater: (current: NonNullable<typeof draft>) => NonNullable<typeof draft>) => {
    if (!posSession.isReady) return;
    posSession.updateDraft(updater);
  }, [posSession]);
  const hasDraftInProgress = Boolean(draft && (cart.length > 0 || draft.checkoutState !== "READY" || draft.clientId || draft.paymentMethod !== "CASH" || draft.cashReceived !== null));
  const applyDraftAction = useCallback(() => {
    if (!pendingDraftAction) return;
    const action = pendingDraftAction;
    posSession.clearDraft();
    setShowClient(false);
    setPendingDraftAction(null);
    if (action.type === "CHANGE_LOCATION") setLocationId(action.locationId);
    if (action.type === "RETURN_TO_MANAGEMENT") onBackToManagement?.();
  }, [onBackToManagement, pendingDraftAction, posSession]);
  const closeCashSession = async () => {
    await posSession.closeCashSession();
    toast.success(posSession.networkStatus === "ONLINE"
      ? "Session cl\u00f4tur\u00e9e. Rapport de contr\u00f4le g\u00e9n\u00e9r\u00e9, synchronis\u00e9."
      : "Session cl\u00f4tur\u00e9e. Rapport enregistr\u00e9 sur cet appareil, synchronisation automatique d\u00e8s le retour d\u2019Internet.");
  };

  const startNewCashSession = async () => {
    await posSession.startNewCashSession();
    toast.success("Nouvelle session de caisse ouverte.");
  };

  const requestLocationChange = (nextLocationId: string) => {
    if (nextLocationId === selectedLocationId) return;
    if (hasDraftInProgress) {
      setPendingDraftAction({ type: "CHANGE_LOCATION", locationId: nextLocationId });
      return;
    }
    setLocationId(nextLocationId);
  };
  const handleLocationSaved = async (savedLocationId: string) => {
    setLocationId(savedLocationId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-locations"] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", savedLocationId] }),
    ]);
  };
  const saleMutation = useMutation({
    mutationFn: createCommerceCashSale,
    onSuccess: async (receipt) => {
      toast.success(`Vente ${receipt.saleNumber} comptabilisée : ${money(receipt.amount)}.`);
      posSession.clearDraft();
      setShowClient(false);
      await refreshWorkspace();
    },
    onError: (error) => {
      const requiresReconciliation = isIndeterminateCheckoutError(error);
      if (requiresReconciliation) posSession.reportNetworkFailure();
      updateDraft((current) => ({ ...current, checkoutState: requiresReconciliation ? "RECONCILIATION_REQUIRED" : "READY" }));
      toast.error(requiresReconciliation
        ? "La réponse de la caisse est inconnue. La vente est conservée et bloquée à vérification pour éviter un double encaissement."
        : "La vente n’a pas été enregistrée. Vérifiez le stock, le prix ou la configuration de caisse.");
    },
  });

  const addArticle = useCallback((itemId: string, defaultPrice: number | null, label: string, quantity = 1) => {
    if (!posSession.isReady || checkoutState !== "READY") return;
    const availableQuantity = activeCatalogue.find((item) => item.id === itemId)?.quantity ?? 0;
    updateDraft((current) => {
      const line = current.lines.find((entry) => entry.lineType === "ARTICLE" && entry.itemId === itemId);
      const lines = line
        ? current.lines.map((entry) => entry.lineId === line.lineId ? { ...entry, quantity: Math.min(entry.quantity + quantity, availableQuantity), label } : entry)
        : availableQuantity > 0 ? [...current.lines, { lineId: `article-${itemId}`, lineType: "ARTICLE" as const, itemId, label, quantity: Math.min(quantity, availableQuantity), unitPrice: defaultPrice ?? 0 }] : current.lines;
      return { ...current, lines };
    });
  }, [activeCatalogue, checkoutState, posSession.isReady, updateDraft]);
  const addService = () => {
    const parsedPrice = Number(servicePrice);
    const normalizedName = serviceName.trim();
    if (!posSession.isReady || checkoutState !== "READY" || !normalizedName || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      toast.error("Saisissez la désignation et le montant du service.");
      return;
    }
    updateDraft((current) => ({
      ...current,
      lines: [...current.lines, {
        lineId: createCommercePosId("service"),
        lineType: "SERVICE",
        itemId: createCommercePosId("service-item"),
        label: normalizedName,
        quantity: 1,
        unitPrice: parsedPrice,
        serviceNote: serviceNote.trim() || null,
      }],
    }));
    setServiceName("");
    setServicePrice("");
    setServiceNote("");
    setServiceDialogOpen(false);
    refocusQuickEntry();
  };
  const refocusQuickEntry = () => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => quickEntryRef.current?.focus());
  };
  const addQuickResult = () => {
    const quantity = Number(quickQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Saisissez une quantité valide.");
      return;
    }
    if (items.length !== 1) {
      toast.info(items.length === 0 ? "Aucun article ne correspond à cette recherche." : "Plusieurs articles correspondent : choisissez-en un dans le rayon.");
      return;
    }
    const item = items[0];
    addArticle(item.id, item.salePrice, item.name, quantity);
    setSearch("");
    setQuickQuantity("1");
    refocusQuickEntry();
  };
  const catalogFloorFor = (line: CartLine): number | null =>
    line.lineType === "ARTICLE" ? activeCatalogue.find((entry) => entry.id === line.itemId)?.salePrice ?? null : null;
  const startEditPrice = (line: CartLine) => {
    setEditingPriceLineId(line.lineId);
    setPriceDraft(String(line.unitPrice));
    setPriceError(null);
  };
  const cancelEditPrice = () => {
    setEditingPriceLineId(null);
    setPriceError(null);
  };
  const commitEditPrice = (line: CartLine) => {
    const parsed = Number(priceDraft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setPriceError("Saisissez un prix valide.");
      return;
    }
    const floor = catalogFloorFor(line);
    if (floor !== null && parsed < floor) {
      setPriceError(`Le prix de vente ne peut pas être inférieur au prix catalogue de ${money(floor)}.`);
      return;
    }
    update(line.lineId, { unitPrice: parsed });
    setEditingPriceLineId(null);
    setPriceError(null);
  };
  useEffect(() => {
    const addFromCashierSidebar = (event: Event) => {
      const itemId = (event as CustomEvent<{ itemId?: string }>).detail?.itemId;
      const item = activeCatalogue.find((entry) => entry.id === itemId);
      if (item) addArticle(item.id, item.salePrice, item.name);
    };
    window.addEventListener("commerce:add-item", addFromCashierSidebar);
    return () => window.removeEventListener("commerce:add-item", addFromCashierSidebar);
  }, [activeCatalogue, addArticle]);
  const update = (lineId: string, values: Partial<Pick<CartLine, "quantity" | "unitPrice">>) => {
    if (checkoutState !== "READY") return;
    updateDraft((current) => ({
      ...current,
      lines: current.lines
        .map((line) => line.lineId === lineId ? { ...line, ...values } : line)
        .filter((line) => line.quantity > 0),
    }));
  };
  const setPaymentMethod = (nextMethod: PaymentMethod) => {
    if (checkoutState !== "READY") return;
    if (posSession.networkStatus !== "ONLINE" && nextMethod !== "CASH") {
      toast.info("Seul l’encaissement en espèces reste disponible hors connexion.");
      return;
    }
    updateDraft((current) => ({ ...current, paymentMethod: nextMethod, cashReceived: nextMethod === "CASH" ? current.cashReceived : null }));
  };
  const checkout = () => {
    if (!posSession.isReady || !draft || !selectedLocationId || cart.length === 0 || total <= 0) {
      toast.error("Ajoutez au moins un article ou un service avec un prix de vente valide.");
      return;
    }
    if (checkoutState === "RECONCILIATION_REQUIRED") {
      toast.error("Cette vente doit d’abord être vérifiée dans les ventes du magasin avant tout nouvel encaissement.");
      return;
    }
    if (stockConflicts.length) {
      toast.error("Le stock a changé. Ajustez le panier avant d’encaisser.");
      return;
    }
    if (method === "CASH" && cashReceived !== null && cashReceived < total) {
      toast.error("Le montant reçu doit couvrir le total à encaisser.");
      return;
    }
    if (method === "JEKO") {
      toast.info("Le paiement mobile via Jèko est en attente d’activation transactionnelle. Aucun ticket n’a été créé.");
      return;
    }
    if (posSession.networkStatus !== "ONLINE") {
      if (method !== "CASH" || !posSession.canCompleteOfflineCashSale) {
        toast.error("Cette vente ne peut pas être conservée hors connexion sur ce poste.");
        return;
      }
      void posSession.completeOfflineCashSale()
        .then((eventId) => {
          setShowClient(false);
          toast.success(`Vente enregistrée localement. Elle reste en attente de synchronisation contrôlée (événement ${eventId.slice(-8).toUpperCase()}).`);
        })
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "La vente locale n’a pas pu être sauvegardée.");
        });
      return;
    }
    if (!primaryCashDrawerWallet) {
      toast.error("Aucun wallet principal de caisse n’est configuré pour ce magasin.");
      return;
    }
    updateDraft((current) => ({ ...current, checkoutState: "PROCESSING" }));
    saleMutation.mutate({
      data: {
        businessLocationId: selectedLocationId,
        clientId: clientId || null,
        paymentMethod: method,
        idempotencyKey: draft.sessionId,
        reference: `POS:${draft.sessionId}`,
        notes: null,
        cashSessionId: posSession.cashSession?.id ?? null,
        terminalId: posSession.cashSession?.terminalId ?? null,
        lines: cart.map((line) => line.lineType === "ARTICLE"
          ? { lineType: "ARTICLE" as const, inventoryItemId: line.itemId, quantity: line.quantity, unitPrice: line.unitPrice }
          : { lineType: "SERVICE" as const, serviceName: line.label, serviceNote: line.serviceNote, quantity: line.quantity, unitPrice: line.unitPrice }),
      },
    });
  };

  useEffect(() => {
    const handleCashierShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable);

      if (isTyping) return;

      if (event.key === "F2") {
        event.preventDefault();
        quickEntryRef.current?.focus();
        return;
      }
      if (event.key === "F4") {
        event.preventDefault();
        setShowClient(true);
        return;
      }
      if (event.key === "F10") {
        event.preventDefault();
        checkout();
      }
    };

    window.addEventListener("keydown", handleCashierShortcut);
    return () => window.removeEventListener("keydown", handleCashierShortcut);
  }, [checkout]);

  const canCheckout = total > 0
    && stockConflicts.length === 0
    && checkoutState === "READY"
    && posSession.isCashSessionOpen
    && (posSession.networkStatus === "ONLINE" ? Boolean(primaryCashDrawerWallet) : posSession.canCompleteOfflineCashSale && method === "CASH");
  const syncedOutboxCount = posSession.outboxEvents.filter((event) => event.status === "SYNCED").length;
  const conflictOutboxCount = posSession.outboxEvents.filter((event) => event.status === "CONFLICT").length;
  const lastSuccessfulSyncAt = posSession.outboxEvents
    .map((event) => event.syncedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const syncStatusLabel = posSession.networkStatus !== "ONLINE"
    ? "HORS LIGNE"
    : posSession.syncProgress
      ? `SYNCHRONISATION… ${syncedOutboxCount} / ${posSession.outboxEvents.length}`
      : conflictOutboxCount > 0
        ? "CONFLIT À CONTRÔLER"
        : posSession.pendingOutboxCount > 0
          ? `${posSession.pendingOutboxCount} EN ATTENTE`
          : `SYNCHRONISÉ ${syncedOutboxCount} / ${posSession.outboxEvents.length}`;

  if (locationsQuery.isPending && !availableLocations.length) return <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-72 lg:col-span-2" /><Skeleton className="h-72" /></div>;
  if (locationsQuery.isError && !availableLocations.length) return <Card variant="information"><CardContent className="p-6">Impossible de charger vos points de vente autorisés. Ouvrez d’abord la caisse une fois avec Internet pour la rendre disponible hors connexion.</CardContent></Card>;
  if (!availableLocations.length) {
    return canManageLocations
      ? <CommerceLocationSetup onDone={handleLocationSaved} />
      : <Card variant="information"><CardHeader><CardTitle>Aucune caisse disponible</CardTitle></CardHeader><CardContent>Votre compte doit être affecté à un magasin Commerce avant de pouvoir encaisser. Un administrateur doit créer le magasin, associer son wallet puis vous y affecter.</CardContent></Card>;
  }

  const cashierInitials = cashierName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
  const sessionOpenedLabel = posSession.cashSession?.openedAtDevice
    ? new Date(posSession.cashSession.openedAtDevice).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "—";
  const syncPillTone = conflictOutboxCount > 0
    ? "bg-destructive/15 text-destructive-foreground"
    : posSession.networkStatus !== "ONLINE" || posSession.pendingOutboxCount > 0
      ? "bg-warning/20 text-warning-foreground"
      : "bg-success/20 text-success-foreground";

  return (
    <div className="flex min-h-0 flex-col gap-3 lg:h-[calc(100dvh-6.4rem)]">
      {/* Distinct cashier shell identity: a dedicated app bar, not the admin cockpit's card grid. */}
      <header className="shrink-0 overflow-hidden rounded-2xl bg-foreground text-background shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">{cashierInitials}</span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-background/55">Caisse</p>
              <p className="truncate text-sm font-bold" title={currentLocationName}>{currentLocationName}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="text-right"><p className="text-background/55">Caissier</p><p className="max-w-32 truncate font-semibold" title={cashierName}>{cashierName}</p></div>
            <div className="text-right"><p className="text-background/55">Session ouverte</p><p className="font-semibold tabular-nums">{sessionOpenedLabel}</p></div>
            {canSeeTodayRevenue ? <div className="text-right"><p className="text-background/55">CA du jour</p><p className="font-semibold tabular-nums">{money(workspace?.today.received ?? 0)}</p></div> : null}
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${syncPillTone}`}>{posSession.networkStatus !== "ONLINE" ? <CloudOff className="size-3.5" aria-hidden="true" /> : <CloudUpload className="size-3.5" aria-hidden="true" />}{syncStatusLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            {onBackToManagement ? <Button type="button" size="sm" variant="ghost" className="text-background hover:bg-background/10 hover:text-background" onClick={onBackToManagement}><LogOut />Gestion</Button> : null}
            <PosCashSessionClose
              session={posSession.cashSession}
              summary={posSession.cashSessionSummary}
              disabled={hasDraftInProgress || posSession.suspendedTickets.length > 0}
              onClose={closeCashSession}
              onStartNew={startNewCashSession}
            />
          </div>
        </div>
      </header>

      {/* CAISSE / VENTES / SESSION -- the cashier's entire world, three tabs, nothing else. */}
      <div className="flex shrink-0 gap-1 rounded-xl border border-border/80 bg-muted/[0.18] p-1">
        {([["CAISSE", ShoppingCart], ["VENTES", ReceiptText], ["SESSION", CircleDollarSign]] as const).map(([value, Icon]) => (
          <button key={value} type="button" onClick={() => setCashierTab(value)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${cashierTab === value ? "bg-surface text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <Icon className="size-4" />{value === "CAISSE" ? "Caisse" : value === "VENTES" ? "Ventes" : "Session"}
          </button>
        ))}
      </div>

      {cashierTab === "SESSION" ? (
        <CashierSessionTab
          locationName={currentLocationName}
          cashierName={cashierName}
          sessionOpenedLabel={sessionOpenedLabel}
          session={posSession.cashSession}
          summary={posSession.cashSessionSummary}
          syncStatusLabel={syncStatusLabel}
          lastSuccessfulSyncAt={lastSuccessfulSyncAt}
          disabled={hasDraftInProgress || posSession.suspendedTickets.length > 0}
          onClose={closeCashSession}
          onStartNew={startNewCashSession}
        />
      ) : cashierTab === "VENTES" ? (
        <CashierSalesTab events={posSession.outboxEvents} />
      ) : (
      <>
      {posSession.isRestored ? <div className="shrink-0 rounded-xl border border-info/20 bg-info/[0.06] px-4 py-2 text-sm text-info">Brouillon restauré sur ce poste : aucune ligne n’a été perdue.</div> : null}
      {stockConflicts.length ? <div className="shrink-0 rounded-xl border border-warning/25 bg-warning/[0.08] px-4 py-2 text-sm text-warning">Stock modifié : {stockConflicts.map((conflict) => `${conflict.label} — ${conflict.availableQuantity} disponible${conflict.availableQuantity > 1 ? "s" : ""} au lieu de ${conflict.requestedQuantity}`).join(" · ")}. Ajustez le ticket avant l’encaissement.</div> : null}
      {checkoutState === "RECONCILIATION_REQUIRED" ? <div className="shrink-0 rounded-xl border border-warning/25 bg-warning/[0.08] px-4 py-2 text-sm text-warning">Encaissement à vérifier : le brouillon est protégé afin d’éviter un double encaissement.</div> : null}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        {/* LEFT ~60% -- catalogue: search/scan, categories, product grid. */}
        <section className="order-2 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-sm lg:order-1">
          <div className="shrink-0 space-y-2.5 border-b border-border/75 bg-muted/[0.16] p-3">
            <div className="flex gap-2">
              <form className="relative flex-1" onSubmit={(event) => { event.preventDefault(); addQuickResult(); }}>
                <Search className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-primary" />
                <Input ref={quickEntryRef} className="h-11 bg-surface pl-10 text-base" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher ou scanner · F2" autoComplete="off" />
              </form>
              <Input className="h-11 w-16 bg-surface text-center tabular-nums" type="number" min="1" step="1" aria-label="Quantité" value={quickQuantity} onChange={(event) => setQuickQuantity(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addQuickResult(); } }} />
              <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" title="Ajouter un service" disabled={checkoutState !== "READY"} onClick={() => setServiceDialogOpen(true)}><Wrench /></Button>
              <Button type="button" variant="outline" size="icon" className="relative h-11 w-11 shrink-0" title="Tickets en attente" onClick={() => setSuspendedTicketsOpen(true)}><ListTodo />{posSession.suspendedTickets.length ? <span className="absolute -right-1.5 -top-1.5 flex size-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{posSession.suspendedTickets.length}</span> : null}</Button>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              <button type="button" onClick={() => setActiveCategory(null)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${activeCategory === null ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground hover:border-primary/35 hover:text-foreground"}`}>Tous</button>
              {categories.map((category) => (
                <button key={category} type="button" onClick={() => setActiveCategory(category)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${activeCategory === category ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground hover:border-primary/35 hover:text-foreground"}`}>{category}</button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {workspaceQuery.isPending && !isUsingOfflineCatalogue ? <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div> : null}
            {workspaceQuery.isError && !isUsingOfflineCatalogue ? <Card variant="information"><CardContent className="p-6">La caisse ne peut pas être ouverte pour ce point de vente. Réessayez dans un instant ou contactez un responsable.</CardContent></Card> : null}
            {isUsingOfflineCatalogue ? <div className="mb-3 rounded-xl border border-warning/20 bg-warning/[0.06] px-3 py-2 text-sm text-warning">Catalogue et stock local affichés.</div> : null}
            {(!workspaceQuery.isPending || isUsingOfflineCatalogue) && (!workspaceQuery.isError || isUsingOfflineCatalogue) ? (
              gridItems.length ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                  {gridItems.map((item) => {
                    const outOfStock = item.quantity <= 0;
                    return (
                      <button key={item.id} type="button" disabled={outOfStock || checkoutState !== "READY"} onClick={() => addArticle(item.id, item.salePrice, item.name)}
                        className="flex flex-col items-stretch gap-1.5 rounded-xl border border-border bg-surface p-2.5 text-left shadow-sm transition-colors hover:border-primary/40 hover:shadow disabled:cursor-not-allowed disabled:opacity-50">
                        <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-primary/[0.07] text-primary"><Package className="size-8" /></div>
                        <p className="line-clamp-2 text-xs font-semibold leading-tight" title={item.name}>{item.name}</p>
                        <div className="mt-auto flex items-center justify-between gap-1">
                          <span className="text-sm font-bold tabular-nums">{item.salePrice !== null ? money(item.salePrice) : "—"}</span>
                          <span className={`shrink-0 text-[10px] font-semibold ${outOfStock ? "text-destructive" : "text-muted-foreground"}`}>{outOfStock ? "Rupture" : `${item.quantity} ${item.unit ?? ""}`.trim()}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-center"><Package className="size-8 text-muted-foreground" /><p className="font-semibold">Aucun article ne correspond</p><p className="text-sm text-muted-foreground">Essayez une autre recherche ou une autre catégorie.</p></div>
            ) : null}
          </div>
        </section>

        {/* RIGHT ~40% -- cart: lines, payment, ENCAISSER. Always visible, never a hidden drawer. */}
        <aside className="order-1 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-sm lg:order-2">
          <div className="shrink-0 border-b border-border/75 p-3">
            {showClient ? <div className="flex items-center gap-2"><ClientSelect value={clientId} onValueChange={(value) => updateDraft((current) => ({ ...current, clientId: value || null }))} placeholder="Client facultatif" /><Button type="button" size="sm" variant="ghost" onClick={() => { updateDraft((current) => ({ ...current, clientId: null })); setShowClient(false); }}>Comptoir</Button></div> : <button type="button" onClick={() => setShowClient(true)} className="flex w-full items-center justify-between rounded-xl border border-dashed border-border/90 bg-surface/75 px-3 py-2 text-left text-sm transition-colors hover:border-primary/35 hover:bg-primary/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><span className="font-semibold">{clientId ? "Ticket nominatif" : "Vente comptoir"}</span><span className="text-xs font-semibold text-primary">F4 · Client</span></button>}
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
            {cart.map((line) => {
              const isService = line.lineType === "SERVICE";
              const catalogItem = !isService ? activeCatalogue.find((entry) => entry.id === line.itemId) : null;
              const availableQuantity = isService ? Number.POSITIVE_INFINITY : catalogItem?.quantity ?? 0;
              const isEditingPrice = editingPriceLineId === line.lineId;
              const floor = catalogFloorFor(line);
              const surcharge = floor !== null && line.unitPrice > floor ? line.unitPrice - floor : 0;
              return (
                <div key={line.lineId} className="rounded-xl border border-border/70 bg-muted/[0.12] p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold" title={line.label}>{line.label}</p>
                      {isEditingPrice ? (
                        <div className="mt-1 flex items-center gap-1">
                          <Input autoFocus type="number" min="0" step="1" className="h-7 w-24 text-sm" value={priceDraft} onChange={(event) => setPriceDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") commitEditPrice(line); if (event.key === "Escape") cancelEditPrice(); }} />
                          <Button type="button" size="icon-sm" variant="ghost" aria-label="Valider le prix" onClick={() => commitEditPrice(line)}><Check className="size-3.5" /></Button>
                          <Button type="button" size="icon-sm" variant="ghost" aria-label="Annuler" onClick={cancelEditPrice}><X className="size-3.5" /></Button>
                        </div>
                      ) : (
                        <button type="button" disabled={checkoutState !== "READY"} onClick={() => startEditPrice(line)} className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary disabled:pointer-events-none">
                          <span className="font-semibold tabular-nums text-foreground">{money(line.unitPrice)}</span>
                          <span className="underline">modifier</span>
                          {surcharge > 0 ? <span className="rounded-full bg-success/15 px-1.5 py-0.5 font-semibold text-success">+{money(surcharge)}</span> : null}
                        </button>
                      )}
                      {isEditingPrice && priceError ? <p className="mt-1 text-xs text-destructive">{priceError}</p> : null}
                    </div>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={`Retirer ${line.label} du ticket`} disabled={checkoutState !== "READY"} onClick={() => update(line.lineId, { quantity: 0 })}><Trash2 className="text-destructive" /></Button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center rounded-lg border border-border bg-surface"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Diminuer la quantité de ${line.label}`} disabled={checkoutState !== "READY"} onClick={() => update(line.lineId, { quantity: line.quantity - 1 })}><Minus /></Button><span className="min-w-8 text-center text-sm font-bold tabular-nums">{line.quantity}</span><Button type="button" variant="ghost" size="icon-sm" aria-label={`Augmenter la quantité de ${line.label}`} disabled={checkoutState !== "READY" || (!isService && line.quantity >= availableQuantity)} onClick={() => isService ? update(line.lineId, { quantity: line.quantity + 1 }) : addArticle(line.itemId, line.unitPrice, line.label)}><Plus /></Button></div>
                    <p className="font-bold tabular-nums">{money(line.quantity * line.unitPrice)}</p>
                  </div>
                </div>
              );
            })}
            {cart.length === 0 ? <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center"><ShoppingCart className="size-6 text-muted-foreground" /><p className="text-sm font-semibold">Le panier est vide</p><p className="text-xs text-muted-foreground">Touchez un article du rayon pour commencer.</p></div> : null}
          </div>

          <div className="shrink-0 space-y-2.5 border-t border-border/75 bg-muted/[0.10] p-3">
            <div className="flex items-center gap-1" role="radiogroup" aria-label="Moyen de paiement">
              {paymentMethods.map(({ value, label, icon: Icon }) => { const selected = method === value; const jekoDisabled = value === "JEKO"; const offlineUnavailable = posSession.networkStatus !== "ONLINE" && value !== "CASH"; return <button key={value} type="button" role="radio" aria-checked={selected} onClick={() => setPaymentMethod(value)} disabled={checkoutState !== "READY" || jekoDisabled || offlineUnavailable} title={jekoDisabled ? "Jèko sera disponible lorsque l’encaissement transactionnel POS sera relié." : offlineUnavailable ? "Paiement indisponible hors connexion." : value === "WAVE" ? "Saisie mobile manuelle : aucune API Wave directe" : label} className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border text-xs font-semibold transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 ${selected ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-surface text-muted-foreground hover:border-primary/35 hover:text-foreground"}`}><Icon className="size-3.5" /><span className="hidden sm:inline">{jekoDisabled ? "Jèko" : value === "WAVE" ? "Mobile" : label}</span></button>; })}
            </div>
            {method === "CASH" ? <div className="flex items-center gap-2"><Label htmlFor="commerce-pos-cash-received" className="shrink-0 text-xs font-semibold text-muted-foreground">Reçu</Label><Input id="commerce-pos-cash-received" className="h-9 text-right tabular-nums" type="number" min={total} step="1" disabled={checkoutState !== "READY"} placeholder={money(total)} value={cashReceived ?? ""} onChange={(event) => updateDraft((current) => ({ ...current, cashReceived: event.target.value === "" ? null : Number(event.target.value) }))} />{cashReceived !== null ? <span className="shrink-0 text-xs font-semibold text-muted-foreground">Rendu {money(cashChange)}</span> : null}</div> : null}
            <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Total</p><p className="text-xl font-bold tabular-nums">{money(total)}</p></div>
            <Button className="h-14 w-full text-base" loading={saleMutation.isPending} loadingLabel="Comptabilisation" disabled={!canCheckout} onClick={checkout}><WalletCards />{saleMutation.isPending || checkoutState === "PROCESSING" ? "Comptabilisation…" : posSession.networkStatus !== "ONLINE" ? `Conserver ${money(total)}` : `Encaisser ${money(total)}`}<span className="ml-1 hidden text-xs font-normal opacity-75 2xl:inline">· F10</span></Button>
            {hasDraftInProgress ? <div className="flex justify-end gap-2 pt-1"><Button type="button" size="sm" variant="outline" disabled={checkoutState !== "READY" || cart.length === 0} onClick={() => { if (posSession.suspendDraft()) { setShowClient(false); toast.success("Ticket suspendu : aucune opération n’a été comptabilisée."); } }}>Suspendre</Button><Button type="button" size="sm" variant="ghost" disabled={checkoutState !== "READY"} onClick={() => setPendingDraftAction({ type: "DISCARD" })}>Abandonner</Button></div> : null}
          </div>
        </aside>
      </div>
      </>
      )}

      <Dialog open={serviceDialogOpen} onOpenChange={setServiceDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajouter un service</DialogTitle>
            <DialogDescription>Le service est facturé avec ce ticket et créditera la caisse seulement lors de l’encaissement. Il ne crée aucun mouvement de stock.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1"><Label htmlFor="commerce-pos-service-name">Désignation du service</Label><Input id="commerce-pos-service-name" autoFocus value={serviceName} onChange={(event) => setServiceName(event.target.value)} placeholder="Ex. Réparation écran téléphone" /></div>
            <div className="space-y-1"><Label htmlFor="commerce-pos-service-price">Montant (FCFA)</Label><Input id="commerce-pos-service-price" type="number" min="1" step="1" inputMode="numeric" value={servicePrice} onChange={(event) => setServicePrice(event.target.value)} placeholder="15000" /></div>
            <div className="space-y-1"><Label htmlFor="commerce-pos-service-note">Note <span className="font-normal text-muted-foreground">(facultative)</span></Label><Input id="commerce-pos-service-note" value={serviceNote} onChange={(event) => setServiceNote(event.target.value)} placeholder="Détail de l'intervention" /></div>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setServiceDialogOpen(false)}>Annuler</Button><Button type="button" disabled={checkoutState !== "READY" || !serviceName.trim() || Number(servicePrice) <= 0} onClick={addService}><Wrench />Ajouter au ticket</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={suspendedTicketsOpen} onOpenChange={setSuspendedTicketsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Tickets en attente</DialogTitle><DialogDescription>Ces tickets sont enregistrés sur ce poste uniquement. Ils ne créent ni vente, ni mouvement de stock, ni écriture financière avant l’encaissement.</DialogDescription></DialogHeader>
          <div className="max-h-[56dvh] space-y-2 overflow-y-auto pr-1">
            {posSession.suspendedTickets.map((ticket) => <SuspendedTicketRow key={ticket.id} ticket={ticket} onResume={() => { if (posSession.resumeSuspendedTicket(ticket.id)) { setShowClient(Boolean(ticket.draft.clientId)); setSuspendedTicketsOpen(false); toast.success("Ticket repris dans la caisse."); } }} onDelete={() => setPendingSuspendedDeletion(ticket)} />)}
            {!posSession.suspendedTickets.length ? <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">Aucun ticket n’est en attente sur ce poste.</div> : null}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDraftAction !== null} onOpenChange={(open) => { if (!open) setPendingDraftAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abandonner la vente en cours ?</AlertDialogTitle>
            <AlertDialogDescription>
              {cart.length} article{cart.length > 1 ? "s" : ""} · {money(total)}. Le brouillon de cette caisse sera supprimé, mais aucune vente ni écriture financière ne sera modifiée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Conserver la vente</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={applyDraftAction}>Abandonner</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={pendingSuspendedDeletion !== null} onOpenChange={(open) => { if (!open) setPendingSuspendedDeletion(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce ticket suspendu ?</AlertDialogTitle>
            <AlertDialogDescription>Le ticket {pendingSuspendedDeletion ? `POS-${pendingSuspendedDeletion.draft.sessionId.slice(-8).toUpperCase()}` : ""} sera supprimé de ce poste. Aucune vente, aucun stock et aucune écriture financière ne seront annulés car rien n’a encore été comptabilisé.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Conserver</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (pendingSuspendedDeletion) posSession.removeSuspendedTicket(pendingSuspendedDeletion.id); setPendingSuspendedDeletion(null); toast.success("Ticket suspendu supprimé."); }}>Supprimer</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Mission caisse-UX: a dedicated, always-legible "où en est ma session ?"
 * screen -- no Finance vocabulary, no wallet, nothing the cashier has to
 * interpret beyond what they already see in the header at a glance. */
function CashierSessionTab({ locationName, cashierName, sessionOpenedLabel, session, summary, syncStatusLabel, lastSuccessfulSyncAt, disabled, onClose, onStartNew }: {
  locationName: string;
  cashierName: string;
  sessionOpenedLabel: string;
  session: ReturnType<typeof useCommercePosSession>["cashSession"];
  summary: ReturnType<typeof useCommercePosSession>["cashSessionSummary"];
  syncStatusLabel: string;
  lastSuccessfulSyncAt: string | null;
  disabled: boolean;
  onClose: () => Promise<void>;
  onStartNew: () => Promise<void>;
}) {
  return (
    <div className="flex-1 space-y-3 overflow-auto">
      <Card variant="section">
        <CardHeader className="pb-3"><CardTitle className="text-lg">Cette session</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-muted/[0.12] p-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Caisse</p><p className="mt-1 font-semibold">{locationName}</p></div>
          <div className="rounded-xl border border-border/70 bg-muted/[0.12] p-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Caissier</p><p className="mt-1 font-semibold">{cashierName}</p></div>
          <div className="rounded-xl border border-border/70 bg-muted/[0.12] p-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Session ouverte</p><p className="mt-1 font-semibold tabular-nums">{sessionOpenedLabel}</p></div>
          <div className="rounded-xl border border-border/70 bg-muted/[0.12] p-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Synchronisation</p><p className="mt-1 font-semibold">{syncStatusLabel}</p>{lastSuccessfulSyncAt ? <p className="mt-0.5 text-xs text-muted-foreground">{new Date(lastSuccessfulSyncAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</p> : null}</div>
        </CardContent>
      </Card>
      {summary ? <Card variant="section">
        <CardHeader className="pb-3"><CardTitle className="text-lg">Depuis l’ouverture</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-border/70 bg-muted/[0.12] p-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tickets</p><p className="mt-1 text-lg font-bold tabular-nums">{summary.ticketCount}</p></div>
          <div className="rounded-xl border border-border/70 bg-muted/[0.12] p-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Articles</p><p className="mt-1 text-lg font-bold tabular-nums">{money(summary.articleTotal)}</p></div>
          <div className="rounded-xl border border-border/70 bg-muted/[0.12] p-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Services</p><p className="mt-1 text-lg font-bold tabular-nums">{money(summary.serviceTotal)}</p></div>
          <div className="rounded-xl border border-primary/25 bg-primary/[0.06] p-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Total</p><p className="mt-1 text-lg font-bold tabular-nums text-primary">{money(summary.theoreticalCash)}</p></div>
        </CardContent>
      </Card> : null}
      <Card variant="section">
        <CardHeader className="pb-3"><CardTitle className="text-lg">Fin de journée</CardTitle><p className="text-sm text-muted-foreground">Clôturez lorsque vous avez terminé de vendre. Le contrôle et la réception des espèces se font ensuite côté gestion.</p></CardHeader>
        <CardContent><PosCashSessionClose session={session} summary={summary} disabled={disabled} onClose={onClose} onStartNew={onStartNew} /></CardContent>
      </Card>
    </div>
  );
}

/** Mission caisse-UX: the cashier's own ticket history for this session --
 * time, ticket, content, amount, payment method, sync status. No net
 * result, no CMV, no Finance -- that belongs to the manager's control
 * center, not this screen. */
function CashierSalesTab({ events }: { events: ReturnType<typeof useCommercePosSession>["outboxEvents"] }) {
  const sales = useMemo(
    () => events.filter((event): event is Extract<typeof events[number], { operation: "CREATE_CASH_SALE" }> => event.operation === "CREATE_CASH_SALE")
      .sort((left, right) => right.createdAtDevice.localeCompare(left.createdAtDevice)),
    [events],
  );
  const syncLabel = (status: string) => status === "SYNCED" ? "Synchronisé" : status === "CONFLICT" ? "À contrôler" : status === "SYNCING" ? "Synchronisation…" : status === "FAILED" ? "Nouvel essai" : "En attente";
  return (
    <div className="flex-1 overflow-auto">
      <Card variant="section">
        <CardHeader className="pb-3"><CardTitle className="text-lg">Mes ventes</CardTitle><p className="text-sm text-muted-foreground">{sales.length} ticket{sales.length > 1 ? "s" : ""} sur cette session.</p></CardHeader>
        <CardContent className="p-0">
          {sales.length ? <div className="divide-y divide-border/60">
            {sales.map((sale) => {
              const articleCount = sale.payload.lines.filter((line) => line.lineType === "ARTICLE").length;
              const serviceCount = sale.payload.lines.filter((line) => line.lineType === "SERVICE").length;
              return <div key={sale.eventId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">{new Date(sale.createdAtDevice).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · {sale.serverInvoiceNumber ?? `Ticket ${sale.eventId.slice(-8).toUpperCase()}`}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{articleCount ? `${articleCount} article${articleCount > 1 ? "s" : ""}` : ""}{articleCount && serviceCount ? " · " : ""}{serviceCount ? `${serviceCount} service${serviceCount > 1 ? "s" : ""}` : ""} · {sale.payload.paymentMethod === "CASH" ? "Espèces" : sale.payload.paymentMethod}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-bold tabular-nums">{money(sale.payload.total)}</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sale.status === "SYNCED" ? "bg-success/10 text-success" : sale.status === "CONFLICT" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>{syncLabel(sale.status)}</span>
                </div>
              </div>;
            })}
          </div> : <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center"><ReceiptText className="size-6 text-muted-foreground" /><p className="text-sm font-semibold">Aucune vente pour l’instant</p></div>}
        </CardContent>
      </Card>
    </div>
  );
}

type CommerceLocationMode = "create" | "edit";

interface CommerceLocationFormProps {
  mode: CommerceLocationMode;
  location?: CommercePosLocation;
  primaryWalletId?: string;
  onDone: (locationId: string) => void;
}

function CommerceLocationForm({ mode, location, primaryWalletId = "", onDone }: CommerceLocationFormProps) {
  const isEdit = mode === "edit";
  const [name, setName] = useState(location?.name ?? "");
  const [code, setCode] = useState(location?.code ?? "");
  const [walletId, setWalletId] = useState(primaryWalletId);
  const [userId, setUserId] = useState("");
  const optionsQuery = useQuery({ queryKey: ["commerce-setup-options"], queryFn: () => getCommerceSetupOptions() });
  const createMutation = useMutation({
    mutationFn: setupCommerceLocation,
    onSuccess: (created) => {
      toast.success(`${created.name} est prêt pour la caisse.`);
      onDone(created.locationId);
    },
    onError: (error) => toast.error(error instanceof Error && error.message ? error.message : "Le magasin n’a pas pu être créé. Vérifiez le code, le wallet et les droits d’accès."),
  });
  const updateMutation = useMutation({
    mutationFn: updateCommerceLocation,
    onSuccess: (updated) => {
      toast.success(`${updated.name} a été mis à jour.`);
      onDone(updated.locationId);
    },
    onError: (error) => toast.error(error instanceof Error && error.message ? error.message : "Le magasin n’a pas pu être mis à jour. Vérifiez le code, le wallet et les droits d’accès."),
  });
  const normalizeCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  const saving = createMutation.isPending || updateMutation.isPending;
  const save = () => {
    if (isEdit && location) {
      updateMutation.mutate({ data: { locationId: location.id, name, code, walletId } });
      return;
    }
    createMutation.mutate({ data: { name, code, walletId, userId: userId || null } });
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1">
        <Label>Nom du magasin</Label>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Accessoires & sacs" />
      </div>
      <div className="space-y-1">
        <Label>Code</Label>
        <Input value={code} onChange={(event) => setCode(normalizeCode(event.target.value))} placeholder="MAGASIN_CENTRAL" />
        <p className="text-caption">Les espaces sont automatiquement remplacés par des tirets bas.</p>
      </div>
      <div className="space-y-1">
        <Label>Wallet de caisse</Label>
        <Select value={walletId} onValueChange={setWalletId}>
          <SelectTrigger><SelectValue placeholder="Choisir le wallet" /></SelectTrigger>
          <SelectContent>{optionsQuery.data?.wallets.map((wallet) => <SelectItem key={wallet.id} value={wallet.id}>{wallet.name}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-caption">Modifier le wallet conserve toutes les ventes historiques dans leur wallet d’origine.</p>
      </div>
      {!isEdit ? (
        <div className="space-y-1">
          <Label>Caissier initial (facultatif)</Label>
          <Select value={userId || "NONE"} onValueChange={(value) => setUserId(value === "NONE" ? "" : value)}>
            <SelectTrigger><SelectValue placeholder="Affecter plus tard" /></SelectTrigger>
            <SelectContent><SelectItem value="NONE">Affecter plus tard</SelectItem>{optionsQuery.data?.users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ) : location ? <CommerceLocationAssignments locationId={location.id} /> : null}
      <div className="md:col-span-2">
        <Button disabled={saving || !name.trim() || !code.trim() || !walletId} onClick={save}><Store />{saving ? "Enregistrement…" : isEdit ? "Mettre à jour le magasin" : "Créer le magasin et sa caisse"}</Button>
        <p className="mt-3 text-caption">Cette configuration ne modifie jamais le solde d’un wallet.</p>
      </div>
    </div>
  );
}

function SuspendedTicketRow({ ticket, onResume, onDelete }: { ticket: CommercePosSuspendedTicket; onResume: () => void; onDelete: () => void }) {
  const total = ticket.draft.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const articleCount = ticket.draft.lines.filter((line) => line.lineType === "ARTICLE").length;
  const serviceCount = ticket.draft.lines.filter((line) => line.lineType === "SERVICE").length;
  const timestamp = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(ticket.suspendedAt));

  return <div className="rounded-xl border border-border/75 bg-muted/[0.12] p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-sm font-bold text-primary">POS-{ticket.draft.sessionId.slice(-8).toUpperCase()}</p><p className="mt-1 text-sm text-muted-foreground">{timestamp} · {ticket.draft.clientId ? "Client renseigné" : "Client comptoir"} · Caissier de ce poste</p><p className="mt-1 text-xs text-muted-foreground">{ticket.draft.lines.length} ligne{ticket.draft.lines.length > 1 ? "s" : ""} · {articleCount} article{articleCount > 1 ? "s" : ""}{serviceCount ? ` · ${serviceCount} service${serviceCount > 1 ? "s" : ""}` : ""}</p></div><p className="shrink-0 font-bold tabular-nums">{money(total)}</p></div><div className="mt-3 flex justify-end gap-2"><Button type="button" size="sm" variant="outline" onClick={onDelete}>Supprimer</Button><Button type="button" size="sm" onClick={onResume}>Reprendre</Button></div></div>;
}

function CommerceLocationSetup({ onDone }: { onDone: (locationId: string) => void }) {
  return <Card variant="section"><CardHeader><CardTitle>Initialiser votre premier magasin</CardTitle></CardHeader><CardContent><CommerceLocationForm mode="create" onDone={onDone} /></CardContent></Card>;
}

type CommerceAssignmentRole = "CASHIER" | "STORE_MANAGER" | "STOCK_KEEPER" | "SALES_AGENT" | "OTHER";

const commerceAssignmentRoles: Array<{ value: CommerceAssignmentRole; label: string }> = [
  { value: "CASHIER", label: "Caissier" },
  { value: "STORE_MANAGER", label: "Responsable magasin" },
  { value: "STOCK_KEEPER", label: "Gestionnaire de stock" },
  { value: "SALES_AGENT", label: "Vendeur" },
  { value: "OTHER", label: "Autre" },
];

function CommerceLocationAssignments({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState("");
  const [assignmentRole, setAssignmentRole] = useState<CommerceAssignmentRole>("CASHIER");
  const assignmentsQuery = useQuery({
    queryKey: ["commerce-location-assignments", locationId],
    queryFn: () => getCommerceLocationAssignments({ data: { locationId } }),
    enabled: Boolean(locationId),
  });
  const optionsQuery = useQuery({ queryKey: ["commerce-setup-options"], queryFn: () => getCommerceSetupOptions() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["commerce-location-assignments", locationId] });
  const assignMutation = useMutation({
    mutationFn: assignCommerceLocationUser,
    onSuccess: async () => {
      toast.success("L’affectation du collaborateur est enregistrée.");
      setUserId("");
      setAssignmentRole("CASHIER");
      await refresh();
    },
    onError: (error) => toast.error(error instanceof Error && error.message ? error.message : "L’affectation n’a pas pu être enregistrée."),
  });
  const endMutation = useMutation({
    mutationFn: endCommerceLocationAssignment,
    onSuccess: async () => {
      toast.success("L’accès au magasin a été retiré.");
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["commerce-pos-locations"] });
    },
    onError: (error) => toast.error(error instanceof Error && error.message ? error.message : "L’affectation n’a pas pu être retirée."),
  });
  const setRole = (value: string) => {
    const selectedRole = commerceAssignmentRoles.find((role) => role.value === value);
    if (selectedRole) setAssignmentRole(selectedRole.value);
  };
  const remove = (assignmentId: string, userName: string) => {
    if (window.confirm(`Retirer l’accès de ${userName} à ce magasin ? Ses ventes et son historique seront conservés.`)) {
      endMutation.mutate({ data: { assignmentId } });
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-dashed border-border/80 p-4 md:col-span-2">
      <div>
        <p className="font-semibold">Collaborateurs affectés</p>
        <p className="text-caption">Ces personnes peuvent utiliser ce point de vente selon leur rôle et leurs permissions.</p>
      </div>
      {assignmentsQuery.isPending ? <Skeleton className="h-20" /> : null}
      {assignmentsQuery.isError ? <p className="text-caption text-destructive">Impossible de charger les affectations actuelles.</p> : null}
      {!assignmentsQuery.isPending && !assignmentsQuery.isError && assignmentsQuery.data?.length === 0 ? <p className="rounded-lg bg-muted/40 p-3 text-caption">Aucun collaborateur n’est encore affecté à ce magasin.</p> : null}
      <div className="space-y-2">
        {assignmentsQuery.data?.map((assignment) => (
          <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 p-3">
            <div className="min-w-0">
              <p className="font-medium">{assignment.userName}</p>
              <p className="text-caption">{commerceAssignmentRoles.find((role) => role.value === assignment.assignmentRole)?.label ?? assignment.assignmentRole}{assignment.username ? ` · @${assignment.username}` : ""}</p>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={endMutation.isPending} onClick={() => remove(assignment.id, assignment.userName)}><UserRoundX />Retirer</Button>
          </div>
        ))}
      </div>
      <div className="grid gap-3 border-t border-border/70 pt-4 md:grid-cols-[minmax(0,1fr)_220px_auto]">
        <div className="space-y-1"><Label>Collaborateur</Label><Select value={userId} onValueChange={setUserId}><SelectTrigger><SelectValue placeholder="Choisir un utilisateur" /></SelectTrigger><SelectContent>{optionsQuery.data?.users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label>Rôle dans ce magasin</Label><Select value={assignmentRole} onValueChange={setRole}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{commerceAssignmentRoles.map((role) => <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>)}</SelectContent></Select></div>
        <div className="flex items-end"><Button type="button" disabled={assignMutation.isPending || !userId} onClick={() => assignMutation.mutate({ data: { locationId, userId, assignmentRole, notes: null } })}><UserPlus />{assignMutation.isPending ? "Affectation…" : "Affecter"}</Button></div>
      </div>
      <p className="text-caption">Réaffecter un collaborateur met à jour son rôle tout en conservant son historique d’affectation.</p>
    </div>
  );
}

function CommerceLocationDialog({ mode, location, primaryWalletId, onDone }: CommerceLocationFormProps) {
  const [open, setOpen] = useState(false);
  const isEdit = mode === "edit";
  const disabled = isEdit && (!location || !primaryWalletId);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button type="button" variant={isEdit ? "outline" : "default"} disabled={disabled}>{isEdit ? <Pencil /> : <Plus />}{isEdit ? "Modifier" : "Nouveau magasin"}</Button></DialogTrigger><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{isEdit ? "Modifier le magasin" : "Créer un autre magasin"}</DialogTitle><DialogDescription>{isEdit ? "Les ventes existantes restent inchangées. Seule la configuration future du point de vente est modifiée." : "Chaque magasin dispose de son propre catalogue en rayon, de ses caissiers affectés et de son wallet de caisse."}</DialogDescription></DialogHeader><CommerceLocationForm mode={mode} location={location} primaryWalletId={primaryWalletId} onDone={(locationId) => { setOpen(false); onDone(locationId); }} /></DialogContent></Dialog>;
}

function CommerceQuickInventoryReceipt({ locationId, locationName, onSaved, triggerVariant = "default" }: { locationId: string; locationName: string; onSaved: () => void; triggerVariant?: "default" | "outline" }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"new" | "restock">("new");
  const [itemId, setItemId] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState("Piece");
  const [quantity, setQuantity] = useState("");
  const [purchaseUnitPrice, setPurchaseUnitPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [walletId, setWalletId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const catalogueQuery = useQuery({ queryKey: ["commerce-inventory-catalogue", locationId], queryFn: () => getCommerceInventoryCatalogue({ data: { locationId } }), enabled: open && Boolean(locationId) });
  const walletsQuery = useQuery({ queryKey: ["wallets"], queryFn: () => getWallets(), enabled: open });
  const selectedItem = catalogueQuery.data?.find((item) => item.id === itemId);
  const totalPurchase = Number(quantity || 0) * Number(purchaseUnitPrice || 0);
  const grossMarginPerUnit = Number(salePrice || 0) - Number(purchaseUnitPrice || 0);
  const canSubmit = Boolean(locationId && walletId && quantity && purchaseUnitPrice && salePrice && (mode === "new" ? name.trim() : itemId));
  const reset = () => {
    setMode("new"); setItemId(""); setName(""); setCategory(""); setSku(""); setUnit("Piece"); setQuantity(""); setPurchaseUnitPrice(""); setSalePrice(""); setWalletId(""); setSupplier(""); setReference(""); setReorderLevel("");
  };
  const mutation = useMutation({
    mutationFn: receiveCommerceInventoryItem,
    onSuccess: async (receipt) => {
      toast.success(`Produit reçu et disponible en rayon : ${receipt.quantity} unité(s).`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["commerce-inventory-catalogue", locationId] }),
        queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", locationId] }),
        queryClient.invalidateQueries({ queryKey: ["commerce-management-dashboard", locationId] }),
        queryClient.invalidateQueries({ queryKey: ["stock-movements"] }),
        queryClient.invalidateQueries({ queryKey: ["wallets"] }),
      ]);
      onSaved();
      reset();
      setOpen(false);
    },
    onError: (error) => toast.error(error instanceof Error && error.message ? error.message : "La réception a été refusée. Aucun produit, stock ou mouvement financier n’a été enregistré."),
  });
  const selectExistingItem = (value: string) => {
    const item = catalogueQuery.data?.find((entry) => entry.id === value);
    setItemId(value);
    setSalePrice(item?.salePrice === null || item?.salePrice === undefined ? "" : String(item.salePrice));
    setReorderLevel(item?.reorderLevel === null || item?.reorderLevel === undefined ? "" : String(item.reorderLevel));
  };
  const save = () => {
    if (!canSubmit) return;
    mutation.mutate({ data: {
      businessLocationId: locationId,
      inventoryItemId: mode === "restock" ? itemId : null,
      name: mode === "new" ? name.trim() : null,
      category: mode === "new" && category.trim() ? category.trim() : null,
      sku: mode === "new" && sku.trim() ? sku.trim() : null,
      unit: mode === "new" && unit.trim() ? unit.trim() : null,
      quantity: Number(quantity),
      purchaseUnitPrice: Number(purchaseUnitPrice),
      salePrice: Number(salePrice),
      walletId,
      supplier: supplier.trim() || null,
      reference: reference.trim() || null,
      reorderLevel: reorderLevel === "" ? null : Number(reorderLevel),
      movementDate: new Date().toISOString().slice(0, 10),
    } });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen && !mutation.isPending) reset(); }}>
      <DialogTrigger asChild><Button type="button" variant={triggerVariant}><PackagePlus /> Ajouter un produit</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajouter un produit au magasin</DialogTitle>
          <DialogDescription>Une seule validation crée ou réapprovisionne l’article, enregistre l’achat fournisseur, débite le wallet choisi et place la quantité reçue dans ce magasin.</DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-primary/15 bg-primary/[0.06] px-4 py-3 text-sm">
          <span className="font-semibold">Magasin sélectionné : </span>{locationName}
          <span className="mt-1 block text-muted-foreground">La réception est datée d’aujourd’hui. Le stock, l’achat et la mise en rayon sont annulés ensemble si une étape échoue.</span>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-1">
          <Button type="button" size="sm" variant={mode === "new" ? "default" : "ghost"} onClick={() => setMode("new")}>Nouvel article</Button>
          <Button type="button" size="sm" variant={mode === "restock" ? "default" : "ghost"} onClick={() => setMode("restock")}>Réapprovisionner</Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === "new" ? <>
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="commerce-receipt-name">Nom de l’article *</Label><Input id="commerce-receipt-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Chargeur rapide USB-C" autoFocus /></div>
            <div className="space-y-1"><Label htmlFor="commerce-receipt-category">Catégorie <span className="font-normal text-muted-foreground">(facultatif)</span></Label><Input id="commerce-receipt-category" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Accessoires téléphone" /></div>
            <div className="space-y-1"><Label htmlFor="commerce-receipt-sku">Référence <span className="font-normal text-muted-foreground">(facultatif)</span></Label><Input id="commerce-receipt-sku" value={sku} onChange={(event) => setSku(event.target.value)} placeholder="USB-C-20W" /></div>
          </> : <div className="space-y-2 sm:col-span-2"><Label>Article à réapprovisionner *</Label><Select value={itemId} onValueChange={selectExistingItem} disabled={catalogueQuery.isPending || catalogueQuery.isError || !catalogueQuery.data?.length}><SelectTrigger><SelectValue placeholder={catalogueQuery.isPending ? "Chargement…" : catalogueQuery.isError ? "Catalogue indisponible" : catalogueQuery.data?.length ? "Choisir un article déjà créé" : "Aucun article dans le catalogue"} /></SelectTrigger><SelectContent>{catalogueQuery.data?.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.sku ? ` · ${item.sku}` : ""}</SelectItem>)}</SelectContent></Select>{catalogueQuery.isError ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive"><span>Le catalogue des articles n’a pas pu être chargé. Aucune réception ne sera enregistrée tant que cette erreur persiste.</span><Button type="button" size="sm" variant="outline" onClick={() => void catalogueQuery.refetch()}>Réessayer</Button></div> : null}{catalogueQuery.isSuccess && !catalogueQuery.data.length ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2 text-xs text-muted-foreground"><span>Aucun article existant à réapprovisionner. Créez d’abord l’article une seule fois ; il apparaîtra ensuite ici.</span><Button type="button" size="sm" variant="outline" onClick={() => setMode("new")}>Nouvel article</Button></div> : null}{selectedItem ? <p className="text-xs text-muted-foreground">En rayon : {selectedItem.locationQuantity} {selectedItem.unit ?? "unité"} · stock global : {selectedItem.globalQuantity}.</p> : null}</div>}
          {mode === "new" ? <div className="space-y-1"><Label htmlFor="commerce-receipt-unit">Unité</Label><Input id="commerce-receipt-unit" value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Pièce" /></div> : null}
          <div className="space-y-1"><Label htmlFor="commerce-receipt-quantity">Quantité reçue *</Label><Input id="commerce-receipt-quantity" type="number" min="0.001" step="0.001" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0" /></div>
          <div className="space-y-1"><Label htmlFor="commerce-receipt-purchase-price">Prix d’achat unitaire (FCFA) *</Label><Input id="commerce-receipt-purchase-price" type="number" min="1" step="1" inputMode="numeric" value={purchaseUnitPrice} onChange={(event) => setPurchaseUnitPrice(event.target.value)} placeholder="0" /></div>
          <div className="space-y-1"><Label htmlFor="commerce-receipt-sale-price">Prix de vente unitaire (FCFA) *</Label><Input id="commerce-receipt-sale-price" type="number" min="0" step="1" inputMode="numeric" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} placeholder="0" /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Wallet débité pour l’achat *</Label><Select value={walletId} onValueChange={setWalletId}><SelectTrigger><SelectValue placeholder={walletsQuery.isPending ? "Chargement des wallets…" : "Choisir le wallet qui paie le fournisseur"} /></SelectTrigger><SelectContent>{walletsQuery.data?.map((wallet) => <SelectItem key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.type}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Le débit est créé par le moteur financier existant, jamais manuellement.</p></div>
          <div className="space-y-1"><Label htmlFor="commerce-receipt-supplier">Fournisseur <span className="font-normal text-muted-foreground">(facultatif)</span></Label><Input id="commerce-receipt-supplier" value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Nom du fournisseur" /></div>
          <div className="space-y-1"><Label htmlFor="commerce-receipt-reorder">Seuil d’alerte <span className="font-normal text-muted-foreground">(facultatif)</span></Label><Input id="commerce-receipt-reorder" type="number" min="0" step="0.001" inputMode="decimal" value={reorderLevel} onChange={(event) => setReorderLevel(event.target.value)} placeholder="Ex. 3" /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="commerce-receipt-reference">Référence d’achat <span className="font-normal text-muted-foreground">(facultatif)</span></Label><Input id="commerce-receipt-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Facture fournisseur, reçu ou référence mobile money" /></div>
        </div>
        <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/[0.18] p-4 sm:grid-cols-2">
          <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Achat total</p><p className="mt-1 text-lg font-semibold tabular-nums">{money(totalPurchase)}</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Marge brute prévisionnelle / unité</p><p className={`mt-1 text-lg font-semibold tabular-nums ${grossMarginPerUnit < 0 ? "text-destructive" : "text-success"}`}>{money(grossMarginPerUnit)}</p><p className="mt-1 text-xs text-muted-foreground">Prix de vente moins prix d’achat, hors autres charges.</p></div>
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>Annuler</Button><Button type="button" onClick={save} disabled={!canSubmit || mutation.isPending}>{mutation.isPending ? "Réception en cours…" : "Ajouter au magasin"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommerceInventorySetup({ locationId, onSaved }: { locationId: string; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const catalogueQuery = useQuery({ queryKey: ["commerce-inventory-catalogue", locationId], queryFn: () => getCommerceInventoryCatalogue({ data: { locationId } }), enabled: open && Boolean(locationId) });
  const selected = catalogueQuery.data?.find((item) => item.id === itemId);
  const mutation = useMutation({
    mutationFn: configureCommerceLocationItem,
    onSuccess: async () => {
      toast.success("Article mis en rayon. La caisse est à jour.");
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["commerce-inventory-catalogue", locationId] }), queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", locationId] })]);
      onSaved();
      setOpen(false);
    },
    onError: () => toast.error("La mise en rayon a été refusée. Vérifiez la quantité disponible et vos droits."),
  });
  const selectItem = (value: string) => {
    const item = catalogueQuery.data?.find((entry) => entry.id === value);
    setItemId(value);
    setQuantity(item ? String(item.locationQuantity) : "");
    setSalePrice(item?.salePrice === null || item?.salePrice === undefined ? "" : String(item.salePrice));
    setReorderLevel(item?.reorderLevel === null || item?.reorderLevel === undefined ? "" : String(item.reorderLevel));
  };
  const save = () => {
    if (!selected || quantity === "" || salePrice === "") return;
    mutation.mutate({ data: { businessLocationId: locationId, inventoryItemId: selected.id, quantity: Number(quantity), salePrice: Number(salePrice), reorderLevel: reorderLevel === "" ? null : Number(reorderLevel) } });
  };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button type="button" variant="outline"><PackagePlus />Mettre en rayon</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Mettre un article en rayon</DialogTitle><DialogDescription>Cette opération répartit le stock existant vers ce magasin. Elle ne crée aucune dépense, recette ou modification de wallet.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1 sm:col-span-2"><Label>Article existant</Label><Select value={itemId} onValueChange={selectItem}><SelectTrigger><SelectValue placeholder={catalogueQuery.isPending ? "Chargement…" : "Choisir un article"} /></SelectTrigger><SelectContent>{catalogueQuery.data?.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.sku ? ` · ${item.sku}` : ""}</SelectItem>)}</SelectContent></Select></div>{selected ? <p className="text-caption sm:col-span-2">Stock global : {selected.globalQuantity} {selected.unit ?? "unité"} · encore affectable : {selected.availableToAllocate} {selected.unit ?? "unité"} · déjà en rayon : {selected.locationQuantity} {selected.unit ?? "unité"}</p> : null}<div className="space-y-1"><Label>Quantité en rayon</Label><Input type="number" min="0" max={selected ? selected.locationQuantity + selected.availableToAllocate : undefined} step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div><div className="space-y-1"><Label>Prix de vente (FCFA)</Label><Input type="number" min="0" step="1" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} /></div><div className="space-y-1"><Label>Seuil d’alerte (facultatif)</Label><Input type="number" min="0" step="0.001" value={reorderLevel} onChange={(event) => setReorderLevel(event.target.value)} /></div></div><DialogFooter><Button type="button" disabled={mutation.isPending || !selected || quantity === "" || salePrice === ""} onClick={save}>{mutation.isPending ? "Mise en rayon…" : "Enregistrer l’article"}</Button></DialogFooter></DialogContent></Dialog>;
}
