import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Banknote, CircleDollarSign, Landmark, ReceiptText, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { WalletSelect } from "@/components/selects/entity-selects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/hooks/use-permissions";
import {
  cancelSupplierPayment,
  confirmSupplierPayment,
  createSupplierPayment,
  getPurchase,
  type SupplierPaymentWithWallet,
} from "@/lib/purchases.functions";
import { formatXOF as formatAmount } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/purchases/$purchaseId")({ component: PurchaseDetailsPage });

// formatDate reste locale (dateStyle "medium", ancrage midi) -- style
// différent de src/lib/format.ts, propre à cet écran.
function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`)) : "—";
}

function paymentStatusLabel(status: string) {
  const labels: Record<string, string> = { PLANNED: "Prévu", RECEIVED: "Reçu", CONFIRMED: "Confirmé", CANCELLED: "Annulé" };
  return labels[status] ?? status;
}

function paymentVariant(status: string): "outline" | "info" | "success" | "warning" | "danger" {
  if (status === "CONFIRMED") return "success";
  if (status === "RECEIVED") return "info";
  if (status === "CANCELLED") return "danger";
  return "warning";
}

function showError(fallback: string) {
  return (error: Error) => toast.error(error instanceof Error ? error.message : fallback);
}

function PurchaseDetailsPage() {
  const { purchaseId } = Route.useParams();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; label: string } | null>(null);

  const purchaseQuery = useQuery({ queryKey: ["purchase", purchaseId], queryFn: () => getPurchase({ data: purchaseId }) });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["purchase", purchaseId] });
    void queryClient.invalidateQueries({ queryKey: ["purchases"] });
    // Supplier payment confirmation debits a wallet -- without this the
    // Wallets page can show a pre-mutation balance for the rest of the
    // global staleTime window instead of refetching immediately.
    void queryClient.invalidateQueries({ queryKey: ["wallets"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet-stats"] });
  };
  const confirmPaymentMutation = useMutation({ mutationFn: confirmSupplierPayment, onSuccess: () => { toast.success("Paiement confirmé, wallet débité."); invalidate(); }, onError: showError("Impossible de confirmer le paiement.") });

  if (purchaseQuery.isPending) return <div className="p-6 text-muted-foreground">Chargement de l’achat…</div>;
  if (purchaseQuery.isError || !purchaseQuery.data) return <div className="space-y-4 p-6"><p className="text-destructive">Achat introuvable ou non autorisé.</p><Button asChild variant="outline"><Link to="/purchases"><ArrowLeft className="size-4" />Retour aux achats</Link></Button></div>;

  const detail = purchaseQuery.data;
  const { purchase, lines, payments, financial, canReadFinance } = detail;
  const canPay = can("purchases.payments") && canReadFinance;
  const canCancel = can("purchases.payments");

  return <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
    <Button asChild variant="ghost" className="-ml-2 px-2"><Link to="/purchases"><ArrowLeft className="size-4" />Achats</Link></Button>

    <OperationalHero
      variant="deep"
      icon={ReceiptText}
      eyebrow="Achat"
      title={purchase.purchase_number}
      description={`${detail.supplierName ?? "Fournisseur non accessible"} · ${detail.locationName ?? "—"} · ${formatDate(purchase.purchase_date)}`}
      primaryStat={canReadFinance ? { label: "Total achat", value: formatAmount(purchase.total_amount) } : undefined}
      secondaryStats={canReadFinance ? [{ label: "Reste dû", value: formatAmount(financial?.amount_due), tone: Number(financial?.amount_due ?? 0) > 0 ? "warning" : "success" }] : undefined}
      actions={
        <>
          <Badge variant={purchase.status === "CANCELLED" ? "danger" : "success"} appearance="soft">{purchase.status === "CANCELLED" ? "Annulé" : "Réceptionné"}</Badge>
          {canPay && financial && financial.amount_due > 0 ? <Button onClick={() => setPaymentOpen(true)}><Banknote className="size-4" />Enregistrer un paiement</Button> : null}
        </>
      }
    />

    <Tabs defaultValue="overview" className="space-y-5">
      <TabsList className="h-auto max-w-full flex-wrap justify-start"><TabsTrigger value="overview">Vue d’ensemble</TabsTrigger><TabsTrigger value="lines">Lignes</TabsTrigger>{canReadFinance ? <TabsTrigger value="payments">Paiements</TabsTrigger> : null}<TabsTrigger value="notes">Notes</TabsTrigger></TabsList>

      <TabsContent value="overview" className="space-y-5">
        {canReadFinance ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard icon={ReceiptText} label="Total achat" value={formatAmount(purchase.total_amount)} description="Montant total de l’achat" tone="neutral" />
            <MetricCard icon={CircleDollarSign} label="Payé" value={formatAmount(financial?.total_paid)} description="Total réglé au fournisseur" tone="success" />
            <MetricCard icon={Landmark} label="Reste dû" value={formatAmount(financial?.amount_due)} description="Solde dû au fournisseur" tone={Number(financial?.amount_due ?? 0) > 0 ? "warning" : "success"} />
          </div>
        ) : <Card variant="information" className="p-6"><p className="font-medium text-foreground">Informations financières protégées</p><p className="mt-1 text-sm text-muted-foreground">Votre rôle peut consulter l’achat et ses lignes, mais pas les montants payés ou restant dus.</p></Card>}
      </TabsContent>

      <TabsContent value="lines">
        <Card variant="section">
          <CardHeader><CardTitle>Articles réceptionnés</CardTitle><CardDescription>Ces lignes sont figées : un achat n’est jamais recalculé après réception.</CardDescription></CardHeader>
          <CardContent>{lines.length ? <div className="overflow-x-auto rounded-xl border border-border/75"><table className="w-full min-w-[560px] text-sm"><thead className="bg-surface-sunken/55 text-left text-caption"><tr><th className="px-4 py-3">Article</th><th className="px-4 py-3">Quantité</th><th className="px-4 py-3 text-right">Coût unitaire</th><th className="px-4 py-3 text-right">Total</th></tr></thead><tbody className="divide-y divide-border/70">{lines.map((line) => <tr key={line.id}><td className="px-4 py-3 font-medium text-foreground">{line.itemName ?? "Article"}</td><td className="px-4 py-3 tabular-nums">{Number(line.quantity).toLocaleString("fr-FR")}</td><td className="px-4 py-3 text-right tabular-nums">{formatAmount(Number(line.unit_cost))}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{formatAmount(Number(line.line_total))}</td></tr>)}</tbody></table></div> : <p className="py-10 text-center text-sm text-muted-foreground">Aucune ligne pour cet achat.</p>}</CardContent>
        </Card>
      </TabsContent>

      {canReadFinance ? <TabsContent value="payments">
        <Card variant="section">
          <CardHeader><CardTitle>Paiements fournisseur</CardTitle><CardDescription>La confirmation crée une écriture financière unique et débite le wallet choisi.</CardDescription></CardHeader>
          <CardContent>{payments.length ? <div className="space-y-3">{payments.map((payment: SupplierPaymentWithWallet) => <div key={payment.id} className="rounded-xl border border-border/75 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-foreground">{formatAmount(payment.amount)}</p><Badge variant={paymentVariant(payment.status)} appearance="soft">{paymentStatusLabel(payment.status)}</Badge></div><p className="mt-1 text-caption">{formatDate(payment.payment_date)} · Référence : {payment.reference ?? "—"}</p></div><p className="text-caption">Wallet : <span className="font-medium text-foreground">{payment.walletName ?? "Wallet autorisé"}</span></p></div><div className="mt-3 flex flex-wrap gap-2">{canPay && ["PLANNED", "RECEIVED"].includes(payment.status) ? <Button size="sm" onClick={() => confirmPaymentMutation.mutate({ data: { id: payment.id } })} loading={confirmPaymentMutation.isPending}>Confirmer dans le wallet</Button> : null}{canCancel && payment.status !== "CANCELLED" ? <Button variant="outline" size="sm" onClick={() => setCancelTarget({ id: payment.id, label: `paiement du ${formatDate(payment.payment_date)}` })}><XCircle className="size-4" />Annuler</Button> : null}</div></div>)}</div> : <p className="py-10 text-center text-sm text-muted-foreground">Aucun paiement enregistré pour cet achat.</p>}</CardContent>
        </Card>
      </TabsContent> : null}

      <TabsContent value="notes">
        <Card variant="section"><CardHeader><CardTitle>Informations complémentaires</CardTitle></CardHeader><CardContent className="space-y-4"><InfoRow label="Référence" value={purchase.reference} /><InfoRow label="Notes internes" value={purchase.notes} multiline /></CardContent></Card>
      </TabsContent>
    </Tabs>

    <CreatePaymentDialog purchaseId={purchaseId} amountDue={financial?.amount_due ?? 0} open={paymentOpen} onOpenChange={setPaymentOpen} onSaved={invalidate} />
    <CancelPaymentDialog target={cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }} onSaved={invalidate} />
  </div>;
}

function InfoRow({ label, value, multiline = false }: { label: string; value: string | null; multiline?: boolean }) {
  return <div><p className="text-label text-muted-foreground">{label}</p><p className={`mt-1 text-body-sm text-foreground ${multiline ? "whitespace-pre-wrap" : ""}`}>{value || "—"}</p></div>;
}

function CreatePaymentDialog({ purchaseId, amountDue, open, onOpenChange, onSaved }: { purchaseId: string; amountDue: number; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [walletId, setWalletId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const queryClient = useQueryClient();
  const createMutation = useMutation({ mutationFn: createSupplierPayment, onSuccess: () => { toast.success("Paiement enregistré : confirmez-le pour débiter le wallet."); onOpenChange(false); onSaved(); }, onError: showError("Impossible d’enregistrer le paiement.") });
  const confirmMutation = useMutation({
    mutationFn: async (payload: { purchaseId: string; payment: { wallet_id: string; amount: number; payment_date: string; status: "PLANNED" | "RECEIVED"; reference: string | null; notes: string | null } }) => {
      const payment = await createSupplierPayment({ data: payload });
      return confirmSupplierPayment({ data: { id: payment.id } });
    },
    onSuccess: () => { toast.success("Paiement confirmé, wallet débité."); onOpenChange(false); onSaved(); void queryClient.invalidateQueries({ queryKey: ["purchase", purchaseId] }); },
    onError: showError("Impossible de confirmer le paiement."),
  });

  function buildPayload() {
    return { purchaseId, payment: { wallet_id: walletId, amount: Number(amount), payment_date: paymentDate, status: "RECEIVED" as const, reference: reference.trim() || null, notes: notes.trim() || null } };
  }

  const canSubmit = Boolean(walletId) && Number(amount) > 0 && Number(amount) <= amountDue;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>Enregistrer un paiement fournisseur</DialogTitle><DialogDescription>Reste dû : {formatAmount(amountDue)}. Le wallet n’est débité qu’après confirmation.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2"><Label>Wallet débité</Label><WalletSelect value={walletId} onValueChange={setWalletId} placeholder="Sélectionner le wallet débité" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="supplier-payment-amount">Montant (FCFA)</Label><Input id="supplier-payment-amount" type="number" min="1" max={amountDue} value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="supplier-payment-date">Date du paiement</Label><Input id="supplier-payment-date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></div>
        </div>
        <div className="space-y-2"><Label htmlFor="supplier-payment-reference">Référence</Label><Input id="supplier-payment-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Reçu, virement, mobile money…" /></div>
        <div className="space-y-2"><Label htmlFor="supplier-payment-notes">Notes</Label><Textarea id="supplier-payment-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      </div>
      <DialogFooter className="flex-col gap-2 sm:flex-row">
        <Button variant="outline" disabled={!canSubmit || createMutation.isPending} onClick={() => createMutation.mutate({ data: buildPayload() })} loading={createMutation.isPending}>Enregistrer sans confirmer</Button>
        <Button disabled={!canSubmit || confirmMutation.isPending} onClick={() => confirmMutation.mutate(buildPayload())} loading={confirmMutation.isPending}>Enregistrer et confirmer</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function CancelPaymentDialog({ target, onOpenChange, onSaved }: { target: { id: string; label: string } | null; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: cancelSupplierPayment,
    onSuccess: () => { toast.success("Annulation enregistrée avec traçabilité."); setReason(""); onOpenChange(false); onSaved(); },
    onError: showError("Impossible d’annuler le paiement."),
  });
  return <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>Annuler {target?.label}</DialogTitle><DialogDescription>L’historique est conservé. Si le paiement était confirmé, une contre-écriture recrédite le wallet.</DialogDescription></DialogHeader>
      <div className="space-y-2"><Label htmlFor="supplier-payment-cancel-reason">Justification</Label><Textarea id="supplier-payment-cancel-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Expliquez l’annulation…" /></div>
      <DialogFooter><Button variant="danger" disabled={reason.trim().length < 3} onClick={() => { if (target) mutation.mutate({ data: { id: target.id, reason: reason.trim() } }); }} loading={mutation.isPending}>Confirmer l’annulation</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
