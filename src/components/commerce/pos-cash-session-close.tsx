import { useMemo, useState } from "react";
import { CheckCircle2, CircleDollarSign, PlusCircle, ReceiptText } from "lucide-react";

import { CashRemittanceWorkspace } from "@/components/commerce/cash-remittance-workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PosOfflineCashSession, PosOfflineCashSessionSummary } from "@/lib/commerce-pos-offline";

const money = (amount: number) => `${amount.toLocaleString("fr-FR")} FCFA`;

type Props = {
  session: PosOfflineCashSession | null;
  summary: PosOfflineCashSessionSummary | null;
  disabled?: boolean;
  onClose: (input: { countedCash: number; note: string | null }) => Promise<void>;
  onStartNew: () => Promise<void>;
};

export function PosCashSessionClose({ session, summary, disabled = false, onClose, onStartNew }: Props) {
  const [open, setOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOpen = session?.status === "OPEN";
  const total = summary?.theoreticalCash ?? 0;
  const parsedCount = Number(countedCash);
  const countIsValid = countedCash !== "" && Number.isFinite(parsedCount) && parsedCount >= 0;
  const difference = countIsValid ? parsedCount - total : null;
  const recap = useMemo(() => [
    ["Tickets encaissés", String(summary?.ticketCount ?? 0)],
    ["Articles", money(summary?.articleTotal ?? 0)],
    ["Services", money(summary?.serviceTotal ?? 0)],
    ["Caisse théorique", money(total)],
  ], [summary?.articleTotal, summary?.serviceTotal, summary?.ticketCount, total]);

  const submit = async () => {
    if (!countIsValid) {
      setError("Saisissez le montant physique réellement compté.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onClose({ countedCash: parsedCount, note: note.trim() || null });
      setOpen(false);
      setCountedCash("");
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La clôture locale n’a pas pu être enregistrée.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!session) return null;

  if (!isOpen) {
    const needsReview = session.status === "SYNCED" && Boolean(session.lastSyncError);
    const label = needsReview ? "Clôture à contrôler" : session.status === "SYNCED" ? "Clôture synchronisée" : "Clôture à synchroniser";
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${needsReview ? "border-warning/30 bg-warning/[0.08] text-warning" : "border-success/25 bg-success/[0.08] text-success"}`}><CheckCircle2 className="size-3.5" />{label}</span>
        <CashRemittanceWorkspace locationId={session.locationId} mode="cashier-trigger" online={typeof navigator === "undefined" || navigator.onLine} />
        <Button type="button" size="sm" variant="outline" onClick={() => void onStartNew()}><PlusCircle />Nouvelle session</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
    <CashRemittanceWorkspace locationId={session.locationId} mode="cashier-trigger" online={typeof navigator === "undefined" || navigator.onLine} />
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled}><CircleDollarSign />Clôture caisse</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Clôture de caisse</DialogTitle>
          <DialogDescription>Le montant compté est comparé au total théorique. Cette clôture ne modifie ni le wallet ni les recettes : elle reste en attente de synchronisation et de contrôle.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 rounded-xl border border-border/70 bg-muted/[0.18] p-3 sm:grid-cols-2">
          {recap.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 text-sm"><span className="text-muted-foreground">{label}</span><strong className="tabular-nums">{value}</strong></div>)}
        </div>
        <div className="space-y-2">
          <Label htmlFor="pos-counted-cash">Espèces réellement comptées (FCFA)</Label>
          <Input id="pos-counted-cash" autoFocus type="number" inputMode="numeric" min="0" step="1" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} placeholder="Ex. 22500" />
          {difference !== null ? <p className={`rounded-lg border px-3 py-2 text-sm font-semibold ${difference === 0 ? "border-success/25 bg-success/[0.08] text-success" : difference < 0 ? "border-destructive/25 bg-destructive/[0.06] text-destructive" : "border-warning/30 bg-warning/[0.08] text-warning"}`}>{difference === 0 ? "Caisse conforme" : difference > 0 ? `Excédent : ${money(difference)}` : `Écart constaté : ${money(Math.abs(difference))}`}</p> : null}
        </div>
        <div className="space-y-2"><Label htmlFor="pos-close-note">Note d’écart <span className="font-normal text-muted-foreground">(facultative)</span></Label><textarea id="pos-close-note" className="flex min-h-20 w-full rounded-xl border border-input bg-surface px-3 py-2 text-sm outline-none transition-ui-fast placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Expliquez l’écart, si nécessaire." /></div>
        {error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>Annuler</Button><Button type="button" loading={isSubmitting} loadingLabel="Clôture" disabled={!countIsValid} onClick={() => void submit()}><ReceiptText />Clôturer la session</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
}
