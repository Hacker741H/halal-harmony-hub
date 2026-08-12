import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Banknote, BarChart3, CheckCircle2, CircleDollarSign, CloudOff, CloudUpload, CreditCard, ListTodo, Minus, Package, PackagePlus, Pencil, Plus, ReceiptText, Search, ShoppingCart, Smartphone, Store, TrendingUp, TriangleAlert, Trash2, UserPlus, UserRoundX, WalletCards, Warehouse, Wrench } from "lucide-react";
import { toast } from "sonner";

import { PosCashSessionClose } from "@/components/commerce/pos-cash-session-close";
import { ClientSelect } from "@/components/selects/entity-selects";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
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
  const canUseManagementWorkspace = canAny(["locations.manage", "commerce.stock.receive", "sales.finance.read"]);

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
  const refreshDashboard = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["commerce-management-dashboard", selectedLocationId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", selectedLocationId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-locations"] }),
    ]);
  };
  const handleLocationSaved = async (savedLocationId: string) => {
    setLocationId(savedLocationId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-locations"] }),
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
  const locationsQuery = useQuery({ queryKey: ["commerce-pos-locations"], queryFn: () => getCommercePosLocations() });
  const currentUserId = useCommerceCashierUserId();
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
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [catalogueSearch, setCatalogueSearch] = useState("");
  const [catalogueSelectedIndex, setCatalogueSelectedIndex] = useState(0);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [serviceNote, setServiceNote] = useState("");
  const [suspendedTicketsOpen, setSuspendedTicketsOpen] = useState(false);
  const [pendingSuspendedDeletion, setPendingSuspendedDeletion] = useState<CommercePosSuspendedTicket | null>(null);
  const [showClient, setShowClient] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
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
  const catalogueItems = useMemo(
    () => activeCatalogue.filter((item) => `${item.name} ${item.sku ?? ""}`.toLowerCase().includes(catalogueSearch.toLowerCase())),
    [activeCatalogue, catalogueSearch],
  );
  const enrichedCart = useMemo(
    () => cart.map((line) => ({ ...line, item: line.lineType === "ARTICLE" ? activeCatalogue.find((entry) => entry.id === line.itemId) ?? null : null })),
    [activeCatalogue, cart],
  );
  const total = cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const stockConflicts = useMemo(
    () => getCommercePosStockConflicts(cart, activeCatalogue.map((item) => ({ itemId: item.id, label: item.name, availableQuantity: item.quantity }))),
    [activeCatalogue, cart],
  );
  const cashChange = method === "CASH" && cashReceived !== null ? Math.max(cashReceived - total, 0) : 0;
  const ticketReference = draft ? `POS-${draft.sessionId.slice(-8).toUpperCase()}` : "—";
  const ticketDate = draft ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(draft.updatedAt)) : "—";
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
  const closeCashSession = async (input: { countedCash: number; note: string | null }) => {
    const result = await posSession.closeCashSession(input);
    setMobileCartOpen(false);
    toast.success(`Cl\u00f4ture locale enregistr\u00e9e : ${money(result.summary.countedCash)} compt\u00e9s. La synchronisation suivra les ventes de cette session.`);
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
      setMobileCartOpen(false);
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
      setCatalogueSearch(search);
      setCatalogueSelectedIndex(0);
      setCatalogueOpen(true);
      return;
    }
    const item = items[0];
    addArticle(item.id, item.salePrice, item.name, quantity);
    setSearch("");
    setQuickQuantity("1");
    refocusQuickEntry();
  };
  const openCatalogue = () => {
    setCatalogueSearch(search);
    setCatalogueSelectedIndex(0);
    setCatalogueOpen(true);
  };
  const addFromCatalogue = (itemIndex: number) => {
    const item = catalogueItems[itemIndex];
    if (!item) return;
    if (item.quantity <= 0) {
      toast.error("Cet article n’est plus disponible dans ce magasin.");
      return;
    }
    addArticle(item.id, item.salePrice, item.name);
    setCatalogueOpen(false);
    setSearch("");
    setCatalogueSearch("");
    refocusQuickEntry();
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
          setMobileCartOpen(false);
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

  if (locationsQuery.isPending && !availableLocations.length) return <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-72 lg:col-span-2" /><Skeleton className="h-72" /></div>;
  if (locationsQuery.isError && !availableLocations.length) return <Card variant="information"><CardContent className="p-6">Impossible de charger vos points de vente autorisés. Ouvrez d’abord la caisse une fois avec Internet pour la rendre disponible hors connexion.</CardContent></Card>;
  if (!availableLocations.length) {
    return canManageLocations
      ? <CommerceLocationSetup onDone={handleLocationSaved} />
      : <Card variant="information"><CardHeader><CardTitle>Aucune caisse disponible</CardTitle></CardHeader><CardContent>Votre compte doit être affecté à un magasin Commerce avant de pouvoir encaisser. Un administrateur doit créer le magasin, associer son wallet puis vous y affecter.</CardContent></Card>;
  }

  return (
    <div className="grid min-h-0 gap-3 lg:h-[calc(100dvh-6.4rem)] lg:grid-rows-[auto_minmax(0,1fr)_auto]">
      <Card variant="section" className="shrink-0 overflow-hidden border-primary/20 bg-surface shadow-sm">
        <CardContent className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ticket en cours</p><p className="mt-1 font-mono text-sm font-bold tracking-wide text-primary">{ticketReference}</p></div>
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Point de vente</p><p className="mt-1 truncate text-sm font-semibold" title={currentLocationName}>{currentLocationName}</p></div>
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Caissier</p><p className="mt-1 text-sm font-medium">Session caisse active</p></div>
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Client · date</p><p className="mt-1 truncate text-sm font-medium">{clientId ? "Ticket nominatif" : "Client comptoir"} · {ticketDate}</p></div>
          </div>
          <div className="rounded-xl bg-foreground px-5 py-3 text-right text-background shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-background/65">Total à encaisser</p>
            <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{money(total)}</p>
          </div>
          <PosCashSessionClose
            session={posSession.cashSession}
            summary={posSession.cashSessionSummary}
            disabled={hasDraftInProgress || posSession.suspendedTickets.length > 0}
            onClose={closeCashSession}
            onStartNew={startNewCashSession}
          />
        </CardContent>
      </Card>

      <details className={`group shrink-0 rounded-xl border px-4 py-2.5 text-sm ${posSession.networkStatus !== "ONLINE" ? "border-warning/30 bg-warning/[0.08] text-warning" : "border-success/25 bg-success/[0.07] text-success"}`}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <span className="flex items-center gap-2 font-semibold">
            {posSession.networkStatus !== "ONLINE" ? <CloudOff className="size-4" aria-hidden="true" /> : <CloudUpload className="size-4" aria-hidden="true" />}
            {posSession.networkStatus !== "ONLINE"
              ? "Hors connexion — la caisse continue localement."
              : posSession.syncProgress
                ? `Synchronisation ${posSession.syncProgress.completed}/${posSession.syncProgress.total}`
                : "En ligne — caisse prête"}
          </span>
          <span>{posSession.pendingOutboxCount
            ? `${posSession.pendingOutboxCount} opération${posSession.pendingOutboxCount > 1 ? "s" : ""} locale${posSession.pendingOutboxCount > 1 ? "s" : ""} à synchroniser`
            : "Aucune vente locale en attente"}</span>
        </summary>
        {posSession.outboxEvents.length ? <div className="mt-3 grid gap-1 border-t border-current/15 pt-2 text-xs">
          {posSession.outboxEvents.slice(0, 4).map((event) => <div key={event.eventId} className="flex items-center justify-between gap-3"><span className="truncate font-mono">{event.eventId.slice(-8).toUpperCase()}</span><span className="shrink-0 font-medium">{event.status === "SYNCED" ? "Synchronisé" : event.status === "CONFLICT" ? "À contrôler" : event.status === "SYNCING" ? "Synchronisation" : event.status === "FAILED" ? "Nouvel essai programmé" : "En attente"}</span></div>)}
        </div> : null}
      </details>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-sm">
        <div className="grid shrink-0 gap-3 border-b border-border/75 bg-muted/[0.16] p-3 lg:grid-cols-[minmax(0,1fr)_7rem_auto_auto_auto_auto] lg:items-end">
          <form className="space-y-1" onSubmit={(event) => { event.preventDefault(); addQuickResult(); }}>
            <Label htmlFor="commerce-pos-quick-entry" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Saisie rapide · F2</Label>
            <div className="relative"><Search className="absolute left-3 top-3 size-5 text-primary" /><Input ref={quickEntryRef} id="commerce-pos-quick-entry" className="h-11 bg-surface pl-10 text-base" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Référence, SKU ou désignation" autoComplete="off" /></div>
          </form>
          <div className="space-y-1"><Label htmlFor="commerce-pos-quantity" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Quantité</Label><Input id="commerce-pos-quantity" className="h-11 bg-surface text-right tabular-nums" type="number" min="1" step="1" value={quickQuantity} onChange={(event) => setQuickQuantity(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addQuickResult(); } }} /></div>
          <Button type="button" className="h-11" disabled={checkoutState !== "READY"} onClick={addQuickResult}><Plus />Ajouter <span className="hidden 2xl:inline">· Entrée</span></Button>
          <Button type="button" variant="outline" className="h-11" onClick={openCatalogue}><Package />Articles</Button>
          <Button type="button" variant="outline" className="h-11" disabled={checkoutState !== "READY"} onClick={() => setServiceDialogOpen(true)}><Wrench />Service</Button>
          <Button type="button" variant="outline" className="h-11" onClick={() => setSuspendedTicketsOpen(true)}><ListTodo />Tickets ({posSession.suspendedTickets.length})</Button>
        </div>

        {posSession.isRestored ? <div className="shrink-0 border-b border-info/20 bg-info/[0.06] px-4 py-2 text-sm text-info">Brouillon restauré sur ce poste : aucune ligne n’a été perdue.</div> : null}
        {stockConflicts.length ? <div className="shrink-0 border-b border-warning/25 bg-warning/[0.08] px-4 py-2 text-sm text-warning">Stock modifié : {stockConflicts.map((conflict) => `${conflict.label} — ${conflict.availableQuantity} disponible${conflict.availableQuantity > 1 ? "s" : ""} au lieu de ${conflict.requestedQuantity}`).join(" · ")}. Ajustez le ticket avant l’encaissement.</div> : null}
        {checkoutState === "RECONCILIATION_REQUIRED" ? <div className="shrink-0 border-b border-warning/25 bg-warning/[0.08] px-4 py-2 text-sm text-warning">Encaissement à vérifier : le brouillon est protégé afin d’éviter un double encaissement.</div> : null}

        <div className="min-h-0 flex-1 overflow-auto">
          {workspaceQuery.isPending && !isUsingOfflineCatalogue ? <div className="space-y-2 p-3"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : null}
          {workspaceQuery.isError && !isUsingOfflineCatalogue ? <div className="p-6"><Card variant="information"><CardContent className="p-6">La caisse ne peut pas être ouverte pour ce point de vente. Réessayez dans un instant ou contactez un responsable.</CardContent></Card></div> : null}
          {isUsingOfflineCatalogue ? <div className="border-b border-warning/20 bg-warning/[0.06] px-4 py-2 text-sm text-warning">Catalogue et stock local affichés. Les ventes en espèces sont conservées localement ; aucun envoi financier n’est effectué dans cette version.</div> : null}
          {(!workspaceQuery.isPending || isUsingOfflineCatalogue) && (!workspaceQuery.isError || isUsingOfflineCatalogue) ? <>
            <table className="hidden w-full min-w-[760px] border-collapse text-sm lg:table">
              <thead className="sticky top-0 z-10 border-b border-border/80 bg-muted/[0.88] text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground backdrop-blur">
                <tr><th className="px-4 py-3">Référence</th><th className="px-4 py-3">Désignation</th><th className="px-4 py-3 text-right">Prix unitaire</th><th className="px-4 py-3 text-center">Quantité</th><th className="px-4 py-3 text-right">Montant</th><th className="w-16 px-4 py-3 text-right">Action</th></tr>
              </thead>
              <tbody>
                {enrichedCart.map((line) => {
                  const lineLabel = line.item?.name ?? line.label;
                  const isService = line.lineType === "SERVICE";
                  const availableQuantity = isService ? Number.POSITIVE_INFINITY : line.item?.quantity ?? 0;
                  const availabilityLabel = isService
                    ? "Prestation sans mouvement de stock"
                    : `${availableQuantity} ${line.item?.unit ?? "unité"}${availableQuantity > 1 ? "s" : ""} disponible${availableQuantity > 1 ? "s" : ""}`;

                  return <tr key={line.lineId} className="border-b border-border/60 transition-colors hover:bg-primary/[0.035]">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{isService ? "SERVICE" : line.item?.sku ?? "—"}</td>
                    <td className="max-w-80 px-4 py-3"><p className="truncate font-semibold">{lineLabel}</p><p className="mt-0.5 text-xs text-muted-foreground">{availabilityLabel}</p></td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{money(line.unitPrice)}</td>
                    <td className="px-4 py-3"><div className="mx-auto flex w-fit items-center rounded-lg border border-border bg-surface"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Diminuer la quantité de ${lineLabel}`} disabled={checkoutState !== "READY"} onClick={() => update(line.lineId, { quantity: line.quantity - 1 })}><Minus /></Button><span className="min-w-9 text-center text-sm font-bold tabular-nums">{line.quantity}</span><Button type="button" variant="ghost" size="icon-sm" aria-label={`Augmenter la quantité de ${lineLabel}`} disabled={checkoutState !== "READY" || (!isService && line.quantity >= availableQuantity)} onClick={() => isService ? update(line.lineId, { quantity: line.quantity + 1 }) : addArticle(line.itemId, line.item?.salePrice ?? line.unitPrice, lineLabel)}><Plus /></Button></div></td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums">{money(line.quantity * line.unitPrice)}</td>
                    <td className="px-4 py-3 text-right"><Button type="button" size="icon-sm" variant="ghost" aria-label={`Retirer ${lineLabel} du ticket`} title="Retirer du ticket" disabled={checkoutState !== "READY"} onClick={() => update(line.lineId, { quantity: 0 })}><Trash2 className="text-destructive" /></Button></td>
                  </tr>;
                })}
                {enrichedCart.length === 0 ? <tr><td colSpan={6} className="px-5 py-16 text-center"><ShoppingCart className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 font-semibold">Le ticket est prêt</p><p className="mt-1 text-sm text-muted-foreground">Saisissez une référence, utilisez Entrée ou ouvrez le catalogue Articles.</p></td></tr> : null}
              </tbody>
            </table>
            <div className="space-y-2 p-3 lg:hidden">
              {enrichedCart.map((line) => {
                const lineLabel = line.item?.name ?? line.label;
                const isService = line.lineType === "SERVICE";
                const availableQuantity = isService ? Number.POSITIVE_INFINITY : line.item?.quantity ?? 0;
                return <div key={line.lineId} className="rounded-xl border border-border/70 bg-muted/[0.12] p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{lineLabel}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{isService ? "Service sans stock" : line.item?.sku ?? "Sans référence"} · {money(line.unitPrice)}</p></div><p className="shrink-0 font-bold tabular-nums">{money(line.quantity * line.unitPrice)}</p></div><div className="mt-3 flex items-center justify-between gap-3"><div className="flex items-center rounded-lg border border-border bg-surface"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Diminuer la quantité de ${lineLabel}`} disabled={checkoutState !== "READY"} onClick={() => update(line.lineId, { quantity: line.quantity - 1 })}><Minus /></Button><span className="min-w-9 text-center text-sm font-bold tabular-nums">{line.quantity}</span><Button type="button" variant="ghost" size="icon-sm" aria-label={`Augmenter la quantité de ${lineLabel}`} disabled={checkoutState !== "READY" || (!isService && line.quantity >= availableQuantity)} onClick={() => isService ? update(line.lineId, { quantity: line.quantity + 1 }) : addArticle(line.itemId, line.item?.salePrice ?? line.unitPrice, lineLabel)}><Plus /></Button></div><Button type="button" size="sm" variant="ghost" disabled={checkoutState !== "READY"} onClick={() => update(line.lineId, { quantity: 0 })}><Trash2 className="text-destructive" />Retirer</Button></div></div>;
              })}
              {enrichedCart.length === 0 ? <div className="rounded-xl border border-dashed border-border/90 px-5 py-12 text-center"><ShoppingCart className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 font-semibold">Le ticket est prêt</p><p className="mt-1 text-sm text-muted-foreground">Ajoutez un article pour commencer.</p></div> : null}
            </div>
          </> : null}
        </div>
      </section>

      <Card variant="section" className="hidden shrink-0 overflow-hidden border-primary/20 bg-surface shadow-md lg:block">
        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(280px,.8fr)_minmax(390px,1.2fr)_auto] xl:items-end">
          <div className="min-w-0">{showClient ? <div className="flex items-center gap-2"><ClientSelect value={clientId} onValueChange={(value) => updateDraft((current) => ({ ...current, clientId: value || null }))} placeholder="Client facultatif" /><Button type="button" size="sm" variant="ghost" onClick={() => { updateDraft((current) => ({ ...current, clientId: null })); setShowClient(false); }}>Comptoir</Button></div> : <button type="button" onClick={() => setShowClient(true)} className="flex w-full items-center justify-between rounded-xl border border-dashed border-border/90 bg-surface/75 px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/35 hover:bg-primary/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><span><span className="font-semibold">Vente comptoir</span><span className="ml-2 text-xs text-muted-foreground">Client non requis</span></span><span className="text-xs font-semibold text-primary">F4 · + Client</span></button>}</div>
          <div className="grid gap-2 md:grid-cols-[auto_minmax(160px,1fr)_auto] md:items-end"><div className="space-y-1"><Label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Paiement</Label><div className="flex items-center gap-1" role="radiogroup" aria-label="Moyen de paiement">{paymentMethods.map(({ value, label, icon: Icon }) => { const selected = method === value; const jekoDisabled = value === "JEKO"; const offlineUnavailable = posSession.networkStatus !== "ONLINE" && value !== "CASH"; return <button key={value} type="button" role="radio" aria-checked={selected} onClick={() => setPaymentMethod(value)} disabled={checkoutState !== "READY" || jekoDisabled || offlineUnavailable} title={jekoDisabled ? "Jèko sera disponible lorsque l’encaissement transactionnel POS sera relié." : offlineUnavailable ? "Paiement indisponible hors connexion." : value === "WAVE" ? "Saisie mobile manuelle : aucune API Wave directe" : label} className={`flex h-10 min-w-10 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-semibold transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 ${selected ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-surface text-muted-foreground hover:border-primary/35 hover:text-foreground"}`}><Icon className="size-4" /><span className="hidden 2xl:inline">{jekoDisabled ? "Jèko bientôt" : value === "WAVE" ? "Mobile" : label}</span></button>; })}</div></div>{method === "CASH" ? <div className="space-y-1"><Label htmlFor="commerce-pos-cash-received" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Montant reçu</Label><Input id="commerce-pos-cash-received" className="h-10 text-right tabular-nums" type="number" min={total} step="1" disabled={checkoutState !== "READY"} placeholder={money(total)} value={cashReceived ?? ""} onChange={(event) => updateDraft((current) => ({ ...current, cashReceived: event.target.value === "" ? null : Number(event.target.value) }))} /></div> : <div className="text-sm text-muted-foreground">Règlement manuel sélectionné.</div>}<div className="rounded-xl border border-success/20 bg-success/[0.07] px-3 py-2 text-sm"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-success">{posSession.networkStatus === "ONLINE" ? "Wallet automatique" : "Aucune écriture financière hors ligne"}</p><p className="mt-1 truncate font-semibold text-success" title={primaryCashDrawerWallet?.name}>{primaryCashDrawerWallet?.name ?? "Vente locale en attente"}</p></div></div>
          <div className="flex items-end justify-between gap-4 xl:justify-end"><div className="text-right"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{method === "CASH" && cashReceived !== null ? "Monnaie à rendre" : "Total à encaisser"}</p><p className="mt-1 text-xl font-bold tabular-nums">{method === "CASH" && cashReceived !== null ? money(cashChange) : money(total)}</p></div><Button className="h-12 min-w-56" loading={saleMutation.isPending} loadingLabel="Comptabilisation" disabled={!canCheckout} onClick={checkout}><WalletCards />{saleMutation.isPending || checkoutState === "PROCESSING" ? "Comptabilisation…" : posSession.networkStatus !== "ONLINE" ? `Conserver ${money(total)}` : `Encaisser ${money(total)}`}<span className="ml-1 hidden 2xl:inline">· F10</span></Button></div>
        </div>
        {hasDraftInProgress ? <div className="flex border-t border-border/70 px-3 py-2 text-right"><div className="ml-auto flex gap-2"><Button type="button" size="sm" variant="outline" disabled={checkoutState !== "READY" || cart.length === 0} onClick={() => { if (posSession.suspendDraft()) { setShowClient(false); toast.success("Ticket suspendu : aucune opération n’a été comptabilisée."); } }}>Suspendre</Button><Button type="button" size="sm" variant="ghost" disabled={checkoutState !== "READY"} onClick={() => setPendingDraftAction({ type: "DISCARD" })}>Abandonner le brouillon</Button></div></div> : null}
      </Card>

      <Dialog open={catalogueOpen} onOpenChange={setCatalogueOpen}>
        <DialogContent className="max-w-5xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border/70 px-5 py-4 text-left"><DialogTitle>Articles disponibles · {currentLocationName}</DialogTitle><DialogDescription>Flèches pour choisir, Entrée pour ajouter, Échap pour fermer. Les prix d’achat et les codes-barres ne sont pas disponibles dans cette caisse.</DialogDescription></DialogHeader>
          <div className="border-b border-border/70 bg-muted/[0.16] p-4"><div className="relative"><Search className="absolute left-3 top-3 size-5 text-primary" /><Input autoFocus className="h-11 pl-10" value={catalogueSearch} onChange={(event) => { setCatalogueSearch(event.target.value); setCatalogueSelectedIndex(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setCatalogueSelectedIndex((current) => Math.min(current + 1, Math.max(catalogueItems.length - 1, 0))); } if (event.key === "ArrowUp") { event.preventDefault(); setCatalogueSelectedIndex((current) => Math.max(current - 1, 0)); } if (event.key === "Enter") { event.preventDefault(); addFromCatalogue(catalogueSelectedIndex); } }} placeholder="Rechercher une référence, un SKU ou une désignation" /></div></div>
          <div className="max-h-[60dvh] overflow-auto"><table className="w-full min-w-[620px] border-collapse text-sm"><thead className="sticky top-0 z-10 bg-surface text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><tr><th className="px-5 py-3">Référence</th><th className="px-5 py-3">Désignation</th><th className="px-5 py-3 text-right">Prix de vente</th><th className="px-5 py-3 text-right">Stock</th><th className="w-24 px-5 py-3" /></tr></thead><tbody>{catalogueItems.map((item, index) => { const unavailable = item.quantity <= 0; return <tr key={item.id} onMouseEnter={() => setCatalogueSelectedIndex(index)} onDoubleClick={() => addFromCatalogue(index)} className={`border-t border-border/60 ${catalogueSelectedIndex === index ? "bg-primary/[0.08]" : "hover:bg-muted/[0.24]"} ${unavailable ? "opacity-55" : "cursor-pointer"}`}><td className="px-5 py-3 font-mono text-xs text-muted-foreground">{item.sku ?? "—"}</td><td className="px-5 py-3 font-semibold">{item.name}</td><td className="px-5 py-3 text-right font-medium tabular-nums">{item.salePrice === null ? "Prix à saisir" : money(item.salePrice)}</td><td className="px-5 py-3 text-right tabular-nums">{item.quantity} {item.unit ?? "unité"}{item.quantity > 1 ? "s" : ""}</td><td className="px-5 py-3 text-right"><Button type="button" size="sm" variant="outline" disabled={unavailable || checkoutState !== "READY"} onClick={() => addFromCatalogue(index)}>{unavailable ? "Rupture" : "Ajouter"}</Button></td></tr>; })}{catalogueItems.length === 0 ? <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">Aucun article ne correspond à cette recherche.</td></tr> : null}</tbody></table></div>
          <DialogFooter className="border-t border-border/70 bg-muted/[0.10] px-5 py-3"><p className="mr-auto text-xs text-muted-foreground">{catalogueItems.length} article{catalogueItems.length > 1 ? "s" : ""} chargé{catalogueItems.length > 1 ? "s" : ""} pour ce magasin.</p><Button type="button" variant="outline" onClick={() => setCatalogueOpen(false)}>Fermer</Button></DialogFooter>
        </DialogContent>
      </Dialog>

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

      <div className="sticky bottom-3 z-20 lg:hidden">
        <Drawer open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
          <DrawerTrigger asChild>
            <Button type="button" className="h-14 w-full justify-between rounded-2xl px-4 text-left shadow-lg">
              <span className="flex min-w-0 items-center gap-3"><ShoppingCart className="size-5 shrink-0" /><span className="min-w-0"><span className="block text-xs font-medium text-primary-foreground/75">Panier de caisse · {cart.length} article{cart.length > 1 ? "s" : ""}</span><span className="block truncate text-base font-semibold">{clientId ? "Ticket nominatif" : "Vente comptoir"}</span></span></span>
              <span className="shrink-0 text-lg font-bold tabular-nums">{money(total)}</span>
            </Button>
          </DrawerTrigger>
          <DrawerContent className="max-h-[92dvh]">
            <DrawerHeader className="flex-row items-start justify-between gap-4 text-left">
              <div><DrawerTitle className="flex items-center gap-2"><ShoppingCart className="size-5 text-primary" /> Panier de caisse</DrawerTitle><DrawerDescription className="mt-1">Le panier reste identique lorsque l’affichage change.</DrawerDescription></div>
              <DrawerClose asChild><Button type="button" variant="ghost" size="sm">Fermer</Button></DrawerClose>
            </DrawerHeader>
            {posSession.isRestored ? <div className="border-y border-info/20 bg-info/[0.06] px-4 py-2 text-sm text-info">Une vente non terminée a été restaurée sur ce poste.</div> : null}
            {stockConflicts.length ? <div className="border-y border-warning/25 bg-warning/[0.08] px-4 py-2 text-sm text-warning">Stock modifié : ajustez le panier avant d’encaisser.</div> : null}
            {checkoutState === "RECONCILIATION_REQUIRED" ? <div className="border-y border-warning/25 bg-warning/[0.08] px-4 py-2 text-sm text-warning">Encaissement à vérifier avant toute nouvelle tentative.</div> : null}
            <div className="min-h-0 space-y-4 overflow-y-auto px-4 pb-4">
              {showClient ? <div className="flex items-center gap-2"><ClientSelect value={clientId} onValueChange={(value) => updateDraft((current) => ({ ...current, clientId: value || null }))} placeholder="Client facultatif" /><Button type="button" size="sm" variant="ghost" onClick={() => { updateDraft((current) => ({ ...current, clientId: null })); setShowClient(false); }}>Comptoir</Button></div> : <button type="button" onClick={() => setShowClient(true)} className="flex w-full items-center justify-between rounded-xl border border-dashed border-border/90 bg-surface/75 px-3 py-3 text-left text-sm transition-colors hover:border-primary/35 hover:bg-primary/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><span><span className="font-semibold">Vente comptoir</span><span className="ml-2 text-xs text-muted-foreground">Client non requis</span></span><span className="text-xs font-semibold text-primary">+ Client</span></button>}
              <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Moyen de paiement">
                {paymentMethods.map(({ value, label, icon: Icon }) => { const selected = method === value; const jekoDisabled = value === "JEKO"; const offlineUnavailable = posSession.networkStatus !== "ONLINE" && value !== "CASH"; return <button key={value} type="button" role="radio" aria-checked={selected} onClick={() => setPaymentMethod(value)} disabled={checkoutState !== "READY" || jekoDisabled || offlineUnavailable} title={jekoDisabled ? "Jèko sera disponible lorsque l’encaissement transactionnel POS sera relié." : offlineUnavailable ? "Paiement indisponible hors connexion." : value === "WAVE" ? "Saisie mobile manuelle : aucune API Wave directe" : label} className={`flex h-12 min-w-24 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 ${selected ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-surface text-muted-foreground hover:border-primary/35 hover:text-foreground"}`}><Icon className="size-4" /><span>{jekoDisabled ? "Jèko bientôt" : value === "WAVE" ? "Mobile" : label}</span></button>; })}
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-success/20 bg-success/[0.07] px-3 py-2"><WalletCards className="size-4 shrink-0 text-success" /><span className="min-w-0 truncate text-sm font-semibold text-success" title={primaryCashDrawerWallet?.name}>{primaryCashDrawerWallet?.name ?? "Wallet de caisse à configurer"}</span></div>
              <div className="space-y-2">
                {enrichedCart.map((line) => {
                  const lineLabel = line.item?.name ?? line.label;
                  const isService = line.lineType === "SERVICE";
                  const availableQuantity = isService ? Number.POSITIVE_INFINITY : line.item?.quantity ?? 0;
                  return <div key={line.lineId} className="rounded-xl border border-border/70 bg-muted/[0.18] p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{lineLabel}</p><p className="mt-1 text-xs text-muted-foreground">{isService ? "Service sans stock" : line.item?.sku ?? "Sans référence"}</p></div><p className="shrink-0 font-bold tabular-nums">{money(line.quantity * line.unitPrice)}</p></div><div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-2"><div className="flex items-center rounded-lg border border-border bg-surface"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Diminuer la quantité de ${lineLabel}`} disabled={checkoutState !== "READY"} onClick={() => update(line.lineId, { quantity: line.quantity - 1 })}><Minus /></Button><span className="min-w-9 text-center text-sm font-bold tabular-nums">{line.quantity}</span><Button type="button" variant="ghost" size="icon-sm" aria-label={`Augmenter la quantité de ${lineLabel}`} disabled={checkoutState !== "READY" || (!isService && line.quantity >= availableQuantity)} onClick={() => isService ? update(line.lineId, { quantity: line.quantity + 1 }) : addArticle(line.itemId, line.item?.salePrice ?? line.unitPrice, lineLabel)}><Plus /></Button></div><Input aria-label={`Prix unitaire de ${lineLabel}`} className="h-8 min-w-0 text-right text-sm" type="number" min="0" step="1" disabled={checkoutState !== "READY"} value={line.unitPrice} onChange={(event) => update(line.lineId, { unitPrice: Number(event.target.value) })} /><Button type="button" size="icon-sm" variant="ghost" aria-label={`Retirer ${lineLabel}`} disabled={checkoutState !== "READY"} onClick={() => update(line.lineId, { quantity: 0 })}><Trash2 className="text-destructive" /></Button></div></div>;
                })}
                {enrichedCart.length === 0 ? <div className="rounded-xl border border-dashed border-border/90 bg-muted/[0.12] px-5 py-8 text-center"><ShoppingCart className="mx-auto size-5 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">Votre panier est vide</p><p className="mt-1 text-xs text-muted-foreground">Sélectionnez un article dans le rayon.</p></div> : null}
              </div>
            </div>
            <DrawerFooter className="border-t border-border/70 bg-surface">
              <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Total à encaisser</p><p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{money(total)}</p></div>{method === "CASH" ? <div className="w-44 space-y-1"><Label className="text-xs">Montant reçu</Label><Input aria-label="Montant reçu en espèces" className="h-9 text-right" type="number" min={total} step="1" disabled={checkoutState !== "READY"} placeholder={money(total)} value={cashReceived ?? ""} onChange={(event) => updateDraft((current) => ({ ...current, cashReceived: event.target.value === "" ? null : Number(event.target.value) }))} />{cashReceived !== null ? <p className="text-xs text-muted-foreground">À rendre : <span className="font-semibold text-foreground">{money(cashChange)}</span></p> : null}</div> : null}</div>
              <Button className="h-12 w-full" loading={saleMutation.isPending} loadingLabel="Comptabilisation" disabled={!canCheckout} onClick={checkout}><WalletCards />{saleMutation.isPending || checkoutState === "PROCESSING" ? "Comptabilisation…" : posSession.networkStatus !== "ONLINE" ? `Conserver ${money(total)}` : `Encaisser ${money(total)}`}</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </div>

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
