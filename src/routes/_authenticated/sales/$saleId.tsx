import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Banknote, Building2, CalendarDays, CheckCircle2, CircleDollarSign, FileText, Landmark, Pencil, ReceiptText, RotateCcw, Sprout, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CommercialSaleForm } from "@/components/commercial/commercial-sale-form";
import { JekoInvoiceCheckoutDialog } from "@/components/payments/jeko-course-checkout-dialog";
import { WalletSelect } from "@/components/selects/entity-selects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/hooks/use-permissions";
import {
  cancelCommerceSaleRefund,
  confirmCommerceSaleRefund,
  createCommerceSaleRefund,
  createCommerceSaleReturn,
  RETURN_DISPOSITIONS,
  type CommerceSaleRefund,
} from "@/lib/commerce-sale-returns.functions";
import {
  cancelCommercialInvoice,
  cancelCommercialInvoicePayment,
  cancelCommercialSale,
  confirmCommercialInvoicePayment,
  confirmCommercialSale,
  createCommercialInvoice,
  createCommercialInvoicePayment,
  getCommercialSale,
  issueCommercialInvoice,
  type CommercialInvoice,
  type CommercialInvoicePaymentWithWallet,
  type CommercialSaleLine,
  type CommerceSaleReturnWithLines,
} from "@/lib/commercial-sales.functions";

export const Route = createFileRoute("/_authenticated/sales/$saleId")({ component: CommercialSaleDetailsPage });

function formatAmount(value: number | null | undefined) {
  return `${Number(value ?? 0).toLocaleString("fr-FR")} FCFA`;
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`)) : "—";
}

function saleStatus(status: string) {
  const labels: Record<string, string> = { DRAFT: "Brouillon", CONFIRMED: "Confirmée", CANCELLED: "Annulée", ARCHIVED: "Archivée" };
  return labels[status] ?? status;
}

function invoiceStatus(status: string) {
  const labels: Record<string, string> = { DRAFT: "Brouillon", ISSUED: "Émise", PARTIALLY_PAID: "Partiellement payée", PAID: "Payée", CANCELLED: "Annulée" };
  return labels[status] ?? status;
}

function paymentStatus(status: string) {
  const labels: Record<string, string> = { PLANNED: "Prévu", RECEIVED: "Reçu", CONFIRMED: "Confirmé", CANCELLED: "Annulé" };
  return labels[status] ?? status;
}

function saleVariant(status: string): "outline" | "success" | "danger" | "neutral" {
  if (status === "CONFIRMED") return "success";
  if (status === "CANCELLED") return "danger";
  if (status === "ARCHIVED") return "neutral";
  return "outline";
}

function invoiceVariant(status: string): "outline" | "info" | "success" | "warning" | "danger" {
  if (status === "PAID") return "success";
  if (status === "PARTIALLY_PAID") return "warning";
  if (status === "ISSUED") return "info";
  if (status === "CANCELLED") return "danger";
  return "outline";
}

function paymentVariant(status: string): "outline" | "info" | "success" | "warning" | "danger" {
  if (status === "CONFIRMED") return "success";
  if (status === "RECEIVED") return "info";
  if (status === "CANCELLED") return "danger";
  return "warning";
}

function refundVariant(status: string): "outline" | "success" | "warning" | "danger" {
  if (status === "CONFIRMED") return "success";
  if (status === "CANCELLED") return "danger";
  return "warning";
}

function refundStatusLabel(status: string) {
  const labels: Record<string, string> = { PLANNED: "Prévu", CONFIRMED: "Confirmé", CANCELLED: "Annulé" };
  return labels[status] ?? status;
}

function dispositionLabel(disposition: string | null) {
  if (!disposition) return "Sans impact stock";
  const labels: Record<string, string> = { RESTOCK: "Remis en stock", DAMAGED: "Endommagé", SCRAPPED: "Détruit" };
  return labels[disposition] ?? disposition;
}

function CommercialSaleDetailsPage() {
  const { saleId } = Route.useParams();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [editOpen, setEditOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<CommercialInvoice | null>(null);
  const [jekoInvoice, setJekoInvoice] = useState<CommercialInvoice | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ kind: "sale" | "invoice" | "payment"; id: string; label: string } | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundCancelTarget, setRefundCancelTarget] = useState<CommerceSaleRefund | null>(null);

  const saleQuery = useQuery({ queryKey: ["commercial-sale", saleId], queryFn: () => getCommercialSale({ data: saleId }) });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["commercial-sale", saleId] });
    void queryClient.invalidateQueries({ queryKey: ["commercial-sales"] });
    // Payment/refund confirmation on this screen moves a wallet balance --
    // without this the Wallets page can show a pre-mutation balance for the
    // rest of the global staleTime window instead of refetching immediately.
    void queryClient.invalidateQueries({ queryKey: ["wallets"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet-stats"] });
  };
  const confirmSaleMutation = useMutation({ mutationFn: confirmCommercialSale, onSuccess: () => { toast.success("Vente confirmée."); invalidate(); }, onError: showError("Impossible de confirmer la vente.") });
  const issueInvoiceMutation = useMutation({ mutationFn: issueCommercialInvoice, onSuccess: () => { toast.success("Facture émise."); invalidate(); }, onError: showError("Impossible d’émettre la facture.") });
  const confirmPaymentMutation = useMutation({ mutationFn: confirmCommercialInvoicePayment, onSuccess: () => { toast.success("Encaissement confirmé dans le wallet choisi."); invalidate(); }, onError: showError("Impossible de confirmer l’encaissement.") });
  const confirmRefundMutation = useMutation({ mutationFn: confirmCommerceSaleRefund, onSuccess: () => { toast.success("Remboursement confirmé, wallet débité."); invalidate(); }, onError: showError("Impossible de confirmer le remboursement.") });
  const cancelRefundMutation = useMutation({
    mutationFn: cancelCommerceSaleRefund,
    onSuccess: () => { toast.success("Remboursement annulé."); setRefundCancelTarget(null); invalidate(); },
    onError: showError("Impossible d’annuler le remboursement."),
  });

  if (saleQuery.isPending) return <div className="p-6 text-muted-foreground">Chargement de la vente…</div>;
  if (saleQuery.isError || !saleQuery.data) return <div className="space-y-4 p-6"><p className="text-destructive">Vente introuvable ou non autorisée.</p><Button asChild variant="outline"><Link to="/sales"><ArrowLeft className="size-4" />Retour aux ventes</Link></Button></div>;

  const detail = saleQuery.data;
  const { sale, lines, invoices, payments, financial, canReadFinance, returns, refunds, returnedByLine, canReadReturns } = detail;
  const activeInvoice = invoices.find((invoice) => invoice.status !== "CANCELLED") ?? null;
  const canEdit = can("sales.update") && sale.status === "DRAFT";
  const canInvoice = can("sales.invoice") && sale.status === "CONFIRMED";
  const canPayment = can("sales.payments") && canReadFinance;
  const canManageSettings = can("settings.manage");
  const canCancel = can("sales.cancel");
  const canReturn = can("sales.returns.create") && sale.status === "CONFIRMED";
  const canRefund = can("sales.refunds.manage");
  const returnableLines = lines.filter((line) => line.line_type === "ARTICLE" && Number(line.quantity) - (returnedByLine[line.id] ?? 0) > 0);
  const jekoInvoiceDue = jekoInvoice
    ? Math.max(0, Number(jekoInvoice.total_amount) - payments.filter((payment) => payment.invoice_id === jekoInvoice.id && payment.status === "CONFIRMED").reduce((sum, payment) => sum + Number(payment.amount), 0))
    : 0;

  return <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
    <section className="relative isolate overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-surface-elevated to-surface p-5 shadow-md sm:p-7">
      <div className="pointer-events-none absolute -right-16 -top-20 size-60 rounded-full bg-primary/15 blur-3xl" aria-hidden="true" />
      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><Button asChild variant="ghost" className="-ml-2 px-2"><Link to="/sales"><ArrowLeft className="size-4" />Ventes</Link></Button><div className="mt-4 flex flex-wrap items-center gap-3"><h1 className="text-h1">{sale.sale_number}</h1><Badge variant={saleVariant(sale.status)} appearance="soft">{saleStatus(sale.status)}</Badge></div><p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-body-sm text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Building2 className="size-4 text-primary" aria-hidden="true" />{detail.clientName ?? "Client non accessible"}</span><span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4 text-primary" aria-hidden="true" />{formatDate(sale.sale_date)}</span>{detail.farmName ? <span className="inline-flex items-center gap-1.5"><Sprout className="size-4 text-success" aria-hidden="true" />{detail.farmName}</span> : null}</p></div>
        <div className="flex flex-wrap gap-2 xl:justify-end">{canEdit ? <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="size-4" />Modifier</Button> : null}{canEdit ? <Button onClick={() => confirmSaleMutation.mutate({ data: { id: sale.id } })} loading={confirmSaleMutation.isPending}>Confirmer la vente</Button> : null}{canInvoice && !activeInvoice ? <Button onClick={() => setInvoiceOpen(true)}><FileText className="size-4" />Créer la facture</Button> : null}{canReturn && returnableLines.length > 0 ? <Button variant="outline" onClick={() => setReturnOpen(true)}><RotateCcw className="size-4" />Enregistrer un retour</Button> : null}{canRefund && (financial?.refundable_credit ?? 0) > 0 ? <Button variant="outline" onClick={() => setRefundOpen(true)}><Banknote className="size-4" />Enregistrer un remboursement</Button> : null}{canCancel && (sale.status === "DRAFT" || (sale.status === "CONFIRMED" && !activeInvoice)) ? <Button variant="danger" onClick={() => setCancelTarget({ kind: "sale", id: sale.id, label: sale.sale_number })}><XCircle className="size-4" />Annuler la vente</Button> : null}</div>
      </div>
    </section>

    {canPayment && activeInvoice && ["ISSUED", "PARTIALLY_PAID"].includes(activeInvoice.status) ? <Card variant="information" className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-foreground">Encaissement en ligne Jèko</p><p className="mt-1 text-sm text-muted-foreground">Créez un lien de paiement sécurisé. Le wallet associé ne sera crédité qu’après confirmation du webhook Jèko.</p></div><Button variant="outline" onClick={() => setJekoInvoice(activeInvoice)}><Landmark className="size-4" />Encaisser avec Jèko</Button></Card> : null}

    <Tabs defaultValue="overview" className="space-y-5"><TabsList className="h-auto max-w-full flex-wrap justify-start"><TabsTrigger value="overview">Vue d’ensemble</TabsTrigger><TabsTrigger value="lines">Lignes</TabsTrigger>{canReadFinance ? <><TabsTrigger value="invoices">Factures</TabsTrigger><TabsTrigger value="payments">Encaissements</TabsTrigger></> : null}{canReadReturns ? <><TabsTrigger value="returns">Retours</TabsTrigger><TabsTrigger value="refunds">Remboursements</TabsTrigger></> : null}<TabsTrigger value="notes">Notes</TabsTrigger></TabsList>
      <TabsContent value="overview" className="space-y-5">
        {canReadFinance ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard icon={CircleDollarSign} label="Facturé" value={formatAmount(financial?.total_invoiced)} detail="Total des factures émises" tone="info" /><MetricCard icon={Banknote} label="Encaissé" value={formatAmount(financial?.total_received)} detail="Paiements confirmés" tone="success" /><MetricCard icon={Landmark} label="Reste à encaisser" value={formatAmount(financial?.amount_due)} detail="Solde client actuel, net des retours" tone={Number(financial?.amount_due ?? 0) > 0 ? "warning" : "success"} /><MetricCard icon={ReceiptText} label="Total de vente" value={formatAmount(financial?.subtotal_amount)} detail="Hors taxes configurées" tone="neutral" /></div> : <PermissionPanel />}
        {canReadFinance && (Number(financial?.total_returned ?? 0) > 0 || Number(financial?.refundable_credit ?? 0) > 0) ? <div className="grid gap-4 sm:grid-cols-2"><MetricCard icon={RotateCcw} label="Retourné" value={formatAmount(financial?.total_returned)} detail="Valeur totale des retours" tone="warning" /><MetricCard icon={Banknote} label="Crédit remboursable" value={formatAmount(financial?.refundable_credit)} detail="Reste à rendre au client" tone={Number(financial?.refundable_credit ?? 0) > 0 ? "warning" : "success"} /></div> : null}
        <Card variant="section"><CardHeader><CardTitle>Situation de la vente</CardTitle><CardDescription>Les étapes sont protégées : une vente est confirmée avant toute facturation, puis chaque encaissement crédite le wallet choisi uniquement après confirmation.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-3"><Step label="1. Vente" detail={saleStatus(sale.status)} completed={["CONFIRMED", "ARCHIVED"].includes(sale.status)} /><Step label="2. Facture" detail={activeInvoice ? invoiceStatus(activeInvoice.status) : "À créer"} completed={activeInvoice?.status === "ISSUED" || activeInvoice?.status === "PARTIALLY_PAID" || activeInvoice?.status === "PAID"} /><Step label="3. Encaissement" detail={financial?.amount_due === 0 && activeInvoice ? "Soldé" : canReadFinance ? "À suivre" : "Accès financier requis"} completed={canReadFinance && Boolean(activeInvoice) && Number(financial?.amount_due ?? 0) === 0} /></CardContent></Card>
      </TabsContent>
      <TabsContent value="lines"><Card variant="section"><CardHeader><CardTitle>Produits et prestations vendus</CardTitle><CardDescription>Les montants proviennent des lignes de vente enregistrées lors de la création.</CardDescription></CardHeader><CardContent>{lines.length ? <div className="overflow-x-auto rounded-xl border border-border/75"><table className="w-full min-w-[620px] text-sm"><thead className="bg-surface-sunken/55 text-left text-caption"><tr><th className="px-4 py-3">Désignation</th><th className="px-4 py-3">Quantité</th><th className="px-4 py-3">Unité</th><th className="px-4 py-3 text-right">Prix unitaire</th><th className="px-4 py-3 text-right">Total</th>{canReadReturns ? <><th className="px-4 py-3 text-right">Déjà retourné</th><th className="px-4 py-3 text-right">Restant retournable</th></> : null}</tr></thead><tbody className="divide-y divide-border/70">{lines.map((line) => { const returned = returnedByLine[line.id] ?? 0; return <tr key={line.id}><td className="px-4 py-3 font-medium text-foreground">{line.description}</td><td className="px-4 py-3 tabular-nums">{Number(line.quantity).toLocaleString("fr-FR")}</td><td className="px-4 py-3">{line.unit}</td><td className="px-4 py-3 text-right tabular-nums">{formatAmount(Number(line.unit_price))}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{formatAmount(Number(line.line_total))}</td>{canReadReturns ? <><td className="px-4 py-3 text-right tabular-nums">{line.line_type === "ARTICLE" ? Number(returned).toLocaleString("fr-FR") : "—"}</td><td className="px-4 py-3 text-right tabular-nums">{line.line_type === "ARTICLE" ? Number(line.quantity - returned).toLocaleString("fr-FR") : "—"}</td></> : null}</tr>; })}</tbody></table></div> : <EmptyPanel>Aucune ligne de vente n’est disponible.</EmptyPanel>}</CardContent></Card></TabsContent>
      {canReadFinance ? <TabsContent value="invoices"><InvoicesPanel invoices={invoices} canInvoice={canInvoice} canCancel={canCancel} issuePending={issueInvoiceMutation.isPending} onIssue={(invoiceId) => issueInvoiceMutation.mutate({ data: { id: invoiceId } })} onCreate={() => setInvoiceOpen(true)} onCancel={(invoice) => setCancelTarget({ kind: "invoice", id: invoice.id, label: invoice.invoice_number })} /></TabsContent> : null}
      {canReadFinance ? <TabsContent value="payments"><PaymentsPanel payments={payments} invoices={invoices} canPayment={canPayment} canCancel={canCancel} confirmPending={confirmPaymentMutation.isPending} onNew={(invoice) => setPaymentInvoice(invoice)} onConfirm={(paymentId) => confirmPaymentMutation.mutate({ data: { id: paymentId } })} onCancel={(payment) => setCancelTarget({ kind: "payment", id: payment.id, label: `paiement du ${formatDate(payment.payment_date)}` })} /></TabsContent> : null}
      {canReadReturns ? <TabsContent value="returns"><ReturnsPanel returns={returns} /></TabsContent> : null}
      {canReadReturns ? <TabsContent value="refunds"><RefundsPanel refunds={refunds} canRefund={canRefund} onConfirm={(id) => confirmRefundMutation.mutate({ data: { id } })} confirmPending={confirmRefundMutation.isPending} onCancel={(refund) => setRefundCancelTarget(refund)} /></TabsContent> : null}
      <TabsContent value="notes"><Card variant="section"><CardHeader><CardTitle>Informations complémentaires</CardTitle></CardHeader><CardContent className="space-y-4"><InfoRow label="Référence" value={sale.reference} /><InfoRow label="Notes internes" value={sale.notes} multiline />{sale.cancelled_at ? <InfoRow label="Annulée le" value={new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(sale.cancelled_at))} /> : null}<p className="rounded-lg border border-dashed border-border/80 bg-surface-sunken/30 p-4 text-caption">Les documents commerciaux sont prévus par le socle technique, mais leur écran d’attachement sera raccordé au module Documents sans lien fictif ni duplication.</p></CardContent></Card></TabsContent>
    </Tabs>

    <Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>Modifier la vente</DialogTitle></DialogHeader><CommercialSaleForm sale={sale} lines={lines} onSuccess={() => { setEditOpen(false); invalidate(); }} /></DialogContent></Dialog>
    <CreateInvoiceDialog saleId={saleId} open={invoiceOpen} onOpenChange={setInvoiceOpen} onSaved={invalidate} />
    <CreatePaymentDialog invoice={paymentInvoice} open={Boolean(paymentInvoice)} onOpenChange={(open) => { if (!open) setPaymentInvoice(null); }} onSaved={invalidate} />
    <JekoInvoiceCheckoutDialog flow="COMMERCIAL" invoice={jekoInvoice} dueAmount={jekoInvoiceDue} open={Boolean(jekoInvoice)} onOpenChange={(open) => { if (!open) setJekoInvoice(null); }} canManageSettings={canManageSettings} />
    <CancelDialog target={cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }} onSaved={invalidate} />
    <CreateReturnDialog saleId={saleId} lines={returnableLines} returnedByLine={returnedByLine} open={returnOpen} onOpenChange={setReturnOpen} onSaved={invalidate} />
    <CreateRefundDialog saleId={saleId} refundableCredit={Number(financial?.refundable_credit ?? 0)} open={refundOpen} onOpenChange={setRefundOpen} onSaved={invalidate} />
    <RefundCancelDialog target={refundCancelTarget} onOpenChange={(open) => { if (!open) setRefundCancelTarget(null); }} onConfirm={(reason) => { if (refundCancelTarget) cancelRefundMutation.mutate({ data: { id: refundCancelTarget.id, reason } }); }} pending={cancelRefundMutation.isPending} />
  </div>;
}

function showError(fallback: string) {
  return (error: Error) => toast.error(error instanceof Error ? error.message : fallback);
}

function MetricCard({ icon: Icon, label, value, detail, tone }: { icon: typeof CircleDollarSign; label: string; value: string; detail: string; tone: "info" | "success" | "warning" | "neutral" }) {
  const tones = { info: "bg-info/10 text-info", success: "bg-success/10 text-success", warning: "bg-warning/15 text-warning-foreground", neutral: "bg-muted text-muted-foreground" };
  return <Card variant="kpi" className="p-5"><div className="flex items-start justify-between gap-3"><p className="text-label text-muted-foreground">{label}</p><div className={`grid size-9 place-items-center rounded-xl ${tones[tone]}`}><Icon className="size-4" aria-hidden="true" /></div></div><p className="mt-6 truncate text-[clamp(1.3rem,2vw,1.9rem)] font-semibold tracking-[-0.03em] tabular-nums" title={value}>{value}</p><p className="mt-2 text-caption">{detail}</p></Card>;
}

function Step({ label, detail, completed }: { label: string; detail: string; completed: boolean }) {
  return <div className="rounded-xl border border-border/75 bg-surface-sunken/30 p-4"><div className="flex items-center gap-2"><CheckCircle2 className={`size-4 ${completed ? "text-success" : "text-muted-foreground"}`} aria-hidden="true" /><p className="font-medium text-foreground">{label}</p></div><p className="mt-2 text-caption">{detail}</p></div>;
}

function EmptyPanel({ children }: { children: string }) { return <p className="rounded-xl border border-dashed border-border/80 py-10 text-center text-sm text-muted-foreground">{children}</p>; }
function PermissionPanel() { return <Card variant="information" className="p-6"><p className="font-medium text-foreground">Informations financières protégées</p><p className="mt-1 text-sm text-muted-foreground">Votre rôle peut consulter la vente et ses lignes, mais pas les montants facturés, encaissés ou restant dus.</p></Card>; }
function InfoRow({ label, value, multiline = false }: { label: string; value: string | null; multiline?: boolean }) { return <div><p className="text-label text-muted-foreground">{label}</p><p className={`mt-1 text-body-sm text-foreground ${multiline ? "whitespace-pre-wrap" : ""}`}>{value || "—"}</p></div>; }

function InvoicesPanel({ invoices, canInvoice, canCancel, issuePending, onIssue, onCreate, onCancel }: { invoices: CommercialInvoice[]; canInvoice: boolean; canCancel: boolean; issuePending: boolean; onIssue: (id: string) => void; onCreate: () => void; onCancel: (invoice: CommercialInvoice) => void }) {
  return <Card variant="section"><CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>Factures</CardTitle><CardDescription>Une seule facture active est autorisée par vente.</CardDescription></div>{canInvoice && !invoices.some((invoice) => invoice.status !== "CANCELLED") ? <Button size="sm" onClick={onCreate}><FileText className="size-4" />Créer la facture</Button> : null}</CardHeader><CardContent>{invoices.length ? <div className="space-y-3">{invoices.map((invoice) => <div key={invoice.id} className="rounded-xl border border-border/75 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-foreground">{invoice.invoice_number}</p><Badge variant={invoiceVariant(invoice.status)} appearance="soft">{invoiceStatus(invoice.status)}</Badge></div><p className="mt-1 text-caption">Échéance : {formatDate(invoice.due_date)} · TVA : {Number(invoice.tax_rate).toLocaleString("fr-FR")} %</p></div><p className="font-semibold tabular-nums text-foreground">{formatAmount(Number(invoice.total_amount))}</p></div><div className="mt-3 flex flex-wrap gap-2">{canInvoice && invoice.status === "DRAFT" ? <Button size="sm" onClick={() => onIssue(invoice.id)} loading={issuePending}>Émettre la facture</Button> : null}{canCancel && !["CANCELLED", "PAID"].includes(invoice.status) ? <Button variant="outline" size="sm" onClick={() => onCancel(invoice)}>Annuler la facture</Button> : null}</div></div>)}</div> : <EmptyPanel>Aucune facture n’a encore été créée pour cette vente.</EmptyPanel>}</CardContent></Card>;
}

function ReturnsPanel({ returns }: { returns: CommerceSaleReturnWithLines[] }) {
  return <Card variant="section"><CardHeader><CardTitle>Retours</CardTitle><CardDescription>Chaque retour est un événement séparé : la vente d’origine n’est jamais modifiée.</CardDescription></CardHeader><CardContent>{returns.length ? <div className="space-y-3">{returns.map((saleReturn) => <div key={saleReturn.id} className="rounded-xl border border-border/75 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-foreground">{saleReturn.return_number}</p><p className="text-caption">{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${saleReturn.return_date}T12:00:00`))}</p></div><p className="mt-1 text-caption">Motif : {saleReturn.reason}</p><div className="mt-3 space-y-2">{saleReturn.lines.map((line) => <div key={line.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-sunken/40 px-3 py-2 text-sm"><span className="font-medium text-foreground">{line.itemName ?? "Article"} · {Number(line.quantity_returned).toLocaleString("fr-FR")}</span><Badge variant={line.disposition === "RESTOCK" ? "success" : line.disposition ? "warning" : "outline"} appearance="soft">{dispositionLabel(line.disposition)}</Badge></div>)}</div></div>)}</div> : <EmptyPanel>Aucun retour n’a été enregistré pour cette vente.</EmptyPanel>}</CardContent></Card>;
}

function RefundsPanel({ refunds, canRefund, confirmPending, onConfirm, onCancel }: { refunds: CommerceSaleRefund[]; canRefund: boolean; confirmPending: boolean; onConfirm: (id: string) => void; onCancel: (refund: CommerceSaleRefund) => void }) {
  return <Card variant="section"><CardHeader><CardTitle>Remboursements</CardTitle><CardDescription>La confirmation débite le wallet choisi du montant exact.</CardDescription></CardHeader><CardContent>{refunds.length ? <div className="space-y-3">{refunds.map((refund) => <div key={refund.id} className="rounded-xl border border-border/75 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-foreground">{formatAmount(Number(refund.amount))}</p><Badge variant={refundVariant(refund.status)} appearance="soft">{refundStatusLabel(refund.status)}</Badge></div><p className="mt-1 text-caption">{formatDate(refund.refund_date)} · {refund.refund_number}{refund.reference ? ` · Référence : ${refund.reference}` : ""}</p></div></div><div className="mt-3 flex flex-wrap gap-2">{canRefund && refund.status === "PLANNED" ? <Button size="sm" onClick={() => onConfirm(refund.id)} loading={confirmPending}>Confirmer dans le wallet</Button> : null}{canRefund && refund.status !== "CANCELLED" ? <Button variant="outline" size="sm" onClick={() => onCancel(refund)}>Annuler</Button> : null}</div></div>)}</div> : <EmptyPanel>Aucun remboursement n’a été enregistré pour cette vente.</EmptyPanel>}</CardContent></Card>;
}

function PaymentsPanel({ payments, invoices, canPayment, canCancel, confirmPending, onNew, onConfirm, onCancel }: { payments: CommercialInvoicePaymentWithWallet[]; invoices: CommercialInvoice[]; canPayment: boolean; canCancel: boolean; confirmPending: boolean; onNew: (invoice: CommercialInvoice) => void; onConfirm: (paymentId: string) => void; onCancel: (payment: CommercialInvoicePaymentWithWallet) => void }) {
  const payableInvoice = invoices.find((invoice) => ["ISSUED", "PARTIALLY_PAID"].includes(invoice.status)) ?? null;
  return <Card variant="section"><CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>Encaissements</CardTitle><CardDescription>La confirmation crée une écriture financière unique et crédite le wallet sélectionné.</CardDescription></div>{canPayment && payableInvoice ? <Button size="sm" onClick={() => onNew(payableInvoice)}><Banknote className="size-4" />Ajouter un encaissement</Button> : null}</CardHeader><CardContent>{payments.length ? <div className="space-y-3">{payments.map((payment) => <div key={payment.id} className="rounded-xl border border-border/75 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-foreground">{formatAmount(Number(payment.amount))}</p><Badge variant={paymentVariant(payment.status)} appearance="soft">{paymentStatus(payment.status)}</Badge></div><p className="mt-1 text-caption">{formatDate(payment.payment_date)} · {payment.payment_kind} · Référence : {payment.reference ?? "—"}</p></div><p className="text-caption">Wallet : <span className="font-medium text-foreground">{payment.walletName ?? "Wallet autorisé"}</span></p></div><div className="mt-3 flex flex-wrap gap-2">{canPayment && ["PLANNED", "RECEIVED"].includes(payment.status) ? <Button size="sm" onClick={() => onConfirm(payment.id)} loading={confirmPending}>Confirmer dans le wallet</Button> : null}{canCancel && !["CONFIRMED", "CANCELLED"].includes(payment.status) ? <Button variant="outline" size="sm" onClick={() => onCancel(payment)}>Annuler le paiement</Button> : null}</div></div>)}</div> : <EmptyPanel>Aucun encaissement n’a été enregistré pour cette vente.</EmptyPanel>}</CardContent></Card>;
}

function CreateInvoiceDialog({ saleId, open, onOpenChange, onSaved }: { saleId: string; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [dueDate, setDueDate] = useState(""); const [taxRate, setTaxRate] = useState(""); const [notes, setNotes] = useState("");
  const mutation = useMutation({ mutationFn: createCommercialInvoice, onSuccess: () => { toast.success("Facture brouillon créée."); onOpenChange(false); onSaved(); }, onError: showError("Impossible de créer la facture.") });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Créer la facture</DialogTitle><DialogDescription>La facture reprend automatiquement les lignes de vente. La TVA reste facultative.</DialogDescription></DialogHeader><div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="invoice-due-date">Date d’échéance</Label><Input id="invoice-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="invoice-tax-rate">TVA (%)</Label><Input id="invoice-tax-rate" type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} placeholder="0" /></div></div><div className="space-y-2"><Label htmlFor="invoice-notes">Notes</Label><Textarea id="invoice-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Informations complémentaires…" /></div></div><DialogFooter><Button onClick={() => mutation.mutate({ data: { saleId, invoice: { due_date: dueDate || null, tax_rate: taxRate === "" ? null : Number(taxRate), notes: notes.trim() || null } } })} loading={mutation.isPending}>Créer la facture</Button></DialogFooter></DialogContent></Dialog>;
}

function CreatePaymentDialog({ invoice, open, onOpenChange, onSaved }: { invoice: CommercialInvoice | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [walletId, setWalletId] = useState(""); const [amount, setAmount] = useState(""); const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10)); const [kind, setKind] = useState<"DEPOSIT" | "PAYMENT" | "SETTLEMENT" | "REFUND">("PAYMENT"); const [reference, setReference] = useState(""); const [notes, setNotes] = useState("");
  const mutation = useMutation({ mutationFn: createCommercialInvoicePayment, onSuccess: () => { toast.success("Encaissement enregistré : confirmez-le pour créditer le wallet."); onOpenChange(false); onSaved(); }, onError: showError("Impossible d’enregistrer l’encaissement.") });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Enregistrer un encaissement</DialogTitle><DialogDescription>Le wallet n’est crédité qu’après confirmation explicite par un rôle autorisé.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>Wallet de destination</Label><WalletSelect value={walletId} onValueChange={setWalletId} placeholder="Sélectionner le wallet crédité" /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="payment-amount">Montant (FCFA)</Label><Input id="payment-amount" type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="payment-date">Date du paiement</Label><Input id="payment-date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></div></div><div className="space-y-2"><Label>Nature</Label><Select value={kind} onValueChange={(value) => setKind(value as "DEPOSIT" | "PAYMENT" | "SETTLEMENT" | "REFUND")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="DEPOSIT">Acompte</SelectItem><SelectItem value="PAYMENT">Paiement</SelectItem><SelectItem value="SETTLEMENT">Règlement</SelectItem><SelectItem value="REFUND">Remboursement</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="payment-reference">Référence</Label><Input id="payment-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Reçu, mobile money, bordereau…" /></div><div className="space-y-2"><Label htmlFor="payment-notes">Notes</Label><Textarea id="payment-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Informations complémentaires…" /></div></div><DialogFooter><Button disabled={!invoice || !walletId || !amount || !paymentDate} onClick={() => { if (invoice) mutation.mutate({ data: { invoiceId: invoice.id, payment: { wallet_id: walletId, amount: Number(amount), payment_date: paymentDate, status: "RECEIVED", payment_kind: kind, reference: reference.trim() || null, notes: notes.trim() || null } } }); }} loading={mutation.isPending}>Enregistrer l’encaissement</Button></DialogFooter></DialogContent></Dialog>;
}

function CancelDialog({ target, onOpenChange, onSaved }: { target: { kind: "sale" | "invoice" | "payment"; id: string; label: string } | null; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const saleMutation = useMutation({ mutationFn: cancelCommercialSale, onSuccess: done, onError: showError("Impossible d’annuler la vente.") });
  const invoiceMutation = useMutation({ mutationFn: cancelCommercialInvoice, onSuccess: done, onError: showError("Impossible d’annuler la facture.") });
  const paymentMutation = useMutation({ mutationFn: cancelCommercialInvoicePayment, onSuccess: done, onError: showError("Impossible d’annuler le paiement.") });
  function done() { toast.success("Annulation enregistrée avec traçabilité."); setReason(""); onOpenChange(false); onSaved(); }
  const pending = saleMutation.isPending || invoiceMutation.isPending || paymentMutation.isPending;
  function submit() { if (!target) return; const data = { id: target.id, reason: reason.trim() }; if (target.kind === "sale") saleMutation.mutate({ data }); if (target.kind === "invoice") invoiceMutation.mutate({ data }); if (target.kind === "payment") paymentMutation.mutate({ data }); }
  return <Dialog open={Boolean(target)} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Annuler {target?.label}</DialogTitle><DialogDescription>L’historique est conservé. Cette action nécessite une justification et peut créer une contre-écriture selon l’état de l’opération.</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="commercial-cancel-reason">Justification</Label><Textarea id="commercial-cancel-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Expliquez l’annulation…" /></div><DialogFooter><Button variant="danger" disabled={reason.trim().length < 3} onClick={submit} loading={pending}>Confirmer l’annulation</Button></DialogFooter></DialogContent></Dialog>;
}

function CreateReturnDialog({ saleId, lines, returnedByLine, open, onOpenChange, onSaved }: {
  saleId: string; lines: CommercialSaleLine[]; returnedByLine: Record<string, number>;
  open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void;
}) {
  const [reason, setReason] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [dispositions, setDispositions] = useState<Record<string, string>>({});
  const idempotencyKeyRef = useState(() => crypto.randomUUID())[0];
  const mutation = useMutation({
    mutationFn: createCommerceSaleReturn,
    onSuccess: () => { toast.success("Retour enregistré."); setReason(""); setQuantities({}); setDispositions({}); onOpenChange(false); onSaved(); },
    onError: showError("Impossible d’enregistrer le retour."),
  });

  const selectedLines = lines
    .map((line) => {
      const returnable = Number(line.quantity) - (returnedByLine[line.id] ?? 0);
      const quantity = Number(quantities[line.id] ?? "0");
      return { line, returnable, quantity, disposition: dispositions[line.id] ?? "RESTOCK" };
    })
    .filter((entry) => entry.quantity > 0);
  const canSubmit = reason.trim().length >= 3 && selectedLines.length > 0 && selectedLines.every((entry) => entry.quantity <= entry.returnable);

  function submit() {
    mutation.mutate({
      data: {
        saleId, reason: reason.trim(), idempotencyKey: idempotencyKeyRef,
        lines: selectedLines.map((entry) => ({ original_sale_line_id: entry.line.id, quantity_returned: entry.quantity, disposition: entry.disposition as (typeof RETURN_DISPOSITIONS)[number] })),
      },
    });
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>Enregistrer un retour</DialogTitle><DialogDescription>Indiquez la quantité rapportée par article. La vente d’origine n’est jamais modifiée.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div className="space-y-3">
          {lines.map((line) => {
            const returnable = Number(line.quantity) - (returnedByLine[line.id] ?? 0);
            return <div key={line.id} className="grid grid-cols-[1fr_100px_160px] items-end gap-2 rounded-lg border border-border/70 p-3">
              <div><p className="text-sm font-medium text-foreground">{line.description}</p><p className="text-caption text-muted-foreground">Restant retournable : {returnable.toLocaleString("fr-FR")}</p></div>
              <div className="space-y-1"><Label className="text-xs">Quantité</Label><Input type="number" min="0" max={returnable} step="0.001" value={quantities[line.id] ?? ""} onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Disposition</Label><Select value={dispositions[line.id] ?? "RESTOCK"} onValueChange={(value) => setDispositions((current) => ({ ...current, [line.id]: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{RETURN_DISPOSITIONS.map((value) => <SelectItem key={value} value={value}>{dispositionLabel(value)}</SelectItem>)}</SelectContent></Select></div>
            </div>;
          })}
        </div>
        <div className="space-y-2"><Label htmlFor="return-reason">Motif</Label><Textarea id="return-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Raison du retour…" /></div>
      </div>
      <DialogFooter><Button disabled={!canSubmit || mutation.isPending} onClick={submit} loading={mutation.isPending}>Enregistrer le retour</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function CreateRefundDialog({ saleId, refundableCredit, open, onOpenChange, onSaved }: {
  saleId: string; refundableCredit: number; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void;
}) {
  const [walletId, setWalletId] = useState("");
  const [amount, setAmount] = useState("");
  const [refundDate, setRefundDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const mutation = useMutation({
    mutationFn: createCommerceSaleRefund,
    onSuccess: () => { toast.success("Remboursement enregistré : confirmez-le pour débiter le wallet."); setWalletId(""); setAmount(""); setReference(""); setNotes(""); onOpenChange(false); onSaved(); },
    onError: showError("Impossible d’enregistrer le remboursement."),
  });
  const canSubmit = Boolean(walletId) && Number(amount) > 0 && Number(amount) <= refundableCredit;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>Enregistrer un remboursement</DialogTitle><DialogDescription>Crédit remboursable : {formatAmount(refundableCredit)}. Le wallet n’est débité qu’après confirmation.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2"><Label>Wallet débité</Label><WalletSelect value={walletId} onValueChange={setWalletId} placeholder="Sélectionner le wallet débité" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="refund-amount">Montant (FCFA)</Label><Input id="refund-amount" type="number" min="1" max={refundableCredit} value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="refund-date">Date du remboursement</Label><Input id="refund-date" type="date" value={refundDate} onChange={(event) => setRefundDate(event.target.value)} /></div>
        </div>
        <div className="space-y-2"><Label htmlFor="refund-reference">Référence</Label><Input id="refund-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Reçu, mobile money…" /></div>
        <div className="space-y-2"><Label htmlFor="refund-notes">Notes</Label><Textarea id="refund-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      </div>
      <DialogFooter><Button disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate({ data: { saleId, walletId, amount: Number(amount), refundDate, reference: reference.trim() || null, notes: notes.trim() || null } })} loading={mutation.isPending}>Enregistrer le remboursement</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function RefundCancelDialog({ target, onOpenChange, onConfirm, pending }: { target: CommerceSaleRefund | null; onOpenChange: (open: boolean) => void; onConfirm: (reason: string) => void; pending: boolean }) {
  const [reason, setReason] = useState("");
  return <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>Annuler le remboursement {target?.refund_number}</DialogTitle><DialogDescription>Si ce remboursement était confirmé, une contre-écriture recrédite le wallet.</DialogDescription></DialogHeader>
      <div className="space-y-2"><Label htmlFor="refund-cancel-reason">Justification</Label><Textarea id="refund-cancel-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Expliquez l’annulation…" /></div>
      <DialogFooter><Button variant="danger" disabled={reason.trim().length < 3 || pending} onClick={() => { onConfirm(reason.trim()); setReason(""); }} loading={pending}>Confirmer l’annulation</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
