import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Clock3, WalletCards } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  confirmCommercePosCashReception,
  getCommercePosControlReports,
  type CommercePosControlReportSummary,
} from "@/lib/commerce-pos.functions";
import { createCommercePosId } from "@/lib/commerce-pos-session";

const money = (amount: number) => `${amount.toLocaleString("fr-FR")} FCFA`;
const when = (value: string) => new Date(value).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });

type CashDrawerWallet = { id: string; name: string; balance: number };

export function PosControlReportsWorkspace({
  locationId,
  locationName,
  from,
  to,
  cashDrawerWallet,
}: {
  locationId: string;
  locationName: string;
  from: string;
  to: string;
  cashDrawerWallet: CashDrawerWallet | null;
}) {
  const queryClient = useQueryClient();
  const [selectedReportId, setSelectedReportId] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [note, setNote] = useState("");
  const [receptionEventId, setReceptionEventId] = useState(() => createCommercePosId("cash-reception"));
  const query = useQuery({
    queryKey: ["commerce-pos-control-reports", locationId, from, to],
    queryFn: () => getCommercePosControlReports({ data: { locationId, from, to, status: null, cashierId: null } }),
    enabled: Boolean(locationId),
  });
  const selectedReport = query.data?.reports.find((report) => report.id === selectedReportId) ?? null;
  const awaitingCount = query.data
    ? query.data.counts.pendingControl + query.data.counts.partiallyReceived + query.data.counts.reviewRequired
    : 0;
  const received = Number(receivedAmount);
  const difference = selectedReport && Number.isFinite(received)
    ? selectedReport.receivedTotal + received - selectedReport.cashExpected
    : null;

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-control-reports", locationId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-store-cockpit", locationId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-cash-remittances", locationId] }),
      queryClient.invalidateQueries({ queryKey: ["wallets"] }),
      queryClient.invalidateQueries({ queryKey: ["wallet-stats"] }),
      queryClient.invalidateQueries({ queryKey: ["wallet-modules-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-operations"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-stats"] }),
      queryClient.invalidateQueries({ queryKey: ["treasury"] }),
      cashDrawerWallet
        ? queryClient.invalidateQueries({ queryKey: ["wallet", cashDrawerWallet.id] })
        : Promise.resolve(),
      cashDrawerWallet
        ? queryClient.invalidateQueries({ queryKey: ["wallet-operations", cashDrawerWallet.id] })
        : Promise.resolve(),
    ]);
  };
  const confirmMutation = useMutation({
    mutationFn: () => {
      if (!selectedReport) throw new Error("Rapport de caisse introuvable.");
      if (!cashDrawerWallet) throw new Error("Aucun wallet principal de caisse actif n’est configuré.");
      if (!Number.isFinite(received) || received <= 0) throw new Error("Saisissez le montant réellement reçu.");
      return confirmCommercePosCashReception({ data: {
        reportId: selectedReport.id,
        receptionEventId,
        receivedAmount: received,
        isFinal: true,
        note: note.trim() || null,
      } });
    },
    onSuccess: async () => {
      toast.success("Réception validée. Le wallet a été crédité une seule fois.");
      setSelectedReportId("");
      setReceivedAmount("");
      setNote("");
      setReceptionEventId(createCommercePosId("cash-reception"));
      await refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "La réception n’a pas pu être validée."),
  });

  const reports = useMemo(() => query.data?.reports ?? [], [query.data]);

  return <Card variant="section" id="store-cash">
    <CardHeader className="pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><CardTitle className="flex items-center gap-2 text-lg"><ClipboardCheck className="size-5 text-primary" /> Caisses · contrôle gestionnaire</CardTitle><p className="mt-1 text-sm text-muted-foreground">Synchronisé signifie reçu par le serveur. Seule la validation ci-dessous crédite la trésorerie.</p></div>
        <div className="rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2 text-sm"><span className="text-muted-foreground">À vérifier</span><strong className="ml-2 text-lg tabular-nums">{query.isPending ? "…" : awaitingCount}</strong></div>
      </div>
    </CardHeader>
    <CardContent>
      {query.isPending ? <p className="py-6 text-center text-sm text-muted-foreground">Chargement des rapports de caisse…</p> : query.isError ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/[0.04] p-3 text-sm"><span>Les rapports de contrôle ne peuvent pas être chargés avec cet accès.</span><Button variant="outline" size="sm" onClick={() => void query.refetch()}>Réessayer</Button></div> : reports.length ? <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[980px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Session / terminal</th><th className="px-3 py-2">Caissier</th><th className="px-3 py-2">Clôture</th><th className="px-3 py-2 text-right">Tickets</th><th className="px-3 py-2 text-right">Espèces théoriques</th><th className="px-3 py-2 text-right">Déjà reçu</th><th className="px-3 py-2">Contrôle</th><th className="px-3 py-2"></th></tr></thead><tbody className="divide-y divide-border/60">{reports.map((report) => <ControlReportRow key={report.id} report={report} onControl={() => { setSelectedReportId(report.id); setReceivedAmount(""); setNote(""); setReceptionEventId(createCommercePosId("cash-reception")); }} />)}</tbody></table></div> : <p className="rounded-lg bg-muted/30 p-4 text-center text-sm text-muted-foreground">Aucun rapport de caisse sur cette période.</p>}
    </CardContent>

    <Dialog open={Boolean(selectedReport)} onOpenChange={(open) => { if (!open && !confirmMutation.isPending) { setSelectedReportId(""); setReceivedAmount(""); setNote(""); } }}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Contrôler la réception de caisse</DialogTitle><DialogDescription>Le montant théorique reste conservé. L’écriture Finance portera uniquement sur le montant réellement reçu.</DialogDescription></DialogHeader>
        {selectedReport ? <div className="space-y-4">
          <div className="grid gap-2 rounded-xl border border-border p-4 sm:grid-cols-2">
            <Info label="Magasin" value={locationName} /><Info label="Caissier" value={selectedReport.cashier} />
            <Info label="Session" value={selectedReport.cashSessionId} /><Info label="Terminal" value={selectedReport.terminalId} />
            <Info label="Ouverture" value={when(selectedReport.openedAt)} /><Info label="Clôture" value={when(selectedReport.closedAt)} />
            <Info label="Tickets" value={String(selectedReport.ticketCount)} /><Info label="Articles / services" value={`${money(selectedReport.articleRevenue)} / ${money(selectedReport.serviceRevenue)}`} />
            <Info label="Espèces théoriques" value={money(selectedReport.cashExpected)} /><Info label="Mobile Money" value={money(selectedReport.mobileMoneyTotal)} />
            <Info label="Autres moyens" value={money(selectedReport.otherPaymentTotal)} /><Info label="CA commercial" value={money(selectedReport.totalRevenue)} />
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4"><div className="flex items-center gap-2"><WalletCards className="size-4 text-primary" /><span className="text-sm font-medium">Wallet crédité après validation</span></div><p className="mt-1 font-semibold">{cashDrawerWallet ? `${cashDrawerWallet.name} · solde actuel ${money(cashDrawerWallet.balance)}` : "Aucun wallet principal de caisse actif"}</p></div>
          <div><Label htmlFor="cash-received">Montant réellement reçu</Label><Input id="cash-received" type="number" min="1" step="1" value={receivedAmount} onChange={(event) => setReceivedAmount(event.target.value)} placeholder="Saisir le montant remis au gestionnaire" /></div>
          <div><Label htmlFor="cash-reception-note">Note de contrôle (optionnelle)</Label><Input id="cash-reception-note" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} /></div>
          {difference !== null && received > 0 ? <div className={`rounded-xl border p-3 text-sm ${difference < 0 ? "border-destructive/25 bg-destructive/[0.05] text-destructive" : difference > 0 ? "border-warning/30 bg-warning/[0.06] text-warning" : "border-success/25 bg-success/[0.05] text-success"}`}><strong>{difference < 0 ? `Manquant : ${money(Math.abs(difference))}` : difference > 0 ? `Excédent : ${money(difference)}` : "Aucun écart de caisse"}</strong><span className="mt-1 block">Écart = reçu cumulé − espèces théoriques. Aucune dépense ou écriture d’équilibrage ne sera créée.</span></div> : null}
        </div> : null}
        <DialogFooter><Button type="button" variant="outline" disabled={confirmMutation.isPending} onClick={() => setSelectedReportId("")}>Annuler</Button><Button type="button" disabled={!selectedReport || !cashDrawerWallet || !Number.isFinite(received) || received <= 0 || confirmMutation.isPending} onClick={() => confirmMutation.mutate()}>{confirmMutation.isPending ? "Validation…" : "Valider la réception"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>;
}

function ControlReportRow({ report, onControl }: { report: CommercePosControlReportSummary; onControl: () => void }) {
  const pending = !report.isFinalized && report.cashExpected > 0;
  const status = report.controlStatus === "PENDING_CONTROL" ? "À CONTRÔLER" : report.controlStatus === "PARTIALLY_RECEIVED" ? "RÉCEPTION PARTIELLE" : report.controlStatus === "REVIEW_REQUIRED" ? "À REVOIR" : "CONTRÔLÉ";
  return <tr><td className="px-3 py-2.5"><strong>{report.cashSessionId}</strong><span className="block text-xs text-muted-foreground">{report.terminalId}</span></td><td className="px-3 py-2.5">{report.cashier}</td><td className="px-3 py-2.5">{when(report.closedAt)}<span className="block text-xs text-muted-foreground">Sync : {report.syncStatus}</span></td><td className="px-3 py-2.5 text-right tabular-nums">{report.ticketCount}</td><td className="px-3 py-2.5 text-right font-medium tabular-nums">{money(report.cashExpected)}</td><td className="px-3 py-2.5 text-right tabular-nums">{money(report.receivedTotal)}</td><td className="px-3 py-2.5"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${status === "CONTRÔLÉ" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{status === "CONTRÔLÉ" ? <CheckCircle2 className="size-3" /> : <Clock3 className="size-3" />}{status}</span></td><td className="px-3 py-2.5 text-right">{pending ? <Button size="sm" onClick={onControl}>Contrôler</Button> : null}</td></tr>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-0.5 break-words font-medium">{value}</p></div>;
}
