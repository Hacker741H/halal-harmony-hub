import { useMemo, useState } from "react";
import { CheckCircle2, CircleDollarSign, PlusCircle, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { PosOfflineCashSession, PosOfflineCashSessionSummary } from "@/lib/commerce-pos-offline";

const money = (amount: number) => `${amount.toLocaleString("fr-FR")} FCFA`;

type Props = {
  session: PosOfflineCashSession | null;
  summary: PosOfflineCashSessionSummary | null;
  disabled?: boolean;
  onClose: () => Promise<void>;
  onStartNew: () => Promise<void>;
};

/**
 * Mission caisse: the cashier only reviews and confirms -- no counted-cash
 * entry, no note, no remittance trigger. Physical cash control happens later,
 * only on the manager's side of the control center.
 */
export function PosCashSessionClose({ session, summary, disabled = false, onClose, onStartNew }: Props) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOpen = session?.status === "OPEN";
  const openedAtLabel = session?.openedAtDevice ? new Date(session.openedAtDevice).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—";
  const closingAtLabel = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const sessionDayLabel = session?.openedAtDevice ? new Date(session.openedAtDevice).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
  const recap = useMemo(() => [
    ["Heure d’ouverture", openedAtLabel],
    ["Heure de clôture", closingAtLabel],
    ["Tickets encaissés", String(summary?.ticketCount ?? 0)],
    ["Articles vendus", String(summary?.articleQuantityTotal ?? 0)],
    ["CA articles", money(summary?.articleTotal ?? 0)],
    ["CA services", money(summary?.serviceTotal ?? 0)],
    ["Espèces (théorique)", money(summary?.theoreticalCash ?? 0)],
  ], [openedAtLabel, closingAtLabel, summary?.articleTotal, summary?.articleQuantityTotal, summary?.serviceTotal, summary?.ticketCount, summary?.theoreticalCash]);

  const submit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await onClose();
      setOpen(false);
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
        <Button type="button" size="sm" variant="outline" onClick={() => void onStartNew()}><PlusCircle />Nouvelle session</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled}><CircleDollarSign />Clôture caisse</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Clôture de caisse</DialogTitle>
          <DialogDescription>Vérifiez le résumé ci-dessous, puis clôturez. Le contrôle et la réception des espèces se font ensuite côté gestion — vous n’avez rien d’autre à saisir.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 rounded-xl border border-border/70 bg-muted/[0.18] p-3 sm:grid-cols-2">
          {recap.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 text-sm"><span className="text-muted-foreground">{label}</span><strong className="tabular-nums">{value}</strong></div>)}
        </div>
        {error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>Annuler</Button><Button type="button" loading={isSubmitting} loadingLabel="Clôture" onClick={() => void submit()}><ReceiptText />Clôturer la session</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
}
