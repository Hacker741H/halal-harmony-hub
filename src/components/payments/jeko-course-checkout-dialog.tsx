import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Landmark, Link2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { WalletSelect } from "@/components/selects/entity-selects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatXOF as formatAmount } from "@/lib/format";
import {
  configureJekoCourseWallet,
  createJekoCourseInvoiceCheckout,
  getJekoCoursePaymentSetup,
  type JekoCheckout,
} from "@/lib/payments/jeko-course-payments.functions";
import {
  configureJekoCommercialWallet,
  createJekoCommercialInvoiceCheckout,
  getJekoCommercialPaymentSetup,
} from "@/lib/payments/jeko-commercial-payments.functions";

type PaymentMethod = "wave" | "orange" | "mtn" | "moov" | "djamo";

type JekoCheckoutDialogProps = {
  invoice: { id: string; invoice_number: string } | null;
  dueAmount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManageSettings: boolean;
  flow?: "COURSE" | "COMMERCIAL";
};

function notificationError(error: unknown) {
  toast.error(error instanceof Error ? error.message : "L’action Jèko n’a pas pu être effectuée.");
}

export function JekoInvoiceCheckoutDialog({ invoice, dueAmount, open, onOpenChange, canManageSettings, flow = "COURSE" }: JekoCheckoutDialogProps) {
  const setupQuery = useQuery({
    queryKey: ["jeko-payment-setup", flow],
    queryFn: () => flow === "COURSE" ? getJekoCoursePaymentSetup() : getJekoCommercialPaymentSetup(),
    enabled: open,
  });
  const [storeId, setStoreId] = useState("");
  const [walletId, setWalletId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("wave");
  const [checkout, setCheckout] = useState<JekoCheckout | null>(null);

  const stores = setupQuery.data ?? [];
  const selectedStore = useMemo(() => stores.find((store) => store.id === storeId) ?? null, [stores, storeId]);
  const mappedWalletId = selectedStore?.walletId ?? null;

  useEffect(() => {
    if (!open) return;
    setCheckout(null);
    setAmount(dueAmount > 0 ? String(dueAmount) : "");
  }, [dueAmount, invoice?.id, open]);

  useEffect(() => {
    // AUDIT TOTAL : ne jamais deviner silencieusement le magasin Jèko quand
    // plusieurs existent (même règle que le contexte magasin en /commerce et
    // /caisse) -- un mauvais choix ici mappe un wallet ou dirige un paiement
    // vers le mauvais magasin sans qu'aucun signal ne le montre. Auto-sélection
    // uniquement quand un seul magasin est possible ; sinon le Select reste
    // vide et affiche son placeholder, forçant un choix explicite.
    if (!storeId && stores.length === 1) setStoreId(stores[0].id);
  }, [storeId, stores]);

  useEffect(() => {
    setWalletId(mappedWalletId ?? "");
  }, [mappedWalletId]);

  const mappingMutation = useMutation({
    mutationFn: () => flow === "COURSE"
      ? configureJekoCourseWallet({ data: { storeId, walletId } })
      : configureJekoCommercialWallet({ data: { storeId, walletId } }),
    onSuccess: async () => {
      toast.success("Le magasin Jèko est maintenant associé à ce wallet.");
      await setupQuery.refetch();
    },
    onError: notificationError,
  });
  const checkoutMutation = useMutation({
    mutationFn: () => {
      const data = {
        invoiceId: invoice?.id ?? "",
        storeId,
        walletId,
        amount: Number(amount),
        paymentMethod,
      };
      return flow === "COURSE"
        ? createJekoCourseInvoiceCheckout({ data })
        : createJekoCommercialInvoiceCheckout({ data });
    },
    onSuccess: (result) => {
      setCheckout(result);
      toast.success(result.reused ? "La demande Jèko existante a été retrouvée." : "Le lien de paiement Jèko est prêt.");
    },
    onError: notificationError,
  });

  const validAmount = Number.isInteger(Number(amount)) && Number(amount) > 0 && Number(amount) <= dueAmount;
  const canCreateCheckout = Boolean(invoice && storeId && walletId && mappedWalletId === walletId && validAmount && !checkout);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Link2 className="size-5 text-primary" />Encaisser avec Jèko</DialogTitle>
        <DialogDescription>
          La demande est créée côté serveur. Le wallet n’est crédité qu’après la confirmation signée de Jèko.
        </DialogDescription>
      </DialogHeader>

      {!invoice ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Sélectionnez une facture émise.</p> : <div className="space-y-4">
        <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm">
          <p className="font-semibold text-foreground">Facture {invoice.invoice_number}</p>
          <p className="mt-1 text-muted-foreground">Reste à encaisser : <strong className="text-foreground">{formatAmount(dueAmount)}</strong></p>
        </div>

        {setupQuery.isPending ? <div className="space-y-3" aria-label="Chargement de la configuration Jèko"><div className="h-10 animate-pulse rounded-xl bg-muted" /><div className="h-10 animate-pulse rounded-xl bg-muted" /></div> : null}
        {setupQuery.isError ? <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">La configuration Jèko est indisponible. Réessayez plus tard.</p> : null}
        {!setupQuery.isPending && !setupQuery.isError && !stores.length ? <p className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm text-warning-foreground">Aucun magasin Jèko n’est disponible pour cette clé API.</p> : null}

        {stores.length ? <>
          <div className="space-y-2">
            <Label htmlFor="jeko-store">Magasin Jèko</Label>
            <Select value={storeId} onValueChange={setStoreId} disabled={Boolean(checkout)}>
              <SelectTrigger id="jeko-store"><SelectValue placeholder="Sélectionner un magasin" /></SelectTrigger>
              <SelectContent>{stores.map((store) => <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {selectedStore?.walletId ? <div className="rounded-xl border border-success/25 bg-success/5 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-success-foreground"><ShieldCheck className="size-4" />Wallet de destination vérifié</div>
            <p className="mt-1 text-muted-foreground">{selectedStore.walletName ?? "Wallet associé"}</p>
          </div> : <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm">
            <p className="font-medium text-warning-foreground">Aucun wallet ERP n’est encore associé à ce magasin Jèko.</p>
            {canManageSettings ? <div className="mt-3 space-y-3"><WalletSelect value={walletId} onValueChange={setWalletId} placeholder="Sélectionner le wallet à créditer" /><Button variant="outline" size="sm" disabled={!storeId || !walletId} loading={mappingMutation.isPending} onClick={() => mappingMutation.mutate()}><Landmark className="size-4" />Associer ce wallet</Button></div> : <p className="mt-2 text-muted-foreground">Un administrateur doit effectuer cette association une seule fois.</p>}
          </div>}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="jeko-amount">Montant (FCFA)</Label><Input id="jeko-amount" type="number" min="1" max={dueAmount} step="1" value={amount} disabled={Boolean(checkout)} onChange={(event) => setAmount(event.target.value)} /></div>
            <div className="space-y-2"><Label>Moyen de paiement</Label><Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)} disabled={Boolean(checkout)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="wave">Wave</SelectItem><SelectItem value="orange">Orange Money</SelectItem><SelectItem value="mtn">MTN MoMo</SelectItem><SelectItem value="moov">Moov Money</SelectItem><SelectItem value="djamo">Djamo</SelectItem></SelectContent></Select></div>
          </div>

          {Number(amount) > dueAmount ? <p className="text-sm text-destructive">Le montant ne peut pas dépasser le reste à encaisser.</p> : null}
          {checkout ? <div className="rounded-xl border border-info/25 bg-info/5 p-4 text-sm"><div className="flex items-center gap-2 font-medium text-info-foreground"><ShieldCheck className="size-4" />Demande Jèko enregistrée</div><p className="mt-1 text-muted-foreground">Référence : {checkout.reference} · {formatAmount(checkout.amount)}</p>{checkout.checkoutUrl ? <p className="mt-2 text-muted-foreground">Ouvrez le paiement, puis revenez ici : le crédit du wallet apparaîtra seulement après le webhook confirmé.</p> : <p className="mt-2 text-muted-foreground">La demande est déjà en attente chez Jèko. Retrouvez-la dans le cockpit Jèko si aucun lien n’est disponible.</p>}</div> : null}
        </> : null}
      </div>}

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button>
        {checkout?.checkoutUrl ? <Button onClick={() => window.open(checkout.checkoutUrl ?? "", "_blank", "noopener,noreferrer")}><ExternalLink className="size-4" />Ouvrir le paiement Jèko</Button> : <Button disabled={!canCreateCheckout || checkoutMutation.isPending} loading={checkoutMutation.isPending} onClick={() => checkoutMutation.mutate()}><Link2 className="size-4" />Créer le lien Jèko</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** Compatibility wrapper for the existing Course invoice checkout. */
export function JekoCourseCheckoutDialog(props: Omit<JekoCheckoutDialogProps, "flow">) {
  return <JekoInvoiceCheckoutDialog {...props} flow="COURSE" />;
}
