import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  CircleDollarSign,
  CloudOff,
  CloudUpload,
  CreditCard,
  DoorOpen,
  ListTodo,
  LogOut,
  MoreHorizontal,
  Minus,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  ShoppingCart,
  Smartphone,
  Store,
  Trash2,
  UserPlus,
  UserRoundX,
  WalletCards,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  CommerceItemImageField,
  CommerceItemThumb,
  uploadCommerceItemImage,
} from "@/components/commerce/commerce-item-image";
import { PosCashSessionClose } from "@/components/commerce/pos-cash-session-close";
import { StoreManagementCockpit } from "@/components/commerce/store-management-cockpit";
import {
  ClientSelect,
  InventoryLocationItemSelect,
  WalletSelect,
} from "@/components/selects/entity-selects";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  assignCommerceLocationUser,
  configureCommerceLocationItem,
  createCommerceCashRegister,
  createCommerceCashSale,
  endCommerceLocationAssignment,
  getCommerceCashRegisters,
  getCommerceInventoryCatalogue,
  getCommerceLocationAssignments,
  getCommerceManagementDashboard,
  getCommercePosCashSessionPreview,
  getCommercePosLocations,
  getCommercePosWorkspace,
  getCommerceSetupOptions,
  receiveCommerceInventoryItem,
  setupCommerceLocation,
  updateCommerceCashRegister,
  updateCommerceLocation,
  writeOffCommerceInventoryItem,
  type CommercePosLocation,
} from "@/lib/commerce-pos.functions";
import { markVoluntarySignOut } from "@/lib/auth-session-resync";
import { getWallets } from "@/lib/wallet.functions";
import {
  useCommercePosRegisterSelection,
  type CommercePosRegister,
} from "@/hooks/use-commerce-pos-register";
import { useCommercePosSession } from "@/hooks/use-commerce-pos-session";
import { useConfirm } from "@/hooks/use-confirm";
import { useCurrentUserAccess } from "@/hooks/use-current-user-access";
import { usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/integrations/supabase/client";
import {
  cachePosOfflineLocations,
  findPosOfflineDraftLocation,
  getCachedPosOfflineLocations,
  mergeCommercePosCashSessionSummaries,
  mergeCommercePosSessionSaleRows,
  type CommercePosSessionSaleRow,
} from "@/lib/commerce-pos-offline";
import {
  createCommercePosId,
  findCommercePosDraftLocation,
  getCommercePosStockConflicts,
  resolveCommercePosLocationId,
  type CommercePosDraftLine,
  type CommercePosPaymentMethod,
  type CommercePosSuspendedTicket,
} from "@/lib/commerce-pos-session";
import { cn } from "@/lib/utils";
import { notifyMutationError } from "@/lib/notify-mutation-error";

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

// Caisse (vente) et Magasins (administration) sont deux routes distinctes
// (/caisse et /commerce), jamais un seul écran qui bascule de mode -- ce
// composant est monté directement par la route /commerce, qui ne concerne
// plus que l'administration d'un magasin. La navigation vers la caisse
// elle-même est une vraie navigation de route (onOpenCashier), pas un
// paramètre d'URL local -- mais CHANTIER CAISSE : elle transporte
// désormais explicitement le magasin actuellement sélectionné ici, en
// paramètre de recherche de /caisse (jamais une inférence côté caisse).
export function CommerceManagementWorkspace({
  onOpenCashier,
  requestedLocationId,
  onLocationResolved,
}: {
  onOpenCashier: (locationId: string) => void;
  /** AUDIT TOTAL (symptôme 1) : magasin explicitement demandé -- l'URL
   * après un refresh, prioritaire sur tout repli. Voir
   * resolveCommercePosLocationId. */
  requestedLocationId?: string;
  /** Reflète le magasin réellement résolu vers l'appelant, pour qu'il soit
   * fixé dans l'URL -- un refresh relit alors ce même magasin au lieu de
   * retomber sur locations[0]. */
  onLocationResolved?: (locationId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canManageStock = can("commerce.stock.receive");
  const canReceiveCommerceInventory = canManageStock && can("stocks.manage");
  const canManageLocations =
    can("locations.manage") && can("locations.wallets.manage") && can("locations.assign");
  const locationsQuery = useQuery({
    queryKey: ["commerce-pos-locations"],
    queryFn: () => getCommercePosLocations(),
  });
  const [locationId, setLocationId] = useState("");
  const availableLocationIds = useMemo(
    () => (locationsQuery.data ?? []).map((location) => location.id),
    [locationsQuery.data],
  );
  // AUDIT TOTAL (symptôme 1) : plus de repli silencieux sur
  // locationsQuery.data[0] -- cause exacte du bug "MAGASIN MARIAM revient
  // sur ACCESSOIRES ET DIVERS au refresh" : locationId (useState local)
  // repart de "" à chaque remount, et get_commerce_pos_locations trie par
  // nom, donc "ACCESSOIRES ET DIVERS" gagnait systématiquement le repli.
  // Aucun brouillon hors ligne côté administration (draftLocationId
  // toujours null ici, à la différence de /caisse) -- même fonction
  // partagée, un seul point de décision.
  const selectedLocationId =
    locationId ||
    resolveCommercePosLocationId({
      requestedLocationId: requestedLocationId ?? null,
      availableLocationIds,
      draftLocationId: null,
    }) ||
    "";
  useEffect(() => {
    if (selectedLocationId) onLocationResolved?.(selectedLocationId);
  }, [selectedLocationId, onLocationResolved]);
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
      queryClient.invalidateQueries({
        queryKey: ["commerce-management-dashboard", selectedLocationId],
      }),
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", selectedLocationId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-locations"] }),
    ]);
  };
  const handleLocationSaved = async (savedLocationId: string) => {
    setLocationId(savedLocationId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-locations"] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-store-cockpit", savedLocationId] }),
      queryClient.invalidateQueries({
        queryKey: ["commerce-management-dashboard", savedLocationId],
      }),
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", savedLocationId] }),
    ]);
  };

  if (locationsQuery.isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-4">
        <Skeleton className="h-56 lg:col-span-4" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    );
  }
  if (locationsQuery.isError) {
    return (
      <Card variant="information">
        <CardContent className="p-6">
          Impossible de charger les magasins auxquels vous avez accès.
        </CardContent>
      </Card>
    );
  }
  if (!locationsQuery.data?.length) {
    return canManageLocations ? (
      <CommerceLocationSetup onDone={handleLocationSaved} />
    ) : (
      <Card variant="information">
        <CardHeader>
          <CardTitle>Aucun magasin accessible</CardTitle>
        </CardHeader>
        <CardContent>
          Un administrateur doit vous affecter à un magasin Commerce avant de pouvoir en consulter
          le pilotage.
        </CardContent>
      </Card>
    );
  }

  // AUDIT TOTAL (symptôme 1) : 2+ magasins accessibles, aucun contexte --
  // jamais un choix silencieux du premier, même règle qu'en caisse.
  if (!selectedLocationId && managementLocations.length > 1) {
    return (
      <CommerceLocationChoiceScreen locations={managementLocations} onSelect={setLocationId} />
    );
  }

  return (
    <StoreManagementCockpit
      locations={managementLocations}
      locationId={selectedLocationId}
      onLocationChange={setLocationId}
      onOpenCashier={onOpenCashier}
      actions={
        <>
          {canManageLocations ? (
            <>
              <CommerceLocationDialog mode="create" onDone={handleLocationSaved} />
              <CommerceLocationDialog
                mode="edit"
                location={dashboard?.location}
                primaryWalletId={dashboard?.cashDrawer?.id ?? ""}
                onDone={handleLocationSaved}
              />
            </>
          ) : null}
          {canReceiveCommerceInventory ? (
            <CommerceQuickInventoryReceipt
              locationId={selectedLocationId}
              locationName={
                dashboard?.location.name ??
                managementLocations.find((location) => location.id === selectedLocationId)?.name ??
                "ce magasin"
              }
              onSaved={refreshDashboard}
            />
          ) : null}
          {canManageStock ? (
            <CommerceQuickInventoryWriteOff
              locationId={selectedLocationId}
              locationName={
                dashboard?.location.name ??
                managementLocations.find((location) => location.id === selectedLocationId)?.name ??
                "ce magasin"
              }
              onSaved={refreshDashboard}
            />
          ) : null}
          {canManageStock ? (
            <CommerceInventorySetup locationId={selectedLocationId} onSaved={refreshDashboard} />
          ) : null}
        </>
      }
    />
  );
}

// AUDIT TOTAL : un seul écran de choix de magasin, partagé par /commerce et
// /caisse -- avant ce correctif, seul /caisse en avait un (CHANTIER
// CAISSE) ; /commerce retombait silencieusement sur locations[0]. Même
// rendu strictement -- aucun changement visuel, un seul composant en
// commun au lieu de deux implémentations qui auraient pu diverger.
function CommerceLocationChoiceScreen({
  locations,
  onSelect,
}: {
  locations: CommercePosLocation[];
  onSelect: (locationId: string) => void;
}) {
  return (
    <Card variant="information">
      <CardHeader>
        <CardTitle>Choisissez votre magasin</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((location) => (
            <button
              key={location.id}
              type="button"
              onClick={() => onSelect(location.id)}
              className="flex flex-col items-start gap-1 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Store className="size-5 text-primary" />
              <span className="font-semibold">{location.name}</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type CashierDraftAction =
  | { type: "DISCARD" }
  | { type: "CHANGE_LOCATION"; locationId: string }
  | { type: "RETURN_TO_MANAGEMENT" }
  | { type: "CHANGE_REGISTER" };

function useCommerceCashierUserId() {
  const [userId, setUserId] = useState("");

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setUserId(data.user?.id ?? "");
    });
    return () => {
      active = false;
    };
  }, []);

  return userId;
}

function isIndeterminateCheckoutError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.toLowerCase().includes("fetch")) return true;
  if (!(error instanceof Error)) return false;
  return /network|timeout|timed out|failed to fetch|load failed/i.test(error.message);
}

// Une tuile par poste, avec son état réel -- disponible / occupé par X
// depuis HH:MM / inactif. Un poste occupé ou inactif est visible (pour
// qu'un admin/gestionnaire voie l'ensemble du magasin) mais jamais
// cliquable : un poste occupé ne doit jamais pouvoir être ouvert, mais ne
// bloque jamais l'accès aux autres. Partagée entre l'écran de choix
// initial et "Choisir une autre caisse" depuis l'écran "poste occupé" --
// un seul rendu, jamais deux écrans qui pourraient diverger.
function RegisterTile({
  register,
  onSelect,
}: {
  register: CommercePosRegister;
  onSelect: (registerId: string) => void;
}) {
  // RÈGLE FINALE (reprise de session) : occupé par moi-même n'est jamais un
  // blocage -- seul un poste occupé par quelqu'un d'AUTRE reste désactivé.
  const isMine = register.occupiedBy?.isMine ?? false;
  const isSelectable = register.isActive && (!register.occupiedBy || isMine);
  const statusLabel = !register.isActive
    ? "Inactif"
    : !register.occupiedBy
      ? "Disponible"
      : isMine
        ? "Reprendre ma session"
        : `Occupé par ${register.occupiedBy.cashier} depuis ${new Date(register.occupiedBy.since).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  const statusTone = !register.isActive
    ? "bg-muted text-muted-foreground"
    : !register.occupiedBy
      ? "bg-success/15 text-success-foreground"
      : isMine
        ? "bg-primary/15 text-primary"
        : "bg-warning/15 text-warning-foreground";
  return (
    <button
      type="button"
      disabled={!isSelectable}
      onClick={() => onSelect(register.id)}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-xl border border-border bg-card p-4 text-left transition-colors",
        isSelectable
          ? "hover:border-primary hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "cursor-not-allowed opacity-60",
      )}
    >
      <Store className="size-5 text-primary" />
      <span className="font-semibold">{register.name}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusTone}`}>
        {statusLabel}
      </span>
    </button>
  );
}

// UX CAISSE : une carte article n'a qu'un travail -- se faire lire et se
// faire toucher vite. Pas d'icône générique identique sur 40 cartes (elle
// n'apportait aucune information) : le nom prend sa place, le prix domine
// visuellement (priorité 2 après le total), le stock reste lisible mais
// secondaire. L'état (rupture / prix à définir) se lit par une teinte de
// fond très légère + le mot lui-même -- jamais la couleur seule.
type CashierCatalogueItem = {
  id: string;
  name: string;
  unit: string | null;
  category: string | null;
  quantity: number;
  salePrice: number | null;
  // Optionnel ET nullable : le cache hors-ligne (IndexedDB) peut contenir
  // des enregistrements créés avant cette fonctionnalité, où le champ est
  // simplement absent -- jamais une erreur de type, jamais un blocage
  // d'affichage (voir CommerceItemThumb, qui traite les deux cas pareil).
  imagePath?: string | null;
};

function ProductCard({
  item,
  disabled,
  onSelect,
}: {
  item: CashierCatalogueItem;
  disabled: boolean;
  onSelect: () => void;
}) {
  const outOfStock = item.quantity <= 0;
  // Deux états distincts, jamais confondus : un stock positif sans prix de
  // vente défini n'est jamais une rupture -- l'article reste visible avec
  // sa vraie quantité, seul le bouton de vente est désactivé tant que le
  // prix n'est pas défini (voir addArticle).
  const needsPrice = !outOfStock && item.salePrice === null;
  return (
    <button
      type="button"
      disabled={outOfStock || needsPrice || disabled}
      title={
        needsPrice
          ? "Prix de vente à définir pour ce magasin avant de pouvoir le vendre."
          : undefined
      }
      onClick={onSelect}
      className={cn(
        "flex min-h-[104px] flex-col justify-between gap-2.5 rounded-2xl border p-3.5 text-left shadow-sm transition-all duration-150",
        "hover:-translate-y-0.5 hover:shadow-md focus-visible:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-60",
        outOfStock
          ? "border-destructive/20 bg-destructive/[0.025]"
          : needsPrice
            ? "border-warning/25 bg-warning/[0.025]"
            : "border-border bg-surface hover:border-primary/40",
      )}
    >
      <div className="flex items-start gap-2">
        <CommerceItemThumb
          imagePath={item.imagePath}
          alt=""
          className="size-9 rounded-lg border border-border/60"
        />
        <p className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground">
          {item.name}
        </p>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span
          className={cn(
            "text-lg font-bold tabular-nums",
            needsPrice && "text-sm font-semibold text-warning",
          )}
        >
          {item.salePrice !== null ? money(item.salePrice) : needsPrice ? "Prix à définir" : "—"}
        </span>
        <span
          className={cn(
            "shrink-0 text-xs font-medium",
            outOfStock ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {outOfStock ? "Rupture" : `${item.quantity} ${item.unit ?? ""}`.trim()}
        </span>
      </div>
    </button>
  );
}

// REFONTE CAISSE : la liste doit dominer visuellement le panneau (priorité
// absolue de la demande) -- une carte par ligne (bordure + padding 3.5 +
// coins arrondis) coûtait trop de hauteur pour tenir 15-20 lignes sans
// scroll. Une vraie ligne de tableau dense, alignée sur CART_COLUMNS
// (même gabarit que l'en-tête juste au-dessus de la liste), fait le même
// travail en une fraction de la hauteur -- rien n'est retiré : prix
// modifiable en place, +/-, sous-total, retirer, tout reste au même
// endroit fonctionnel.
const CART_GRID_COLUMNS = "grid-cols-[1.5rem_1.75rem_minmax(0,1fr)_4.5rem_4.75rem_4.75rem_1.75rem]";

function CartLineRow({
  index,
  line,
  imagePath,
  disabled,
  isEditingPrice,
  priceDraft,
  priceError,
  surcharge,
  canIncrease,
  onStartEditPrice,
  onPriceDraftChange,
  onCommitPrice,
  onCancelPrice,
  onDecrease,
  onIncrease,
  onRemove,
}: {
  index: number;
  line: CartLine;
  imagePath: string | null;
  disabled: boolean;
  isEditingPrice: boolean;
  priceDraft: string;
  priceError: string | null;
  surcharge: number;
  canIncrease: boolean;
  onStartEditPrice: () => void;
  onPriceDraftChange: (value: string) => void;
  onCommitPrice: () => void;
  onCancelPrice: () => void;
  onDecrease: () => void;
  onIncrease: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "grid items-center gap-x-1.5 border-b border-border/50 py-1 pr-0.5",
        CART_GRID_COLUMNS,
      )}
    >
      <span className="text-xs tabular-nums text-muted-foreground">{index}</span>
      <CommerceItemThumb imagePath={imagePath} alt="" className="size-6 rounded-md" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium leading-tight" title={line.label}>
          {line.label}
        </p>
        {isEditingPrice && priceError ? (
          <p className="text-xs leading-tight text-destructive">{priceError}</p>
        ) : null}
      </div>
      {isEditingPrice ? (
        <div className="col-span-2 flex items-center gap-0.5 justify-self-end">
          <Input
            autoFocus
            type="number"
            min="0"
            step="1"
            className="h-7 w-20 px-1.5 text-xs"
            value={priceDraft}
            onChange={(event) => onPriceDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCommitPrice();
              if (event.key === "Escape") onCancelPrice();
            }}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Valider le prix"
            onClick={onCommitPrice}
          >
            <Check className="size-3" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Annuler"
            onClick={onCancelPrice}
          >
            <X className="size-3" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={onStartEditPrice}
          title="Modifier le prix"
          className="truncate text-right text-xs font-semibold tabular-nums text-foreground underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
        >
          {money(line.unitPrice)}
          {surcharge > 0 ? <span className="ml-1 text-success">+{money(surcharge)}</span> : null}
        </button>
      )}
      {isEditingPrice ? null : (
        <div className="flex items-center justify-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Diminuer la quantité de ${line.label}`}
            disabled={disabled}
            onClick={onDecrease}
          >
            <Minus className="size-3" />
          </Button>
          <span className="min-w-4 text-center text-xs font-semibold tabular-nums">
            {line.quantity}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Augmenter la quantité de ${line.label}`}
            disabled={disabled || !canIncrease}
            onClick={onIncrease}
          >
            <Plus className="size-3" />
          </Button>
        </div>
      )}
      {isEditingPrice ? null : (
        <p className="truncate text-right text-sm font-bold tabular-nums">
          {money(line.quantity * line.unitPrice)}
        </p>
      )}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`Retirer ${line.label} du ticket`}
        disabled={disabled}
        onClick={onRemove}
        className="justify-self-end"
      >
        <Trash2 className="size-3.5 text-destructive" />
      </Button>
    </div>
  );
}

export function CommerceCashierWorkspace({
  onBackToManagement,
  requestedLocationId,
  onLocationResolved,
}: {
  onBackToManagement?: () => void;
  /** Magasin explicitement demandé (ex. "Ouvrir la caisse" depuis /commerce
   * pour un magasin précis, ou l'URL après un refresh) -- prioritaire sur
   * toute inférence locale (brouillon existant, premier magasin de la
   * liste). Voir la CHANTIER CAISSE : plus jamais un magasin choisi
   * silencieusement remplacé par un autre. */
  requestedLocationId?: string;
  /** Reflète le magasin réellement résolu (quelle qu'en soit la source)
   * vers l'appelant, pour qu'il puisse le fixer dans l'URL -- un refresh
   * relit alors ce même magasin au lieu de redéclencher une inférence. */
  onLocationResolved?: (locationId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canManageStock = can("commerce.stock.receive");
  const canManageLocations =
    can("locations.manage") && can("locations.wallets.manage") && can("locations.assign");
  const canSeeTodayRevenue = can("store.financial.read");
  const [cashierTab, setCashierTab] = useState<"CAISSE" | "VENTES" | "SESSION">("CAISSE");
  const navigate = useNavigate();
  const locationsQuery = useQuery({
    queryKey: ["commerce-pos-locations"],
    queryFn: () => getCommercePosLocations(),
  });
  const currentUserQuery = useCurrentUserAccess();
  const currentUserId = useCommerceCashierUserId();
  // A cashier-only account has no ERP product header, so this workspace's own
  // app bar is the only place sign-out can live. A manager who opens this
  // same workspace from the management cockpit still has the product header,
  // so the extra control would just be redundant clutter for them.
  const isCashierOnlyShell = currentUserQuery.isCashierOnly;
  const signOut = useCallback(async () => {
    markVoluntarySignOut();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }, [navigate]);
  const cashierName =
    currentUserQuery.data?.fullName?.trim() ||
    currentUserQuery.data?.username ||
    (currentUserQuery.isLoading ? "Chargement…" : "Caissier non identifié");
  const [locationId, setLocationId] = useState("");
  const [cachedLocations, setCachedLocations] = useState<CommercePosLocation[]>([]);
  // isSuccess (not just data.length) is the load-bearing check here: a
  // pending or errored query legitimately falls back to the last-known
  // cache (offline resilience), but a *successful* response of zero
  // locations is an authoritative answer -- e.g. this cashier's location
  // was deleted -- and must not be masked by a stale cached ghost.
  const availableLocations = locationsQuery.data?.length
    ? locationsQuery.data
    : locationsQuery.isSuccess
      ? []
      : cachedLocations;
  // CHANTIER CAISSE : plus de repli silencieux sur availableLocations[0]
  // quand plusieurs magasins sont accessibles -- un seul magasin candidat
  // reste résolu automatiquement (aucune ambiguïté à lever), 2+ exige une
  // résolution explicite (requestedLocationId, brouillon existant, ou
  // l'écran de choix plus bas). Voir l'effet de restauration ci-dessous.
  const selectedLocationId =
    locationId || (availableLocations.length === 1 ? availableLocations[0].id : "");
  const workspaceQuery = useQuery({
    queryKey: ["commerce-pos-workspace", selectedLocationId],
    queryFn: () => getCommercePosWorkspace({ data: { locationId: selectedLocationId } }),
    enabled: Boolean(selectedLocationId),
  });
  const workspace = workspaceQuery.data;
  // CHANTIER CAISSE : le poste de caisse est résolu AVANT toute session --
  // useCommercePosSession ne reçoit locationId/userId réels qu'une fois le
  // poste connu (READY). Tant que ce n'est pas le cas, il reçoit des
  // chaînes vides : createScope() y renvoie null et le hook reste
  // totalement inerte (aucun accès IndexedDB), exactement son comportement
  // actuel quand l'emplacement/l'utilisateur ne sont pas encore connus --
  // aucun flash de session mal partitionnée.
  const registerSelection = useCommercePosRegisterSelection(selectedLocationId, currentUserId);
  const isRegisterReady = registerSelection.status === "READY";
  const posSession = useCommercePosSession({
    locationId: isRegisterReady ? selectedLocationId : "",
    userId: isRegisterReady ? currentUserId : "",
    registerId: isRegisterReady ? registerSelection.registerId : null,
    catalogue: workspace?.items,
    catalogueRevision: workspaceQuery.dataUpdatedAt,
  });
  // Server-authoritative half of the pre-closure summary: every confirmed
  // sale already in commercial_sales, online or offline-then-synced. The
  // local half (posSession.cashSessionSummary) now only ever carries sales
  // NOT yet known to be synced -- merging the two never double-counts, and
  // an online-only session (the common case) is no longer stuck at zero.
  const sessionPreviewQuery = useQuery({
    queryKey: ["commerce-pos-session-preview", posSession.cashSession?.id],
    queryFn: () =>
      getCommercePosCashSessionPreview({
        data: {
          cashSessionId: posSession.cashSession!.id,
          terminalId: posSession.cashSession!.terminalId,
          businessLocationId: selectedLocationId,
        },
      }),
    enabled: Boolean(posSession.cashSession?.id) && Boolean(selectedLocationId),
  });
  const cashSessionSummary = useMemo(
    () =>
      mergeCommercePosCashSessionSummaries(
        posSession.cashSessionSummary,
        sessionPreviewQuery.data ?? null,
      ),
    [posSession.cashSessionSummary, sessionPreviewQuery.data],
  );
  // Same server source as the summary above, row-level: the "Ventes" tab
  // used to read posSession.outboxEvents only, so an online-direct sale
  // (never written to that local outbox) never appeared there even though
  // it was fully confirmed server-side.
  const sessionSaleRows = useMemo(
    () =>
      mergeCommercePosSessionSaleRows(
        posSession.outboxEvents,
        sessionPreviewQuery.data?.sales ?? null,
      ),
    [posSession.outboxEvents, sessionPreviewQuery.data?.sales],
  );
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
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [pendingSuspendedDeletion, setPendingSuspendedDeletion] =
    useState<CommercePosSuspendedTicket | null>(null);
  const [showClient, setShowClient] = useState(false);
  const [pendingDraftAction, setPendingDraftAction] = useState<CashierDraftAction | null>(null);
  const quickEntryRef = useRef<HTMLInputElement>(null);
  const draft = posSession.draft;
  const cart = posSession.isReady ? (draft?.lines ?? []) : [];
  const clientId = posSession.isReady ? (draft?.clientId ?? "") : "";
  const method: PaymentMethod = posSession.isReady ? (draft?.paymentMethod ?? "CASH") : "CASH";
  const cashReceived = posSession.isReady ? (draft?.cashReceived ?? null) : null;
  const checkoutState = posSession.isReady ? (draft?.checkoutState ?? "READY") : "READY";
  const primaryCashDrawerWallet = workspace?.wallets.find(
    (wallet) => wallet.isPrimary && wallet.purpose === "CASH_DRAWER",
  );
  const primaryCashDrawerWalletId = primaryCashDrawerWallet?.id ?? "";

  useEffect(() => {
    if (!selectedLocationId || posSession.syncRevision === 0) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", selectedLocationId] }),
      queryClient.invalidateQueries({
        queryKey: ["commerce-management-dashboard", selectedLocationId],
      }),
      // A sale just finished syncing: it now counts on the server side of the
      // preview, and getPosOfflineCashSessionSummary will stop counting it
      // locally on its next read (its outbox event is now SYNCED) -- refetch
      // so the merged total reflects that handover instead of a stale split.
      queryClient.invalidateQueries({
        queryKey: ["commerce-pos-session-preview", posSession.cashSession?.id],
      }),
    ]);
  }, [posSession.cashSession?.id, posSession.syncRevision, queryClient, selectedLocationId]);
  useEffect(() => {
    if (!currentUserId) return;
    let active = true;
    if (locationsQuery.data?.length) {
      setCachedLocations(locationsQuery.data);
      void cachePosOfflineLocations(currentUserId, locationsQuery.data).catch((error: unknown) => {
        console.warn("Les points de vente hors connexion n’ont pas pu être mémorisés.", error);
      });
      return () => {
        active = false;
      };
    }
    if (locationsQuery.isSuccess) {
      // Authoritative zero: clear any stale cache instead of leaving a
      // deleted/unassigned location resurrectable on a future reload.
      setCachedLocations([]);
      void cachePosOfflineLocations(currentUserId, []).catch((error: unknown) => {
        console.warn("Les points de vente hors connexion n’ont pas pu être mémorisés.", error);
      });
      return () => {
        active = false;
      };
    }
    void getCachedPosOfflineLocations(currentUserId)
      .then((locations) => {
        if (active && locations.length) setCachedLocations(locations);
      })
      .catch((error: unknown) =>
        console.warn("Les points de vente mémorisés sont indisponibles.", error),
      );
    return () => {
      active = false;
    };
  }, [currentUserId, locationsQuery.data, locationsQuery.isSuccess]);

  useEffect(() => {
    if (locationId || !currentUserId || !availableLocations.length || typeof window === "undefined")
      return;
    let active = true;

    // Une demande explicite (bouton "Ouvrir la caisse" pour un magasin
    // précis, ou l'URL après un refresh) est prioritaire sur toute
    // inférence -- jamais remplacée en silence par le brouillon hors
    // ligne d'un AUTRE magasin. resolveCommercePosLocationId est LE point
    // de décision partagé avec CommerceManagementWorkspace (/commerce) --
    // AUDIT TOTAL : les deux avaient chacun leur propre repli
    // `locationId || locations[0]?.id`, cause du même bug de refresh dans
    // les deux écrans. Vérifiée synchrone, avant même de consulter
    // IndexedDB/localStorage.
    const availableLocationIds = availableLocations.map((location) => location.id);
    const requested = resolveCommercePosLocationId({
      requestedLocationId: requestedLocationId ?? null,
      availableLocationIds,
      draftLocationId: null,
    });
    if (requested) {
      setLocationId(requested);
      return () => {
        active = false;
      };
    }

    void (async () => {
      let restoredLocationId: string | null = null;
      try {
        restoredLocationId = await findPosOfflineDraftLocation(availableLocationIds, currentUserId);
      } catch (error) {
        console.warn("Le brouillon hors connexion n’a pas pu être localisé.", error);
      }
      if (!restoredLocationId) {
        restoredLocationId = findCommercePosDraftLocation(
          window.localStorage,
          availableLocationIds,
          currentUserId,
        );
      }
      // Un seul magasin accessible : aucune ambiguïté, sélection
      // automatique comme aujourd'hui. Plusieurs magasins sans brouillon
      // existant : ne jamais choisir silencieusement le premier -- l'écran
      // de choix explicite prend le relais (availableLocations.length > 1
      // plus bas, quand selectedLocationId reste vide).
      const resolvedLocationId = resolveCommercePosLocationId({
        requestedLocationId: null,
        availableLocationIds,
        draftLocationId: restoredLocationId,
      });
      if (active && resolvedLocationId) setLocationId(resolvedLocationId);
    })();
    return () => {
      active = false;
    };
  }, [availableLocations, currentUserId, locationId, requestedLocationId]);

  useEffect(() => {
    if (locationId) onLocationResolved?.(locationId);
  }, [locationId, onLocationResolved]);

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
  const currentLocationName =
    workspace?.location.name ??
    availableLocations.find((location) => location.id === selectedLocationId)?.name ??
    "Point de vente";
  const items = useMemo(
    () =>
      activeCatalogue.filter((item) =>
        `${item.name} ${item.sku ?? ""}`.toLowerCase().includes(search.toLowerCase()),
      ),
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
    () =>
      activeCategory
        ? items.filter((item) => (item.category?.trim() || null) === activeCategory)
        : items,
    [items, activeCategory],
  );
  const total = cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const stockConflicts = useMemo(
    () =>
      getCommercePosStockConflicts(
        cart,
        activeCatalogue.map((item) => ({
          itemId: item.id,
          label: item.name,
          availableQuantity: item.quantity,
        })),
      ),
    [activeCatalogue, cart],
  );
  const cashChange =
    method === "CASH" && cashReceived !== null ? Math.max(cashReceived - total, 0) : 0;
  const refreshWorkspace = () =>
    queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", selectedLocationId] });
  const updateDraft = useCallback(
    (updater: (current: NonNullable<typeof draft>) => NonNullable<typeof draft>) => {
      if (!posSession.isReady) return;
      posSession.updateDraft(updater);
    },
    [posSession],
  );
  const hasDraftInProgress = Boolean(
    draft &&
    (cart.length > 0 ||
      draft.checkoutState !== "READY" ||
      draft.clientId ||
      draft.paymentMethod !== "CASH" ||
      draft.cashReceived !== null),
  );
  const applyDraftAction = useCallback(() => {
    if (!pendingDraftAction) return;
    const action = pendingDraftAction;
    posSession.clearDraft();
    setShowClient(false);
    setPendingDraftAction(null);
    if (action.type === "CHANGE_LOCATION") setLocationId(action.locationId);
    if (action.type === "RETURN_TO_MANAGEMENT") onBackToManagement?.();
    // Lu au moment de l'application, jamais capturé dans l'action elle-même
    // -- évite tout callback figé si registerSelection a changé entre
    // l'ouverture de la confirmation et sa validation.
    if (action.type === "CHANGE_REGISTER" && registerSelection.status === "READY") {
      registerSelection.changeRegister?.();
    }
  }, [onBackToManagement, pendingDraftAction, posSession, registerSelection]);
  // UX CAISSE : "Changer de caisse" réutilise exactement le même mécanisme
  // que le bouton du même nom sur l'écran "poste occupé"
  // (registerSelection.chooseAnother) -- jamais une deuxième logique. Un
  // ticket en cours est protégé par la même confirmation que pour changer
  // de magasin, pas une nouvelle.
  const requestRegisterChange = () => {
    if (registerSelection.status !== "READY" || !registerSelection.changeRegister) return;
    if (hasDraftInProgress) {
      setPendingDraftAction({ type: "CHANGE_REGISTER" });
      return;
    }
    registerSelection.changeRegister();
  };
  const closeCashSession = async () => {
    await posSession.closeCashSession();
    toast.success(
      posSession.networkStatus === "ONLINE"
        ? "Session cl\u00f4tur\u00e9e. Rapport de contr\u00f4le g\u00e9n\u00e9r\u00e9, synchronis\u00e9."
        : "Session cl\u00f4tur\u00e9e. Rapport enregistr\u00e9 sur cet appareil, synchronisation automatique d\u00e8s le retour d\u2019Internet.",
    );
    // The offline-first cash session hook has no TanStack Query awareness by
    // design (it's driven entirely by IndexedDB), so a same-session switch to
    // the management cockpit needs an explicit nudge here -- otherwise the
    // just-created control report/remittance stay invisible there for the
    // rest of the global staleTime window.
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["commerce-pos-control-reports", selectedLocationId],
      }),
      queryClient.invalidateQueries({ queryKey: ["commerce-store-cockpit", selectedLocationId] }),
      queryClient.invalidateQueries({
        queryKey: ["commerce-cash-remittances", selectedLocationId],
      }),
    ]);
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
      await Promise.all([
        refreshWorkspace(),
        // The sale just landed in commercial_sales -- the server half of the
        // pre-closure summary must reflect it right away, since this online
        // path never writes a local ticket for getPosOfflineCashSessionSummary
        // to pick up (that gap was the root cause of the modal reading zero).
        queryClient.invalidateQueries({
          queryKey: ["commerce-pos-session-preview", posSession.cashSession?.id],
        }),
      ]);
    },
    onError: (error) => {
      const requiresReconciliation = isIndeterminateCheckoutError(error);
      if (requiresReconciliation) posSession.reportNetworkFailure();
      updateDraft((current) => ({
        ...current,
        checkoutState: requiresReconciliation ? "RECONCILIATION_REQUIRED" : "READY",
      }));
      toast.error(
        requiresReconciliation
          ? "La réponse de la caisse est inconnue. La vente est conservée et bloquée à vérification pour éviter un double encaissement."
          : "La vente n’a pas été enregistrée. Vérifiez le stock, le prix ou la configuration de caisse.",
      );
    },
  });

  // Bug production (transfert de stock -> article "indisponible" en Caisse) :
  // un article dont le prix de vente n'a jamais été défini à ce magasin
  // (business_location_inventory_items.sale_price = NULL -- c'est le cas
  // pour tout article reçu pour la première fois via un transfert :
  // receive_commerce_stock_transfer n'insère que business_location_id/
  // inventory_item_id/quantity, jamais sale_price, faute d'avoir cette
  // information au moment du transfert) était accepté silencieusement avec
  // `unitPrice: defaultPrice ?? 0` -- une vente à 0 FCFA sans le moindre
  // avertissement, alors que le stock était bien présent. Les trois points
  // d'entrée (bouton grille, recherche rapide, événement clavier/scan
  // externe) appellent tous cette même fonction : le garde-fou vit ici,
  // pas dans un seul composant d'appel.
  const addArticle = useCallback(
    (itemId: string, defaultPrice: number | null, label: string, quantity = 1) => {
      if (!posSession.isReady || checkoutState !== "READY") return;
      const availableQuantity = activeCatalogue.find((item) => item.id === itemId)?.quantity ?? 0;
      if (availableQuantity <= 0) {
        toast.error(`${label} : rupture de stock dans ce magasin.`);
        return;
      }
      if (defaultPrice === null) {
        toast.error(
          `${label} : prix de vente à définir pour ce magasin avant de pouvoir le vendre.`,
        );
        return;
      }
      updateDraft((current) => {
        const line = current.lines.find(
          (entry) => entry.lineType === "ARTICLE" && entry.itemId === itemId,
        );
        const lines = line
          ? current.lines.map((entry) =>
              entry.lineId === line.lineId
                ? {
                    ...entry,
                    quantity: Math.min(entry.quantity + quantity, availableQuantity),
                    label,
                  }
                : entry,
            )
          : [
              ...current.lines,
              {
                lineId: `article-${itemId}`,
                lineType: "ARTICLE" as const,
                itemId,
                label,
                quantity: Math.min(quantity, availableQuantity),
                unitPrice: defaultPrice,
              },
            ];
        return { ...current, lines };
      });
    },
    [activeCatalogue, checkoutState, posSession.isReady, updateDraft],
  );
  const addService = () => {
    const parsedPrice = Number(servicePrice);
    const normalizedName = serviceName.trim();
    if (
      !posSession.isReady ||
      checkoutState !== "READY" ||
      !normalizedName ||
      !Number.isFinite(parsedPrice) ||
      parsedPrice <= 0
    ) {
      toast.error("Saisissez la désignation et le montant du service.");
      return;
    }
    updateDraft((current) => ({
      ...current,
      lines: [
        ...current.lines,
        {
          lineId: createCommercePosId("service"),
          lineType: "SERVICE",
          itemId: createCommercePosId("service-item"),
          label: normalizedName,
          quantity: 1,
          unitPrice: parsedPrice,
          serviceNote: serviceNote.trim() || null,
        },
      ],
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
      toast.info(
        items.length === 0
          ? "Aucun article ne correspond à cette recherche."
          : "Plusieurs articles correspondent : choisissez-en un dans le rayon.",
      );
      return;
    }
    const item = items[0];
    addArticle(item.id, item.salePrice, item.name, quantity);
    setSearch("");
    setQuickQuantity("1");
    refocusQuickEntry();
  };
  const catalogFloorFor = (line: CartLine): number | null =>
    line.lineType === "ARTICLE"
      ? (activeCatalogue.find((entry) => entry.id === line.itemId)?.salePrice ?? null)
      : null;
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
      setPriceError(
        `Le prix de vente ne peut pas être inférieur au prix catalogue de ${money(floor)}.`,
      );
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
        .map((line) => (line.lineId === lineId ? { ...line, ...values } : line))
        .filter((line) => line.quantity > 0),
    }));
  };
  const setPaymentMethod = (nextMethod: PaymentMethod) => {
    if (checkoutState !== "READY") return;
    if (posSession.networkStatus !== "ONLINE" && nextMethod !== "CASH") {
      toast.info("Seul l’encaissement en espèces reste disponible hors connexion.");
      return;
    }
    updateDraft((current) => ({
      ...current,
      paymentMethod: nextMethod,
      cashReceived: nextMethod === "CASH" ? current.cashReceived : null,
    }));
  };
  const checkout = () => {
    if (!posSession.isReady || !draft || !selectedLocationId || cart.length === 0 || total <= 0) {
      toast.error("Ajoutez au moins un article ou un service avec un prix de vente valide.");
      return;
    }
    if (checkoutState === "RECONCILIATION_REQUIRED") {
      toast.error(
        "Cette vente doit d’abord être vérifiée dans les ventes du magasin avant tout nouvel encaissement.",
      );
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
      toast.info(
        "Le paiement mobile via Jèko est en attente d’activation transactionnelle. Aucun ticket n’a été créé.",
      );
      return;
    }
    if (posSession.networkStatus !== "ONLINE") {
      if (method !== "CASH" || !posSession.canCompleteOfflineCashSale) {
        toast.error("Cette vente ne peut pas être conservée hors connexion sur ce poste.");
        return;
      }
      void posSession
        .completeOfflineCashSale()
        .then((eventId) => {
          setShowClient(false);
          toast.success(
            `Vente enregistrée localement. Elle reste en attente de synchronisation contrôlée (événement ${eventId.slice(-8).toUpperCase()}).`,
          );
        })
        .catch((error: unknown) => {
          notifyMutationError(error, "La vente locale n’a pas pu être sauvegardée.");
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
        lines: cart.map((line) =>
          line.lineType === "ARTICLE"
            ? {
                lineType: "ARTICLE" as const,
                inventoryItemId: line.itemId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
              }
            : {
                lineType: "SERVICE" as const,
                serviceName: line.label,
                serviceNote: line.serviceNote,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
              },
        ),
      },
    });
  };

  useEffect(() => {
    const handleCashierShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

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

  const canCheckout =
    total > 0 &&
    stockConflicts.length === 0 &&
    checkoutState === "READY" &&
    posSession.isCashSessionOpen &&
    (posSession.networkStatus === "ONLINE"
      ? Boolean(primaryCashDrawerWallet)
      : posSession.canCompleteOfflineCashSale && method === "CASH");
  const syncedOutboxCount = posSession.outboxEvents.filter(
    (event) => event.status === "SYNCED",
  ).length;
  const conflictOutboxCount = posSession.outboxEvents.filter(
    (event) => event.status === "CONFLICT",
  ).length;
  // UX CAISSE : vocabulaire calme, phrase courte, jamais en capitales --
  // un indicateur compact, pas un bandeau d'alerte. Le calcul lui-même
  // (quel état l'emporte) est inchangé, seul le libellé change.
  const syncStatusLabel =
    posSession.networkStatus !== "ONLINE"
      ? "Hors ligne"
      : posSession.syncProgress
        ? "Synchronisation…"
        : conflictOutboxCount > 0
          ? "Intervention requise"
          : posSession.pendingOutboxCount > 0
            ? `${posSession.pendingOutboxCount} vente${posSession.pendingOutboxCount > 1 ? "s" : ""} en attente`
            : "Synchronisé";

  if (locationsQuery.isPending && !availableLocations.length)
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    );
  if (locationsQuery.isError && !availableLocations.length)
    return (
      <Card variant="information">
        <CardContent className="space-y-4 p-6">
          <p>
            Impossible de charger vos points de vente autorisés. Ouvrez d’abord la caisse une fois
            avec Internet pour la rendre disponible hors connexion.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void signOut();
            }}
          >
            <DoorOpen className="mr-2 h-4 w-4" />
            Se déconnecter
          </Button>
        </CardContent>
      </Card>
    );
  if (!availableLocations.length) {
    return canManageLocations ? (
      <CommerceLocationSetup onDone={handleLocationSaved} />
    ) : (
      <Card variant="information">
        <CardHeader>
          <CardTitle>Aucune caisse disponible</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            Votre compte doit être affecté à un magasin Commerce avant de pouvoir encaisser. Un
            administrateur doit créer le magasin, associer son wallet puis vous y affecter.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void signOut();
            }}
          >
            <DoorOpen className="mr-2 h-4 w-4" />
            Se déconnecter
          </Button>
        </CardContent>
      </Card>
    );
  }

  // CHANTIER CAISSE : plusieurs magasins accessibles, aucun n'a encore été
  // résolu (ni demande explicite, ni brouillon existant) -- jamais un choix
  // silencieux du premier de la liste (cause exacte du bug d'origine :
  // getCommercePosLocations trie par nom, "ACCESSOIRES ET DIVERS" passait
  // ainsi systématiquement avant "MAGASIN MARIAM").
  if (!selectedLocationId && availableLocations.length > 1) {
    return <CommerceLocationChoiceScreen locations={availableLocations} onSelect={setLocationId} />;
  }

  // CHANTIER CAISSE : plus de sélection silencieuse d'un poste -- tant que
  // le poste n'est pas résolu (ou verrouillé côté serveur), l'écran normal
  // de caisse ne s'affiche pas.
  if (registerSelection.status === "LOADING") {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (registerSelection.status === "ERROR") {
    return (
      <Card variant="information">
        <CardHeader>
          <CardTitle>Postes de caisse indisponibles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>{registerSelection.message}</p>
          <Button type="button" variant="outline" size="sm" onClick={registerSelection.retry}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (registerSelection.status === "BUSY") {
    return (
      <Card variant="information">
        <CardHeader>
          <CardTitle>Poste déjà en cours d’utilisation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            Ce poste de caisse est actuellement ouvert par{" "}
            <strong>{registerSelection.busyCashier}</strong>
            {registerSelection.busySince
              ? ` depuis ${new Date(registerSelection.busySince).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
            . Un seul collaborateur à la fois peut l’utiliser.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={registerSelection.retry}>
              Réessayer
            </Button>
            {/* Un poste occupé ne bloque jamais l'accès aux autres -- ce
                bouton reste proposé même si l'écran de choix montre ensuite
                qu'aucune autre caisse active n'est libre pour l'instant. */}
            <Button type="button" variant="outline" onClick={registerSelection.chooseAnother}>
              Choisir une autre caisse
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (registerSelection.status === "NEEDS_SELECTION") {
    return (
      <Card variant="information">
        <CardHeader>
          <CardTitle>Choisissez votre poste de caisse</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {registerSelection.registers.map((register) => (
              <RegisterTile
                key={register.id}
                register={register}
                onSelect={registerSelection.select}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const cashierInitials =
    cashierName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  const sessionOpenedLabel = posSession.cashSession?.openedAtDevice
    ? new Date(posSession.cashSession.openedAtDevice).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
  const syncPillTone =
    conflictOutboxCount > 0
      ? "bg-destructive/15 text-destructive-foreground"
      : posSession.networkStatus !== "ONLINE" || posSession.pendingOutboxCount > 0
        ? "bg-warning/20 text-warning-foreground"
        : "bg-success/20 text-success-foreground";
  const canChangeRegisterHeader =
    registerSelection.status === "READY" && registerSelection.changeRegister !== null;

  // UX CAISSE : un seul panier, rendu à deux endroits (fixe sur desktop,
  // dans un tiroir sur mobile) -- jamais deux implémentations qui
  // pourraient diverger. Zéro logique métier ici, uniquement la
  // présentation déjà validée (updateDraft/update/addArticle/checkout...).
  const cartPanelBody = (
    <>
      <div className="shrink-0 border-b border-border/75 p-3">
        {showClient ? (
          <div className="flex items-center gap-2">
            <ClientSelect
              value={clientId}
              onValueChange={(value) =>
                updateDraft((current) => ({ ...current, clientId: value || null }))
              }
              placeholder="Client facultatif"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                updateDraft((current) => ({ ...current, clientId: null }));
                setShowClient(false);
              }}
            >
              Comptoir
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowClient(true)}
            className="flex w-full items-center justify-between rounded-xl border border-dashed border-border/90 bg-surface/75 px-3 py-2 text-left text-sm transition-colors hover:border-primary/35 hover:bg-primary/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="font-semibold">
              {clientId ? "Ticket nominatif" : "Vente comptoir"}
            </span>
            <span className="text-xs font-semibold text-primary">F4 · Client</span>
          </button>
        )}
      </div>

      {cart.length > 0 ? (
        <div
          className={cn(
            "grid shrink-0 items-center gap-x-1.5 border-b border-border bg-muted/40 py-1 pl-3 pr-[calc(0.125rem+0.75rem)] text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
            CART_GRID_COLUMNS,
          )}
        >
          <span>#</span>
          <span />
          <span>Article</span>
          <span className="text-right">PU</span>
          <span className="text-center">Qté</span>
          <span className="text-right">Total</span>
          <span />
        </div>
      ) : null}
      {/* REFONTE CAISSE : priorité absolue -- cette liste doit dominer le
          panneau. Header (client) et footer (paiement) restent shrink-0
          au-dessus/en-dessous ; seule cette zone scrolle, et seulement au-delà
          d'environ 15-20 lignes sur un écran desktop courant. */}
      <div className="min-h-0 flex-1 overflow-auto px-3">
        {cart.map((line, index) => {
          const isService = line.lineType === "SERVICE";
          const catalogItem = !isService
            ? activeCatalogue.find((entry) => entry.id === line.itemId)
            : null;
          const availableQuantity = isService
            ? Number.POSITIVE_INFINITY
            : (catalogItem?.quantity ?? 0);
          const isEditingPrice = editingPriceLineId === line.lineId;
          const floor = catalogFloorFor(line);
          const surcharge = floor !== null && line.unitPrice > floor ? line.unitPrice - floor : 0;
          return (
            <CartLineRow
              key={line.lineId}
              index={index + 1}
              line={line}
              imagePath={catalogItem?.imagePath ?? null}
              disabled={checkoutState !== "READY"}
              isEditingPrice={isEditingPrice}
              priceDraft={priceDraft}
              priceError={isEditingPrice ? priceError : null}
              surcharge={surcharge}
              canIncrease={isService || line.quantity < availableQuantity}
              onStartEditPrice={() => startEditPrice(line)}
              onPriceDraftChange={setPriceDraft}
              onCommitPrice={() => commitEditPrice(line)}
              onCancelPrice={cancelEditPrice}
              onDecrease={() => update(line.lineId, { quantity: line.quantity - 1 })}
              onIncrease={() =>
                isService
                  ? update(line.lineId, { quantity: line.quantity + 1 })
                  : addArticle(line.itemId, line.unitPrice, line.label)
              }
              onRemove={() => update(line.lineId, { quantity: 0 })}
            />
          );
        })}
        {cart.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center">
            <ShoppingCart className="size-6 text-muted-foreground" />
            <p className="text-sm font-semibold">Le panier est vide</p>
            <p className="text-xs text-muted-foreground">
              Touchez un article du rayon pour commencer.
            </p>
          </div>
        ) : null}
      </div>

      {/* REFONTE CAISSE : point 3 -- la zone paiement ne doit plus dominer
          verticalement. Puces de moyen de paiement plus fines, Reçu/Monnaie/
          Total réunis sur une seule ligne compacte (plus de bloc "Total"
          autonome en 3xl), bouton Encaisser plus fin (h-11, pas h-14). */}
      <div className="shrink-0 space-y-2 border-t border-border/75 bg-muted/[0.10] p-2.5">
        <div
          className="flex flex-wrap items-center gap-1"
          role="radiogroup"
          aria-label="Moyen de paiement"
        >
          {paymentMethods.map(({ value, label, icon: Icon }) => {
            const selected = method === value;
            const jekoDisabled = value === "JEKO";
            const offlineUnavailable = posSession.networkStatus !== "ONLINE" && value !== "CASH";
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPaymentMethod(value)}
                disabled={checkoutState !== "READY" || jekoDisabled || offlineUnavailable}
                title={
                  jekoDisabled
                    ? "Jèko sera disponible lorsque l’encaissement transactionnel POS sera relié."
                    : offlineUnavailable
                      ? "Paiement indisponible hors connexion."
                      : value === "WAVE"
                        ? "Saisie mobile manuelle : aucune API Wave directe"
                        : label
                }
                className={`flex h-8 min-w-[4rem] flex-1 items-center justify-center gap-1 rounded-lg border text-xs font-semibold transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 ${selected ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-surface text-muted-foreground hover:border-primary/35 hover:text-foreground"}`}
              >
                <Icon className="size-3.5" />
                <span className="hidden sm:inline">
                  {jekoDisabled ? "Jèko" : value === "WAVE" ? "Mobile" : label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-stretch gap-1.5">
          {method === "CASH" ? (
            <div className="flex w-24 flex-col gap-0.5">
              <Label
                htmlFor="commerce-pos-cash-received"
                className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Reçu
              </Label>
              <Input
                id="commerce-pos-cash-received"
                className="h-9 px-2 text-right text-sm tabular-nums"
                type="number"
                min={total}
                step="1"
                disabled={checkoutState !== "READY"}
                placeholder={money(total)}
                value={cashReceived ?? ""}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    cashReceived: event.target.value === "" ? null : Number(event.target.value),
                  }))
                }
              />
            </div>
          ) : null}
          {method === "CASH" && cashReceived !== null ? (
            <div className="flex w-20 flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Monnaie
              </span>
              <div className="flex h-9 items-center justify-end rounded-md border border-transparent px-2 text-sm font-semibold tabular-nums">
                {money(cashChange)}
              </div>
            </div>
          ) : null}
          <div className="flex flex-1 flex-col items-end justify-center gap-0.5 rounded-lg bg-primary/[0.08] px-3 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Total à payer
            </span>
            <span className="text-lg font-bold tabular-nums text-foreground">{money(total)}</span>
          </div>
        </div>

        <Button
          className="h-11 w-full text-sm"
          loading={saleMutation.isPending}
          loadingLabel="Comptabilisation"
          disabled={!canCheckout}
          onClick={checkout}
        >
          <WalletCards />
          {saleMutation.isPending || checkoutState === "PROCESSING"
            ? "Comptabilisation…"
            : posSession.networkStatus !== "ONLINE"
              ? `Conserver ${money(total)}`
              : `Encaisser ${money(total)}`}
          <span className="ml-1 hidden text-xs font-normal opacity-75 2xl:inline">· F10</span>
        </Button>
        {hasDraftInProgress ? (
          <div className="flex justify-end gap-3 pt-0.5">
            <button
              type="button"
              disabled={checkoutState !== "READY" || cart.length === 0}
              onClick={() => {
                if (posSession.suspendDraft()) {
                  setShowClient(false);
                  toast.success("Ticket suspendu : aucune opération n’a été comptabilisée.");
                }
              }}
              className="text-xs font-semibold text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              Suspendre
            </button>
            <button
              type="button"
              disabled={checkoutState !== "READY"}
              onClick={() => setPendingDraftAction({ type: "DISCARD" })}
              className="text-xs font-semibold text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
            >
              Abandonner
            </button>
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col gap-3",
        isCashierOnlyShell ? "lg:h-[calc(100dvh-1.5rem)]" : "lg:h-[calc(100dvh-6.4rem)]",
      )}
    >
      {/* UX CAISSE : un titre net (HALAL ERP -- CAISSE), une seule ligne de
          contexte discrète en dessous (magasin, poste, caissier, ouverture)
          -- jamais un tableau de bord. CA du jour déplacé dans l'onglet
          Session : ça n'aide pas à vendre la prochaine ligne. Les actions
          secondaires (changer de caisse, gestion, déconnexion) vivent dans
          un menu compact -- seuls l'état sync et Clôturer restent toujours
          visibles, ce sont les deux qui comptent en continu. */}
      <header className="shrink-0 rounded-2xl bg-foreground text-background shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
              {cashierInitials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-bold tracking-tight">HALAL ERP — CAISSE</p>
              <p className="mt-0.5 truncate text-xs text-background/60">
                <span title={currentLocationName}>{currentLocationName}</span>
                {registerSelection.status === "READY" && registerSelection.registerName
                  ? ` · ${registerSelection.registerName}`
                  : ""}
                {" · "}
                {cashierName}
                {" · Ouverte "}
                {sessionOpenedLabel}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${syncPillTone}`}
            >
              {posSession.networkStatus !== "ONLINE" ? (
                <CloudOff className="size-3.5" aria-hidden="true" />
              ) : (
                <CloudUpload className="size-3.5" aria-hidden="true" />
              )}
              {syncStatusLabel}
            </span>
            <PosCashSessionClose
              session={posSession.cashSession}
              summary={cashSessionSummary}
              disabled={hasDraftInProgress || posSession.suspendedTickets.length > 0}
              onClose={closeCashSession}
              onStartNew={startNewCashSession}
            />
            {canChangeRegisterHeader || onBackToManagement || isCashierOnlyShell ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-background hover:bg-background/10 hover:text-background"
                    aria-label="Plus d’options"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canChangeRegisterHeader ? (
                    <DropdownMenuItem onClick={requestRegisterChange}>
                      <ArrowLeftRight />
                      Changer de caisse
                    </DropdownMenuItem>
                  ) : null}
                  {onBackToManagement ? (
                    <DropdownMenuItem onClick={onBackToManagement}>
                      <LogOut />
                      Gestion
                    </DropdownMenuItem>
                  ) : null}
                  {isCashierOnlyShell ? (
                    <DropdownMenuItem
                      onClick={() => {
                        void signOut();
                      }}
                    >
                      <DoorOpen />
                      Déconnexion
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </header>

      {/* CAISSE / VENTES / SESSION -- the cashier's entire world, three tabs, nothing else. */}
      <div className="flex shrink-0 gap-1 rounded-xl border border-border/80 bg-muted/[0.18] p-1">
        {(
          [
            ["CAISSE", ShoppingCart],
            ["VENTES", ReceiptText],
            ["SESSION", CircleDollarSign],
          ] as const
        ).map(([value, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setCashierTab(value)}
            aria-current={cashierTab === value ? "page" : undefined}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${cashierTab === value ? "bg-surface text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="size-4" />
            {value === "CAISSE" ? "Caisse" : value === "VENTES" ? "Ventes" : "Session"}
          </button>
        ))}
      </div>

      {cashierTab === "SESSION" ? (
        <CashierSessionTab
          summary={cashSessionSummary}
          suspendedTicketsCount={posSession.suspendedTickets.length}
          onOpenSuspendedTickets={() => setSuspendedTicketsOpen(true)}
          canSeeTodayRevenue={canSeeTodayRevenue}
          todayRevenue={workspace?.today.received ?? 0}
          session={posSession.cashSession}
          disabled={hasDraftInProgress || posSession.suspendedTickets.length > 0}
          onClose={closeCashSession}
          onStartNew={startNewCashSession}
        />
      ) : cashierTab === "VENTES" ? (
        <CashierSalesTab sales={sessionSaleRows} />
      ) : (
        <>
          {posSession.isRestored ? (
            <div className="shrink-0 rounded-xl border border-info/20 bg-info/[0.06] px-4 py-2 text-sm text-info">
              Brouillon restauré sur ce poste : aucune ligne n’a été perdue.
            </div>
          ) : null}
          {stockConflicts.length ? (
            <div className="shrink-0 rounded-xl border border-warning/25 bg-warning/[0.08] px-4 py-2 text-sm text-warning">
              Stock modifié :{" "}
              {stockConflicts
                .map(
                  (conflict) =>
                    `${conflict.label} — ${conflict.availableQuantity} disponible${conflict.availableQuantity > 1 ? "s" : ""} au lieu de ${conflict.requestedQuantity}`,
                )
                .join(" · ")}
              . Ajustez le ticket avant l’encaissement.
            </div>
          ) : null}
          {checkoutState === "RECONCILIATION_REQUIRED" ? (
            <div className="shrink-0 rounded-xl border border-warning/25 bg-warning/[0.08] px-4 py-2 text-sm text-warning">
              Encaissement à vérifier : le brouillon est protégé afin d’éviter un double
              encaissement.
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,4fr)_minmax(480px,3fr)]">
            {/* REFONTE CAISSE : ~57%/43% sur desktop (avant : ~67%/33%) --
                le panier était trop étroit pour que sa liste domine
                visuellement. Plein écran sur mobile : le panier vit dans le
                tiroir fixe plus bas, jamais empilé au-dessus du rayon. */}
            <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-sm">
              <div className="shrink-0 space-y-2.5 border-b border-border/75 bg-muted/[0.16] p-3">
                <div className="flex gap-2">
                  <form
                    className="relative flex-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      addQuickResult();
                    }}
                  >
                    <Search className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-primary" />
                    <Input
                      ref={quickEntryRef}
                      className="h-11 bg-surface pl-10 text-base"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Rechercher ou scanner · F2"
                      autoComplete="off"
                    />
                  </form>
                  <Input
                    className="h-11 w-16 bg-surface text-center tabular-nums"
                    type="number"
                    min="1"
                    step="1"
                    aria-label="Quantité"
                    value={quickQuantity}
                    onChange={(event) => setQuickQuantity(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addQuickResult();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    title="Ajouter un service"
                    aria-label="Ajouter un service"
                    disabled={checkoutState !== "READY"}
                    onClick={() => setServiceDialogOpen(true)}
                  >
                    <Wrench />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="relative h-11 w-11 shrink-0"
                    title="Tickets en attente"
                    aria-label={`Tickets en attente${posSession.suspendedTickets.length ? ` (${posSession.suspendedTickets.length})` : ""}`}
                    onClick={() => setSuspendedTicketsOpen(true)}
                  >
                    <ListTodo />
                    {posSession.suspendedTickets.length ? (
                      <span className="absolute -right-1.5 -top-1.5 flex size-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        {posSession.suspendedTickets.length}
                      </span>
                    ) : null}
                  </Button>
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  <button
                    type="button"
                    onClick={() => setActiveCategory(null)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeCategory === null ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground hover:border-primary/35 hover:text-foreground"}`}
                  >
                    Tous
                  </button>
                  {categories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setActiveCategory(category)}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeCategory === category ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground hover:border-primary/35 hover:text-foreground"}`}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-3 pb-28 lg:pb-3">
                {workspaceQuery.isPending && !isUsingOfflineCatalogue ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    <Skeleton className="h-28" />
                    <Skeleton className="h-28" />
                    <Skeleton className="h-28" />
                    <Skeleton className="h-28" />
                  </div>
                ) : null}
                {workspaceQuery.isError && !isUsingOfflineCatalogue ? (
                  <Card variant="information">
                    <CardContent className="p-6">
                      La caisse ne peut pas être ouverte pour ce point de vente. Réessayez dans un
                      instant ou contactez un responsable.
                    </CardContent>
                  </Card>
                ) : null}
                {isUsingOfflineCatalogue ? (
                  <div className="mb-3 rounded-xl border border-warning/20 bg-warning/[0.06] px-3 py-2 text-sm text-warning">
                    Catalogue et stock local affichés.
                  </div>
                ) : null}
                {(!workspaceQuery.isPending || isUsingOfflineCatalogue) &&
                (!workspaceQuery.isError || isUsingOfflineCatalogue) ? (
                  gridItems.length ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                      {gridItems.map((item) => (
                        <ProductCard
                          key={item.id}
                          item={item}
                          disabled={checkoutState !== "READY"}
                          onSelect={() => addArticle(item.id, item.salePrice, item.name)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-center">
                      <Package className="size-8 text-muted-foreground" />
                      <p className="font-semibold">Aucun article ne correspond</p>
                      <p className="text-sm text-muted-foreground">
                        Essayez une autre recherche ou une autre catégorie.
                      </p>
                    </div>
                  )
                ) : null}
              </div>
            </section>

            {/* ~43% sur desktop -- panier fixe, jamais un tiroir caché.
                Masqué sur mobile : même contenu (cartPanelBody), affiché
                dans le tiroir fixe en bas d'écran à la place. */}
            <aside className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-sm lg:flex">
              {cartPanelBody}
            </aside>
          </div>

          {/* MOBILE -- catalogue plein écran, panier dans un tiroir fixe.
              Le total reste visible en permanence sans ouvrir quoi que ce
              soit ; le tiroir ne s'ouvre que pour agir sur le panier. */}
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface p-3 shadow-[0_-6px_20px_-6px_rgb(0_0_0_/_0.15)] lg:hidden">
            <button
              type="button"
              onClick={() => setMobileCartOpen(true)}
              className="flex w-full items-center justify-between rounded-xl bg-primary px-4 py-3.5 text-primary-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <ShoppingCart className="size-5" />
                {cart.length} article{cart.length > 1 ? "s" : ""}
              </span>
              <span className="text-lg font-bold tabular-nums">{money(total)}</span>
            </button>
          </div>
          <Drawer open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
            <DrawerContent className="flex max-h-[90dvh] flex-col">
              <DrawerHeader className="shrink-0 border-b border-border/75 text-left">
                <DrawerTitle>Panier</DrawerTitle>
              </DrawerHeader>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{cartPanelBody}</div>
            </DrawerContent>
          </Drawer>
        </>
      )}

      <Dialog open={serviceDialogOpen} onOpenChange={setServiceDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajouter un service</DialogTitle>
            <DialogDescription>
              Le service est facturé avec ce ticket et créditera la caisse seulement lors de
              l’encaissement. Il ne crée aucun mouvement de stock.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="commerce-pos-service-name">Désignation du service</Label>
              <Input
                id="commerce-pos-service-name"
                autoFocus
                value={serviceName}
                onChange={(event) => setServiceName(event.target.value)}
                placeholder="Ex. Réparation écran téléphone"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="commerce-pos-service-price">Montant (FCFA)</Label>
              <Input
                id="commerce-pos-service-price"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={servicePrice}
                onChange={(event) => setServicePrice(event.target.value)}
                placeholder="15000"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="commerce-pos-service-note">
                Note <span className="font-normal text-muted-foreground">(facultative)</span>
              </Label>
              <Input
                id="commerce-pos-service-note"
                value={serviceNote}
                onChange={(event) => setServiceNote(event.target.value)}
                placeholder="Détail de l'intervention"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setServiceDialogOpen(false)}>
              Annuler
            </Button>
            <Button
              type="button"
              disabled={
                checkoutState !== "READY" || !serviceName.trim() || Number(servicePrice) <= 0
              }
              onClick={addService}
            >
              <Wrench />
              Ajouter au ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={suspendedTicketsOpen} onOpenChange={setSuspendedTicketsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Tickets en attente</DialogTitle>
            <DialogDescription>
              Ces tickets sont enregistrés sur ce poste uniquement. Ils ne créent ni vente, ni
              mouvement de stock, ni écriture financière avant l’encaissement.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[56dvh] space-y-2 overflow-y-auto pr-1">
            {posSession.suspendedTickets.map((ticket) => (
              <SuspendedTicketRow
                key={ticket.id}
                ticket={ticket}
                onResume={() => {
                  if (posSession.resumeSuspendedTicket(ticket.id)) {
                    setShowClient(Boolean(ticket.draft.clientId));
                    setSuspendedTicketsOpen(false);
                    toast.success("Ticket repris dans la caisse.");
                  }
                }}
                onDelete={() => setPendingSuspendedDeletion(ticket)}
              />
            ))}
            {!posSession.suspendedTickets.length ? (
              <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
                Aucun ticket n’est en attente sur ce poste.
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDraftAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDraftAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abandonner la vente en cours ?</AlertDialogTitle>
            <AlertDialogDescription>
              {cart.length} article{cart.length > 1 ? "s" : ""} · {money(total)}. Le brouillon de
              cette caisse sera supprimé, mais aucune vente ni écriture financière ne sera modifiée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Conserver la vente</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={applyDraftAction}
            >
              Abandonner
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingSuspendedDeletion !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSuspendedDeletion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce ticket suspendu ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le ticket{" "}
              {pendingSuspendedDeletion
                ? `POS-${pendingSuspendedDeletion.draft.sessionId.slice(-8).toUpperCase()}`
                : ""}{" "}
              sera supprimé de ce poste. Aucune vente, aucun stock et aucune écriture financière ne
              seront annulés car rien n’a encore été comptabilisé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Conserver</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingSuspendedDeletion)
                  posSession.removeSuspendedTicket(pendingSuspendedDeletion.id);
                setPendingSuspendedDeletion(null);
                toast.success("Ticket suspendu supprimé.");
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Mission caisse-UX: a dedicated, always-legible "où en est ma session ?"
 * screen -- no Finance vocabulary, no wallet, nothing the cashier has to
 * interpret beyond what they already see in the header at a glance. */
// UX CAISSE : magasin, poste, caissier, ouverture, sync restent visibles en
// permanence dans l'en-tête (au-dessus de cet onglet, quel que soit
// l'onglet actif) -- les répéter ici à l'identique n'aiderait personne.
// Cet onglet ne montre que ce que l'en-tête ne montre pas : le récap
// chiffré de la session, les tickets en attente, et l'action de clôture.
function CashierSessionTab({
  summary,
  suspendedTicketsCount,
  onOpenSuspendedTickets,
  canSeeTodayRevenue,
  todayRevenue,
  session,
  disabled,
  onClose,
  onStartNew,
}: {
  summary: ReturnType<typeof useCommercePosSession>["cashSessionSummary"];
  suspendedTicketsCount: number;
  onOpenSuspendedTickets: () => void;
  canSeeTodayRevenue: boolean;
  todayRevenue: number;
  session: ReturnType<typeof useCommercePosSession>["cashSession"];
  disabled: boolean;
  onClose: () => Promise<void>;
  onStartNew: () => Promise<void>;
}) {
  return (
    <div className="flex-1 space-y-3 overflow-auto">
      {suspendedTicketsCount > 0 ? (
        <button
          type="button"
          onClick={onOpenSuspendedTickets}
          className="flex w-full items-center justify-between rounded-2xl border border-warning/25 bg-warning/[0.06] px-4 py-3 text-left transition-colors hover:bg-warning/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-warning">
            <ListTodo className="size-4" />
            {suspendedTicketsCount} ticket{suspendedTicketsCount > 1 ? "s" : ""} en attente
          </span>
          <span className="text-xs font-semibold text-warning underline">Voir</span>
        </button>
      ) : null}
      {summary ? (
        <Card variant="section">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Depuis l’ouverture</CardTitle>
          </CardHeader>
          <CardContent
            className={cn(
              "grid gap-3 sm:grid-cols-2",
              canSeeTodayRevenue ? "xl:grid-cols-5" : "xl:grid-cols-4",
            )}
          >
            <div className="rounded-xl border border-border/70 bg-muted/[0.12] p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Tickets
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">{summary.ticketCount}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/[0.12] p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Articles
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">{money(summary.articleTotal)}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/[0.12] p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Services
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">{money(summary.serviceTotal)}</p>
            </div>
            <div className="rounded-xl border border-primary/25 bg-primary/[0.06] p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                Espèces (théorique)
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums text-primary">
                {money(summary.theoreticalCash)}
              </p>
            </div>
            {canSeeTodayRevenue ? (
              <div className="rounded-xl border border-border/70 bg-muted/[0.12] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  CA du jour
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums">{money(todayRevenue)}</p>
              </div>
            ) : null}
            {/* Toujours affiches, meme a 0 : un montant Mobile Money ou Autres
              ne doit jamais disparaitre silencieusement de ce recap. */}
            <div className="rounded-xl border border-border/70 bg-muted/[0.12] p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Mobile Money
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {money(summary.mobileMoneyTotal)}
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/[0.12] p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Autres moyens
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {money(summary.otherPaymentTotal)}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
      <Card variant="section">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Fin de journée</CardTitle>
          <p className="text-sm text-muted-foreground">
            Clôturez lorsque vous avez terminé de vendre. Le contrôle et la réception des espèces se
            font ensuite côté gestion.
          </p>
        </CardHeader>
        <CardContent>
          <PosCashSessionClose
            session={session}
            summary={summary}
            disabled={disabled}
            onClose={onClose}
            onStartNew={onStartNew}
          />
        </CardContent>
      </Card>
    </div>
  );
}

const paymentMethodLabel = (method: string | null) =>
  method === "CASH"
    ? "Espèces"
    : method === "WAVE" || method === "JEKO"
      ? "Mobile Money"
      : method === null
        ? "—"
        : "Autre";

/** Mission caisse-UX: the cashier's own ticket history for this session --
 * time, ticket, content, amount, payment method, sync status. No net
 * result, no CMV, no Finance -- that belongs to the manager's control
 * center, not this screen.
 *
 * Mission maitre, Blocker A: sales is the merge of confirmed server sales
 * (online-direct or offline-then-synced -- see
 * mergeCommercePosSessionSaleRows) and not-yet-synced local outbox events,
 * never the local outbox alone. */
function CashierSalesTab({ sales }: { sales: CommercePosSessionSaleRow[] }) {
  const syncLabel = (status: string) =>
    status === "SYNCED"
      ? "Synchronisé"
      : status === "CONFLICT"
        ? "À contrôler"
        : status === "SYNCING"
          ? "Synchronisation…"
          : status === "FAILED"
            ? "Nouvel essai"
            : "En attente";
  return (
    <div className="flex-1 overflow-auto">
      <Card variant="section">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Mes ventes</CardTitle>
          <p className="text-sm text-muted-foreground">
            {sales.length} ticket{sales.length > 1 ? "s" : ""} sur cette session.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {sales.length ? (
            <div className="divide-y divide-border/60">
              {sales.map((sale) => {
                return (
                  <div
                    key={sale.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {new Date(sale.createdAt).toLocaleTimeString("fr-FR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · {sale.label}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {sale.articleCount
                          ? `${sale.articleCount} article${sale.articleCount > 1 ? "s" : ""}`
                          : ""}
                        {sale.articleCount && sale.serviceCount ? " · " : ""}
                        {sale.serviceCount
                          ? `${sale.serviceCount} service${sale.serviceCount > 1 ? "s" : ""}`
                          : ""}{" "}
                        · {paymentMethodLabel(sale.paymentMethod)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="font-bold tabular-nums">{money(sale.total)}</p>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sale.syncStatus === "SYNCED" ? "bg-success/10 text-success" : sale.syncStatus === "CONFLICT" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}
                      >
                        {syncLabel(sale.syncStatus)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center">
              <ReceiptText className="size-6 text-muted-foreground" />
              <p className="text-sm font-semibold">Aucune vente pour l’instant</p>
            </div>
          )}
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

function CommerceLocationForm({
  mode,
  location,
  primaryWalletId = "",
  onDone,
}: CommerceLocationFormProps) {
  const isEdit = mode === "edit";
  const [name, setName] = useState(location?.name ?? "");
  const [code, setCode] = useState(location?.code ?? "");
  const [walletId, setWalletId] = useState(primaryWalletId);
  const [userId, setUserId] = useState("");
  const optionsQuery = useQuery({
    queryKey: ["commerce-setup-options"],
    queryFn: () => getCommerceSetupOptions(),
  });
  const createMutation = useMutation({
    mutationFn: setupCommerceLocation,
    onSuccess: (created) => {
      toast.success(`${created.name} est prêt pour la caisse.`);
      onDone(created.locationId);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Le magasin n’a pas pu être créé. Vérifiez le code, le wallet et les droits d’accès.",
      ),
  });
  const updateMutation = useMutation({
    mutationFn: updateCommerceLocation,
    onSuccess: (updated) => {
      toast.success(`${updated.name} a été mis à jour.`);
      onDone(updated.locationId);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Le magasin n’a pas pu être mis à jour. Vérifiez le code, le wallet et les droits d’accès.",
      ),
  });
  const normalizeCode = (value: string) =>
    value
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
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
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Accessoires & sacs"
        />
      </div>
      <div className="space-y-1">
        <Label>Code</Label>
        <Input
          value={code}
          onChange={(event) => setCode(normalizeCode(event.target.value))}
          placeholder="MAGASIN_CENTRAL"
        />
        <p className="text-caption">
          Les espaces sont automatiquement remplacés par des tirets bas.
        </p>
      </div>
      <div className="space-y-1">
        <Label>Wallet de caisse</Label>
        <WalletSelect
          value={walletId}
          onValueChange={setWalletId}
          placeholder="Choisir le wallet"
        />
        <p className="text-caption">
          Modifier le wallet conserve toutes les ventes historiques dans leur wallet d’origine.
        </p>
      </div>
      {!isEdit ? (
        <div className="space-y-1">
          <Label>Caissier initial (facultatif)</Label>
          <Select
            value={userId || "NONE"}
            onValueChange={(value) => setUserId(value === "NONE" ? "" : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Affecter plus tard" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">Affecter plus tard</SelectItem>
              {optionsQuery.data?.users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : location ? (
        <CommerceLocationAssignments locationId={location.id} />
      ) : null}
      <div className="md:col-span-2">
        <Button disabled={saving || !name.trim() || !code.trim() || !walletId} onClick={save}>
          <Store />
          {saving
            ? "Enregistrement…"
            : isEdit
              ? "Mettre à jour le magasin"
              : "Créer le magasin et sa caisse"}
        </Button>
        <p className="mt-3 text-caption">
          Cette configuration ne modifie jamais le solde d’un wallet.
        </p>
      </div>
    </div>
  );
}

function SuspendedTicketRow({
  ticket,
  onResume,
  onDelete,
}: {
  ticket: CommercePosSuspendedTicket;
  onResume: () => void;
  onDelete: () => void;
}) {
  const total = ticket.draft.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const articleCount = ticket.draft.lines.filter((line) => line.lineType === "ARTICLE").length;
  const serviceCount = ticket.draft.lines.filter((line) => line.lineType === "SERVICE").length;
  const timestamp = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(ticket.suspendedAt));

  return (
    <div className="rounded-xl border border-border/75 bg-muted/[0.12] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-bold text-primary">
            POS-{ticket.draft.sessionId.slice(-8).toUpperCase()}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {timestamp} · {ticket.draft.clientId ? "Client renseigné" : "Client comptoir"} ·
            Caissier de ce poste
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {ticket.draft.lines.length} ligne{ticket.draft.lines.length > 1 ? "s" : ""} ·{" "}
            {articleCount} article{articleCount > 1 ? "s" : ""}
            {serviceCount ? ` · ${serviceCount} service${serviceCount > 1 ? "s" : ""}` : ""}
          </p>
        </div>
        <p className="shrink-0 font-bold tabular-nums">{money(total)}</p>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onDelete}>
          Supprimer
        </Button>
        <Button type="button" size="sm" onClick={onResume}>
          Reprendre
        </Button>
      </div>
    </div>
  );
}

function CommerceLocationSetup({ onDone }: { onDone: (locationId: string) => void }) {
  return (
    <Card variant="section">
      <CardHeader>
        <CardTitle>Initialiser votre premier magasin</CardTitle>
      </CardHeader>
      <CardContent>
        <CommerceLocationForm mode="create" onDone={onDone} />
      </CardContent>
    </Card>
  );
}

type CommerceAssignmentRole =
  "CASHIER" | "STORE_MANAGER" | "STOCK_KEEPER" | "SALES_AGENT" | "OTHER";

const commerceAssignmentRoles: Array<{ value: CommerceAssignmentRole; label: string }> = [
  { value: "CASHIER", label: "Caissier" },
  { value: "STORE_MANAGER", label: "Responsable magasin" },
  { value: "STOCK_KEEPER", label: "Gestionnaire de stock" },
  { value: "SALES_AGENT", label: "Vendeur" },
  { value: "OTHER", label: "Autre" },
];

function CommerceLocationAssignments({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [userId, setUserId] = useState("");
  const [assignmentRole, setAssignmentRole] = useState<CommerceAssignmentRole>("CASHIER");
  // "" = affectation "tout le magasin" (cash_register_id NULL), comportement
  // historique par défaut -- voir assign_business_location_user.
  const [cashRegisterId, setCashRegisterId] = useState("");
  const assignmentsQuery = useQuery({
    queryKey: ["commerce-location-assignments", locationId],
    queryFn: () => getCommerceLocationAssignments({ data: { locationId } }),
    enabled: Boolean(locationId),
  });
  const registersQuery = useQuery({
    queryKey: ["commerce-cash-registers", locationId],
    queryFn: () => getCommerceCashRegisters({ data: { locationId } }),
    enabled: Boolean(locationId),
  });
  const activeRegisters = registersQuery.data?.filter((register) => register.isActive) ?? [];
  const optionsQuery = useQuery({
    queryKey: ["commerce-setup-options"],
    queryFn: () => getCommerceSetupOptions(),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["commerce-location-assignments", locationId] });
  const assignMutation = useMutation({
    mutationFn: assignCommerceLocationUser,
    onSuccess: async () => {
      toast.success("L’affectation du collaborateur est enregistrée.");
      setUserId("");
      setAssignmentRole("CASHIER");
      setCashRegisterId("");
      await refresh();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "L’affectation n’a pas pu être enregistrée.",
      ),
  });
  const endMutation = useMutation({
    mutationFn: endCommerceLocationAssignment,
    onSuccess: async () => {
      toast.success("L’accès au magasin a été retiré.");
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["commerce-pos-locations"] });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "L’affectation n’a pas pu être retirée.",
      ),
  });
  const setRole = (value: string) => {
    const selectedRole = commerceAssignmentRoles.find((role) => role.value === value);
    if (selectedRole) setAssignmentRole(selectedRole.value);
  };
  const remove = (assignmentId: string, userName: string) => {
    confirm({
      title: `Retirer l’accès de ${userName} à ce magasin ?`,
      description:
        "Ses ventes et son historique seront conservés. Le changement sera immédiatement appliqué côté base de données.",
      variant: "destructive",
      confirmLabel: "Retirer",
      onConfirm: async () => {
        await endMutation.mutateAsync({ data: { assignmentId } });
      },
    });
  };

  // CHANTIER CAISSE : créer/renommer/désactiver un poste de caisse nommé.
  // Facultatif -- un magasin sans poste continue de fonctionner exactement
  // comme avant (voir get_commerce_pos_available_registers).
  const [newRegisterName, setNewRegisterName] = useState("");
  const refreshRegisters = () =>
    queryClient.invalidateQueries({ queryKey: ["commerce-cash-registers", locationId] });
  const createRegisterMutation = useMutation({
    mutationFn: createCommerceCashRegister,
    onSuccess: async () => {
      setNewRegisterName("");
      toast.success("Poste de caisse créé.");
      await refreshRegisters();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Le poste de caisse n’a pas pu être créé.",
      ),
  });
  const toggleRegisterMutation = useMutation({
    mutationFn: updateCommerceCashRegister,
    onSuccess: async () => {
      await refreshRegisters();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Le poste de caisse n’a pas pu être mis à jour.",
      ),
  });

  return (
    <div className="space-y-4 rounded-xl border border-dashed border-border/80 p-4 md:col-span-2">
      <div className="space-y-2 border-b border-border/70 pb-4">
        <div>
          <p className="font-semibold">Postes de caisse</p>
          <p className="text-caption">
            Facultatif. Sans poste créé ici, ce magasin garde une caisse unique implicite -- comme
            aujourd’hui.
          </p>
        </div>
        {registersQuery.data?.length ? (
          <div className="flex flex-wrap gap-2">
            {registersQuery.data.map((register) => (
              <span
                key={register.id}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${register.isActive ? "border-border bg-muted/40" : "border-border/50 bg-muted/10 text-muted-foreground line-through"}`}
              >
                {register.name}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  disabled={toggleRegisterMutation.isPending}
                  onClick={() =>
                    toggleRegisterMutation.mutate({
                      data: {
                        registerId: register.id,
                        name: register.name,
                        isActive: !register.isActive,
                      },
                    })
                  }
                  title={register.isActive ? "Désactiver ce poste" : "Réactiver ce poste"}
                >
                  {register.isActive ? <X className="size-3" /> : <Check className="size-3" />}
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="new-cash-register-name">Nouveau poste</Label>
            <Input
              id="new-cash-register-name"
              value={newRegisterName}
              onChange={(event) => setNewRegisterName(event.target.value)}
              placeholder="Ex. Caisse 1"
              className="h-9 w-48"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={createRegisterMutation.isPending || !newRegisterName.trim()}
            onClick={() =>
              createRegisterMutation.mutate({
                data: { businessLocationId: locationId, name: newRegisterName.trim() },
              })
            }
          >
            {createRegisterMutation.isPending ? "Création…" : "Ajouter"}
          </Button>
        </div>
      </div>
      <div>
        <p className="font-semibold">Collaborateurs affectés</p>
        <p className="text-caption">
          Ces personnes peuvent utiliser ce point de vente selon leur rôle et leurs permissions.
        </p>
      </div>
      {assignmentsQuery.isPending ? <Skeleton className="h-20" /> : null}
      {assignmentsQuery.isError ? (
        <p className="text-caption text-destructive">
          Impossible de charger les affectations actuelles.
        </p>
      ) : null}
      {!assignmentsQuery.isPending &&
      !assignmentsQuery.isError &&
      assignmentsQuery.data?.length === 0 ? (
        <p className="rounded-lg bg-muted/40 p-3 text-caption">
          Aucun collaborateur n’est encore affecté à ce magasin.
        </p>
      ) : null}
      <div className="space-y-2">
        {assignmentsQuery.data?.map((assignment) => (
          <div
            key={assignment.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 p-3"
          >
            <div className="min-w-0">
              <p className="font-medium">{assignment.userName}</p>
              <p className="text-caption">
                {commerceAssignmentRoles.find((role) => role.value === assignment.assignmentRole)
                  ?.label ?? assignment.assignmentRole}
                {assignment.username ? ` · @${assignment.username}` : ""} ·{" "}
                {assignment.cashRegisterName ?? "Tout le magasin"}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={endMutation.isPending}
              onClick={() => remove(assignment.id, assignment.userName)}
            >
              <UserRoundX />
              Retirer
            </Button>
          </div>
        ))}
      </div>
      <div
        className={`grid gap-3 border-t border-border/70 pt-4 ${activeRegisters.length ? "md:grid-cols-[minmax(0,1fr)_180px_200px_auto]" : "md:grid-cols-[minmax(0,1fr)_220px_auto]"}`}
      >
        <div className="space-y-1">
          <Label>Collaborateur</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Choisir un utilisateur" />
            </SelectTrigger>
            <SelectContent>
              {optionsQuery.data?.users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Rôle dans ce magasin</Label>
          <Select value={assignmentRole} onValueChange={setRole}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {commerceAssignmentRoles.map((role) => (
                <SelectItem key={role.value} value={role.value}>
                  {role.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* CHANTIER CAISSE : masqué tant qu'aucun poste nommé n'existe pour ce
            magasin -- aucun ajout d'écran pour un magasin non migré. */}
        {activeRegisters.length ? (
          <div className="space-y-1">
            <Label>Poste de caisse</Label>
            <Select
              value={cashRegisterId || "__ALL__"}
              onValueChange={(value) => setCashRegisterId(value === "__ALL__" ? "" : value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">Tout le magasin</SelectItem>
                {activeRegisters.map((register) => (
                  <SelectItem key={register.id} value={register.id}>
                    {register.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="flex items-end">
          <Button
            type="button"
            disabled={assignMutation.isPending || !userId}
            onClick={() =>
              assignMutation.mutate({
                data: {
                  locationId,
                  userId,
                  assignmentRole,
                  notes: null,
                  cashRegisterId: cashRegisterId || null,
                },
              })
            }
          >
            <UserPlus />
            {assignMutation.isPending ? "Affectation…" : "Affecter"}
          </Button>
        </div>
      </div>
      <p className="text-caption">
        Réaffecter un collaborateur met à jour son rôle tout en conservant son historique
        d’affectation.
      </p>
      {dialog}
    </div>
  );
}

function CommerceLocationDialog({
  mode,
  location,
  primaryWalletId,
  onDone,
}: CommerceLocationFormProps) {
  const [open, setOpen] = useState(false);
  const isEdit = mode === "edit";
  const disabled = isEdit && (!location || !primaryWalletId);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={isEdit ? "outline" : "default"} disabled={disabled}>
          {isEdit ? <Pencil /> : <Plus />}
          {isEdit ? "Modifier" : "Nouveau magasin"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifier le magasin" : "Créer un autre magasin"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Les ventes existantes restent inchangées. Seule la configuration future du point de vente est modifiée."
              : "Chaque magasin dispose de son propre catalogue en rayon, de ses caissiers affectés et de son wallet de caisse."}
          </DialogDescription>
        </DialogHeader>
        <CommerceLocationForm
          mode={mode}
          location={location}
          primaryWalletId={primaryWalletId}
          onDone={(locationId) => {
            setOpen(false);
            onDone(locationId);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function CommerceQuickInventoryReceipt({
  locationId,
  locationName,
  onSaved,
  triggerVariant = "default",
}: {
  locationId: string;
  locationName: string;
  onSaved: () => void;
  triggerVariant?: "default" | "outline";
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // Restocking an existing article is the more frequent daily gesture than
  // creating a brand-new one -- it should be what the user sees first, not
  // an extra toggle away.
  const [mode, setMode] = useState<"new" | "restock">("restock");
  const [itemId, setItemId] = useState("");
  const quantityInputRef = useRef<HTMLInputElement>(null);
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
  // IMAGE ARTICLE : upload différé -- le fichier n'est envoyé au Storage
  // qu'à la validation du formulaire (save()), jamais avant. Un aperçu local
  // (URL.createObjectURL) évite un aller-retour réseau juste pour afficher
  // ce que l'utilisateur vient de choisir.
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const catalogueQuery = useQuery({
    queryKey: ["commerce-inventory-catalogue", locationId],
    queryFn: () => getCommerceInventoryCatalogue({ data: { locationId } }),
    enabled: open && Boolean(locationId),
  });
  const walletsQuery = useQuery({
    queryKey: ["wallets"],
    queryFn: () => getWallets(),
    enabled: open,
  });
  const selectedItem = catalogueQuery.data?.find((item) => item.id === itemId);
  const totalPurchase = Number(quantity || 0) * Number(purchaseUnitPrice || 0);
  const grossMarginPerUnit = Number(salePrice || 0) - Number(purchaseUnitPrice || 0);
  const canSubmit = Boolean(
    locationId &&
    walletId &&
    quantity &&
    purchaseUnitPrice &&
    salePrice &&
    (mode === "new" ? name.trim() : itemId),
  );
  const reset = () => {
    setMode("restock");
    setItemId("");
    setName("");
    setCategory("");
    setSku("");
    setUnit("Piece");
    setQuantity("");
    setPurchaseUnitPrice("");
    setSalePrice("");
    setWalletId("");
    setSupplier("");
    setReference("");
    setReorderLevel("");
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(null);
    setImagePreviewUrl(null);
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
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "La réception a été refusée. Aucun produit, stock ou mouvement financier n’a été enregistré.",
      ),
  });
  const selectExistingItem = (value: string) => {
    const item = catalogueQuery.data?.find((entry) => entry.id === value);
    setItemId(value);
    setSalePrice(
      item?.salePrice === null || item?.salePrice === undefined ? "" : String(item.salePrice),
    );
    setReorderLevel(
      item?.reorderLevel === null || item?.reorderLevel === undefined
        ? ""
        : String(item.reorderLevel),
    );
    // Price drifts between purchases, so it's only a starting point (stays
    // editable) -- but re-typing the exact same last cost every single
    // restock is pure friction. Quantity is deliberately NOT prefilled: how
    // much is being received now is a new fact every time, and defaulting
    // it risks a silently-wrong receipt if it's left unchanged by mistake.
    setPurchaseUnitPrice(
      item?.lastUnitCost === null || item?.lastUnitCost === undefined
        ? ""
        : String(item.lastUnitCost),
    );
    requestAnimationFrame(() => quantityInputRef.current?.focus());
  };
  const save = async () => {
    if (!canSubmit) return;
    // IMAGE ARTICLE : l'upload se fait juste avant la création, uniquement
    // en mode "new" (un réapprovisionnement ne touche jamais l'image, voir
    // la garde côté SQL) -- un échec d'upload bloque la validation avec un
    // message clair plutôt que de créer silencieusement l'article sans
    // l'image demandée.
    let imagePath: string | null = null;
    if (mode === "new" && imageFile) {
      setImageUploading(true);
      try {
        imagePath = await uploadCommerceItemImage(imageFile);
      } catch (error) {
        setImageUploading(false);
        notifyMutationError(error, "L’image n’a pas pu être envoyée. Réessayez ou retirez-la.");
        return;
      }
      setImageUploading(false);
    }
    mutation.mutate({
      data: {
        businessLocationId: locationId,
        inventoryItemId: mode === "restock" ? itemId : null,
        name: mode === "new" ? name.trim() : null,
        category: mode === "new" && category.trim() ? category.trim() : null,
        sku: mode === "new" && sku.trim() ? sku.trim() : null,
        unit: mode === "new" && unit.trim() ? unit.trim() : null,
        imagePath: mode === "new" ? imagePath : null,
        quantity: Number(quantity),
        purchaseUnitPrice: Number(purchaseUnitPrice),
        salePrice: Number(salePrice),
        walletId,
        supplier: supplier.trim() || null,
        reference: reference.trim() || null,
        reorderLevel: reorderLevel === "" ? null : Number(reorderLevel),
        movementDate: new Date().toISOString().slice(0, 10),
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen && !mutation.isPending) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant}>
          <PackagePlus /> Ajouter un produit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajouter un produit au magasin</DialogTitle>
          <DialogDescription>
            Une seule validation crée ou réapprovisionne l’article, enregistre l’achat fournisseur,
            débite le wallet choisi et place la quantité reçue dans ce magasin.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-primary/15 bg-primary/[0.06] px-4 py-3 text-sm">
          <span className="font-semibold">Magasin sélectionné : </span>
          {locationName}
          <span className="mt-1 block text-muted-foreground">
            La réception est datée d’aujourd’hui. Le stock, l’achat et la mise en rayon sont annulés
            ensemble si une étape échoue.
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-1">
          <Button
            type="button"
            size="sm"
            variant={mode === "new" ? "default" : "ghost"}
            onClick={() => setMode("new")}
          >
            Nouvel article
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "restock" ? "default" : "ghost"}
            onClick={() => setMode("restock")}
          >
            Réapprovisionner
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === "new" ? (
            <>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="commerce-receipt-name">Nom de l’article *</Label>
                <Input
                  id="commerce-receipt-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex. Chargeur rapide USB-C"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="commerce-receipt-category">
                  Catégorie <span className="font-normal text-muted-foreground">(facultatif)</span>
                </Label>
                <Input
                  id="commerce-receipt-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  placeholder="Accessoires téléphone"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="commerce-receipt-sku">
                  Référence <span className="font-normal text-muted-foreground">(facultatif)</span>
                </Label>
                <Input
                  id="commerce-receipt-sku"
                  value={sku}
                  onChange={(event) => setSku(event.target.value)}
                  placeholder="USB-C-20W"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>
                  Image de l’article{" "}
                  <span className="font-normal text-muted-foreground">(facultatif)</span>
                </Label>
                <CommerceItemImageField
                  previewUrl={imagePreviewUrl}
                  uploading={imageUploading}
                  onFileSelected={(file) => {
                    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
                    setImageFile(file);
                    setImagePreviewUrl(URL.createObjectURL(file));
                  }}
                  onRemove={() => {
                    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
                    setImageFile(null);
                    setImagePreviewUrl(null);
                  }}
                />
              </div>
            </>
          ) : (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="commerce-receipt-existing-item">Article à réapprovisionner *</Label>
              <InventoryLocationItemSelect
                id="commerce-receipt-existing-item"
                value={itemId}
                onValueChange={selectExistingItem}
                disabled={
                  catalogueQuery.isPending || catalogueQuery.isError || !catalogueQuery.data?.length
                }
                items={catalogueQuery.data ?? []}
                placeholder={
                  catalogueQuery.isPending
                    ? "Chargement…"
                    : catalogueQuery.isError
                      ? "Catalogue indisponible"
                      : catalogueQuery.data?.length
                        ? "Rechercher un article déjà créé…"
                        : "Aucun article dans le catalogue"
                }
              />
              {catalogueQuery.isError ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
                  <span>
                    Le catalogue des articles n’a pas pu être chargé. Aucune réception ne sera
                    enregistrée tant que cette erreur persiste.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void catalogueQuery.refetch()}
                  >
                    Réessayer
                  </Button>
                </div>
              ) : null}
              {catalogueQuery.isSuccess && !catalogueQuery.data.length ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    Aucun article existant à réapprovisionner. Créez d’abord l’article une seule
                    fois ; il apparaîtra ensuite ici.
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={() => setMode("new")}>
                    Nouvel article
                  </Button>
                </div>
              ) : null}
              {selectedItem ? (
                <p className="text-xs text-muted-foreground">
                  En rayon : {selectedItem.locationQuantity} {selectedItem.unit ?? "unité"} · stock
                  global : {selectedItem.globalQuantity}.
                </p>
              ) : null}
            </div>
          )}
          {mode === "new" ? (
            <div className="space-y-1">
              <Label htmlFor="commerce-receipt-unit">Unité</Label>
              <Input
                id="commerce-receipt-unit"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                placeholder="Pièce"
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="commerce-receipt-quantity">Quantité reçue *</Label>
            <Input
              ref={quantityInputRef}
              id="commerce-receipt-quantity"
              type="number"
              min="0.001"
              step="0.001"
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="commerce-receipt-purchase-price">Prix d’achat unitaire (FCFA) *</Label>
            <Input
              id="commerce-receipt-purchase-price"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={purchaseUnitPrice}
              onChange={(event) => setPurchaseUnitPrice(event.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="commerce-receipt-sale-price">Prix de vente unitaire (FCFA) *</Label>
            <Input
              id="commerce-receipt-sale-price"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={salePrice}
              onChange={(event) => setSalePrice(event.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Wallet débité pour l’achat *</Label>
            <WalletSelect
              value={walletId}
              onValueChange={setWalletId}
              placeholder="Choisir le wallet qui paie le fournisseur"
            />
            <p className="text-xs text-muted-foreground">
              Le débit est créé par le moteur financier existant, jamais manuellement.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="commerce-receipt-supplier">
              Fournisseur <span className="font-normal text-muted-foreground">(facultatif)</span>
            </Label>
            <Input
              id="commerce-receipt-supplier"
              value={supplier}
              onChange={(event) => setSupplier(event.target.value)}
              placeholder="Nom du fournisseur"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="commerce-receipt-reorder">
              Seuil d’alerte <span className="font-normal text-muted-foreground">(facultatif)</span>
            </Label>
            <Input
              id="commerce-receipt-reorder"
              type="number"
              min="0"
              step="0.001"
              inputMode="decimal"
              value={reorderLevel}
              onChange={(event) => setReorderLevel(event.target.value)}
              placeholder="Ex. 3"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="commerce-receipt-reference">
              Référence d’achat{" "}
              <span className="font-normal text-muted-foreground">(facultatif)</span>
            </Label>
            <Input
              id="commerce-receipt-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Facture fournisseur, reçu ou référence mobile money"
            />
          </div>
        </div>
        <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/[0.18] p-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Achat total
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{money(totalPurchase)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Marge brute prévisionnelle / unité
            </p>
            <p
              className={`mt-1 text-lg font-semibold tabular-nums ${grossMarginPerUnit < 0 ? "text-destructive" : "text-success"}`}
            >
              {money(grossMarginPerUnit)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Prix de vente moins prix d’achat, hors autres charges.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={mutation.isPending}
          >
            Annuler
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={!canSubmit || mutation.isPending || imageUploading}
          >
            {imageUploading
              ? "Envoi de l’image…"
              : mutation.isPending
                ? "Réception en cours…"
                : "Ajouter au magasin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const WRITE_OFF_REASONS = ["Perte ou vol", "Casse", "Péremption", "Autre"] as const;

// The deliberate mirror of CommerceQuickInventoryReceipt: same dialog
// shape, same catalogue picker -- but no price field, no wallet field at
// all. That absence is itself the visual confirmation to whoever fills it
// in that this action never touches money, only the shelf count.
function CommerceQuickInventoryWriteOff({
  locationId,
  locationName,
  onSaved,
}: {
  locationId: string;
  locationName: string;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reasonCategory, setReasonCategory] = useState<(typeof WRITE_OFF_REASONS)[number]>(
    WRITE_OFF_REASONS[0],
  );
  const [note, setNote] = useState("");
  const catalogueQuery = useQuery({
    queryKey: ["commerce-inventory-catalogue", locationId],
    queryFn: () => getCommerceInventoryCatalogue({ data: { locationId } }),
    enabled: open && Boolean(locationId),
  });
  const availableItems = useMemo(
    () => (catalogueQuery.data ?? []).filter((item) => item.locationQuantity > 0),
    [catalogueQuery.data],
  );
  const selectedItem = availableItems.find((item) => item.id === itemId);
  const reason = note.trim() ? `${reasonCategory} — ${note.trim()}` : reasonCategory;
  const quantityValue = Number(quantity || 0);
  const exceedsStock =
    Boolean(selectedItem) && quantityValue > (selectedItem?.locationQuantity ?? 0);
  const canSubmit = Boolean(locationId && itemId && quantity && quantityValue > 0 && !exceedsStock);
  const reset = () => {
    setItemId("");
    setQuantity("");
    setReasonCategory(WRITE_OFF_REASONS[0]);
    setNote("");
  };
  const mutation = useMutation({
    mutationFn: writeOffCommerceInventoryItem,
    onSuccess: async () => {
      toast.success("Retrait enregistré. Le stock de ce magasin est à jour.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["commerce-inventory-catalogue", locationId] }),
        queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", locationId] }),
        queryClient.invalidateQueries({ queryKey: ["commerce-management-dashboard", locationId] }),
        queryClient.invalidateQueries({ queryKey: ["stock-movements"] }),
      ]);
      onSaved();
      reset();
      setOpen(false);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Le retrait a été refusé. Aucun stock n’a été modifié.",
      ),
  });
  const save = () => {
    if (!canSubmit) return;
    mutation.mutate({
      data: {
        businessLocationId: locationId,
        inventoryItemId: itemId,
        quantity: quantityValue,
        reason,
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen && !mutation.isPending) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Minus /> Retirer un produit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Retirer un produit du magasin</DialogTitle>
          <DialogDescription>
            Perte, casse ou péremption : le stock de ce magasin baisse immédiatement. Aucun wallet,
            aucune écriture financière n’est créée — rien n’a été payé.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-primary/15 bg-primary/[0.06] px-4 py-3 text-sm">
          <span className="font-semibold">Magasin sélectionné : </span>
          {locationName}
        </div>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="commerce-writeoff-item">Article *</Label>
            <InventoryLocationItemSelect
              id="commerce-writeoff-item"
              value={itemId}
              onValueChange={setItemId}
              disabled={
                catalogueQuery.isPending || catalogueQuery.isError || !availableItems.length
              }
              items={availableItems}
              placeholder={
                catalogueQuery.isPending
                  ? "Chargement…"
                  : catalogueQuery.isError
                    ? "Catalogue indisponible"
                    : availableItems.length
                      ? "Rechercher un article en rayon…"
                      : "Aucun article en rayon dans ce magasin"
              }
            />
            {selectedItem ? (
              <p className="text-xs text-muted-foreground">
                En rayon : {selectedItem.locationQuantity} {selectedItem.unit ?? "unité"}.
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="commerce-writeoff-quantity">Quantité à retirer *</Label>
            <Input
              id="commerce-writeoff-quantity"
              type="number"
              min="0.001"
              step="0.001"
              max={selectedItem?.locationQuantity}
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="0"
            />
            {exceedsStock ? (
              <p className="text-xs font-medium text-destructive">
                Dépasse le stock en rayon ({selectedItem?.locationQuantity}).
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="commerce-writeoff-reason">Motif *</Label>
            <Select
              value={reasonCategory}
              onValueChange={(value) =>
                setReasonCategory(value as (typeof WRITE_OFF_REASONS)[number])
              }
            >
              <SelectTrigger id="commerce-writeoff-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WRITE_OFF_REASONS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="commerce-writeoff-note">
              Précision <span className="font-normal text-muted-foreground">(facultatif)</span>
            </Label>
            <Input
              id="commerce-writeoff-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Ex. carton tombé en réserve"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={mutation.isPending}
          >
            Annuler
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={save}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? "Retrait en cours…" : "Confirmer le retrait"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommerceInventorySetup({
  locationId,
  onSaved,
}: {
  locationId: string;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const catalogueQuery = useQuery({
    queryKey: ["commerce-inventory-catalogue", locationId],
    queryFn: () => getCommerceInventoryCatalogue({ data: { locationId } }),
    enabled: open && Boolean(locationId),
  });
  const selected = catalogueQuery.data?.find((item) => item.id === itemId);
  const mutation = useMutation({
    mutationFn: configureCommerceLocationItem,
    onSuccess: async () => {
      toast.success("Article mis en rayon. La caisse est à jour.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["commerce-inventory-catalogue", locationId] }),
        queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", locationId] }),
      ]);
      onSaved();
      setOpen(false);
    },
    onError: () =>
      toast.error("La mise en rayon a été refusée. Vérifiez la quantité disponible et vos droits."),
  });
  const selectItem = (value: string) => {
    const item = catalogueQuery.data?.find((entry) => entry.id === value);
    setItemId(value);
    setQuantity(item ? String(item.locationQuantity) : "");
    setSalePrice(
      item?.salePrice === null || item?.salePrice === undefined ? "" : String(item.salePrice),
    );
    setReorderLevel(
      item?.reorderLevel === null || item?.reorderLevel === undefined
        ? ""
        : String(item.reorderLevel),
    );
  };
  const save = () => {
    if (!selected || quantity === "" || salePrice === "") return;
    mutation.mutate({
      data: {
        businessLocationId: locationId,
        inventoryItemId: selected.id,
        quantity: Number(quantity),
        salePrice: Number(salePrice),
        reorderLevel: reorderLevel === "" ? null : Number(reorderLevel),
      },
    });
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <PackagePlus />
          Mettre en rayon
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mettre un article en rayon</DialogTitle>
          <DialogDescription>
            Cette opération répartit le stock existant vers ce magasin. Elle ne crée aucune dépense,
            recette ou modification de wallet.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label>Article existant</Label>
            <Select value={itemId} onValueChange={selectItem}>
              <SelectTrigger>
                <SelectValue
                  placeholder={catalogueQuery.isPending ? "Chargement…" : "Choisir un article"}
                />
              </SelectTrigger>
              <SelectContent>
                {catalogueQuery.data?.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                    {item.sku ? ` · ${item.sku}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected ? (
            <p className="text-caption sm:col-span-2">
              Stock global : {selected.globalQuantity} {selected.unit ?? "unité"} · encore
              affectable : {selected.availableToAllocate} {selected.unit ?? "unité"} · déjà en rayon
              : {selected.locationQuantity} {selected.unit ?? "unité"}
            </p>
          ) : null}
          <div className="space-y-1">
            <Label>Quantité en rayon</Label>
            <Input
              type="number"
              min="0"
              max={selected ? selected.locationQuantity + selected.availableToAllocate : undefined}
              step="0.001"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Prix de vente (FCFA)</Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={salePrice}
              onChange={(event) => setSalePrice(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Seuil d’alerte (facultatif)</Label>
            <Input
              type="number"
              min="0"
              step="0.001"
              value={reorderLevel}
              onChange={(event) => setReorderLevel(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            disabled={mutation.isPending || !selected || quantity === "" || salePrice === ""}
            onClick={save}
          >
            {mutation.isPending ? "Mise en rayon…" : "Enregistrer l’article"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
