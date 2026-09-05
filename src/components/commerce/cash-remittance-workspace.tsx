import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CheckCircle2, Clock3, HandCoins } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  confirmCommerceCashRemittance,
  declareCommerceCashRemittance,
  getCommerceCashRemittanceWorkspace,
  type CommerceCashRemittanceWorkspace,
} from "@/lib/commerce-pos.functions";
import { createCommercePosId } from "@/lib/commerce-pos-session";

const money = (amount: number) => `${amount.toLocaleString("fr-FR")} FCFA`;
const when = (value: string | null) => value ? new Date(value).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function CashRemittanceWorkspace({ locationId, mode = "management", online = true }: {
  locationId: string;
  mode?: "management" | "cashier-trigger";
  online?: boolean;
}) {
  const query = useQuery({
    queryKey: ["commerce-cash-remittances", locationId],
    queryFn: () => getCommerceCashRemittanceWorkspace({ data: { locationId } }),
    enabled: Boolean(locationId) && (mode === "management" || online),
  });
  if (mode === "cashier-trigger") {
    return <Dialog><DialogTrigger asChild><Button type="button" variant="outline" disabled={!online} title={online ? "Déclarer une remise à partir des clôtures synchronisées" : "Connexion requise pour déclarer une remise"}><HandCoins className="size-4" /> Remise</Button></DialogTrigger><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Remise de caisse</DialogTitle><DialogDescription>La déclaration ne crée aucune recette. La réception devra être confirmée séparément par un responsable.</DialogDescription></DialogHeader>{query.isPending ? <p className="py-8 text-center text-sm text-muted-foreground">Chargement des clôtures synchronisées…</p> : query.data ? <RemittanceContent workspace={query.data} locationId={locationId} cashier /> : <p className="py-8 text-center text-sm text-destructive">Les remises ne peuvent pas être chargées.</p>}</DialogContent></Dialog>;
  }
  return <Card variant="section" id="store-remittances"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><HandCoins className="size-5 text-primary" /> Remises de caisse</CardTitle></CardHeader><CardContent>{query.isPending ? <p className="py-8 text-center text-sm text-muted-foreground">Chargement…</p> : query.data ? <RemittanceContent workspace={query.data} locationId={locationId} /> : <p className="py-8 text-center text-sm text-destructive">Impossible de charger les remises.</p>}</CardContent></Card>;
}

function RemittanceContent({ workspace, locationId, cashier = false }: { workspace: CommerceCashRemittanceWorkspace; locationId: string; cashier?: boolean }) {
  const queryClient = useQueryClient();
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [reference, setReference] = useState("");
  const [declarationNote, setDeclarationNote] = useState("");
  const [eventId, setEventId] = useState(() => createCommercePosId("cash-remittance"));
  const [confirmationId, setConfirmationId] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [destinationWalletId, setDestinationWalletId] = useState("");
  const [confirmationNote, setConfirmationNote] = useState("");
  const availableClosures = workspace.closures.filter((closure) => closure.remainingAmount > 0.009);
  const selectedAllocations = Object.entries(allocations).filter(([, amount]) => amount > 0);
  const selectedTotal = selectedAllocations.reduce((sum, [, amount]) => sum + amount, 0);
  const pendingRemittances = workspace.remittances.filter((remittance) => remittance.status === "DECLARED");
  const selectedRemittance = pendingRemittances.find((remittance) => remittance.id === confirmationId) ?? null;
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["commerce-cash-remittances", locationId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-store-cockpit", locationId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-pos-workspace", locationId] }),
    ]);
  };
  const declareMutation = useMutation({
    mutationFn: () => declareCommerceCashRemittance({ data: {
      remittanceEventId: eventId, businessLocationId: locationId,
      reference: reference.trim() || null, note: declarationNote.trim() || null,
      closures: selectedAllocations.map(([closureId, amount]) => ({ closureId, amount })),
    } }),
    onSuccess: async () => {
      toast.success("Remise déclarée. Elle attend la confirmation du responsable.");
      setAllocations({}); setReference(""); setDeclarationNote(""); setEventId(createCommercePosId("cash-remittance"));
      await refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "La remise n’a pas pu être déclarée."),
  });
  const confirmMutation = useMutation({
    mutationFn: () => confirmCommerceCashRemittance({ data: {
      remittanceId: confirmationId, receivedAmount: Number(receivedAmount), destinationWalletId,
      note: confirmationNote.trim() || null,
    } }),
    onSuccess: async () => {
      toast.success("Réception confirmée et transfert de trésorerie enregistré une seule fois.");
      setConfirmationId(""); setReceivedAmount(""); setDestinationWalletId(""); setConfirmationNote("");
      await refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "La réception n’a pas pu être confirmée."),
  });
  const summary = workspace.summary;
  const history = useMemo(() => workspace.remittances.slice(0, cashier ? 8 : 30), [cashier, workspace.remittances]);

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Summary label="À confirmer" value={money(summary.awaitingConfirmation)} icon={Clock3} />
      <Summary label="Confirmé reçu" value={money(summary.confirmedReceived)} icon={CheckCircle2} />
      <Summary label="Reste à remettre" value={money(summary.remainingToRemit)} icon={Banknote} />
      <Summary label="Écarts caisse / remise" value={`${money(summary.cashDifference)} / ${money(summary.remittanceDifference)}`} icon={HandCoins} />
    </div>

    {workspace.access.declare && !workspace.access.confirm ? <div className="space-y-3 rounded-xl border border-border p-4">
      <div><h3 className="font-semibold">Déclarer une remise</h3><p className="mt-1 text-sm text-muted-foreground">Sélectionnez uniquement l’argent physiquement remis. Une clôture partielle conserve son solde restant.</p></div>
      {availableClosures.length ? <div className="space-y-2">{availableClosures.map((closure) => {
        const selected = (allocations[closure.id] ?? 0) > 0;
        return <div key={closure.id} className="grid gap-2 rounded-lg border border-border/70 p-3 sm:grid-cols-[auto_minmax(0,1fr)_10rem] sm:items-center"><input type="checkbox" checked={selected} onChange={(event) => setAllocations((current) => ({ ...current, [closure.id]: event.target.checked ? closure.remainingAmount : 0 }))} aria-label={`Sélectionner ${closure.cashSessionId}`} /><div><p className="font-medium">{when(closure.closedAt)} · {closure.cashSessionId}</p><p className="text-xs text-muted-foreground">Théorique {money(closure.theoreticalCash)} · compté {closure.countedCash === null ? "non compté" : money(closure.countedCash)} · restant {money(closure.remainingAmount)}</p></div><Input type="number" min="0" max={closure.remainingAmount} step="1" disabled={!selected} value={selected ? allocations[closure.id] : ""} onChange={(event) => setAllocations((current) => ({ ...current, [closure.id]: Math.min(closure.remainingAmount, Math.max(0, Number(event.target.value))) }))} /></div>;
      })}</div> : <p className="rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">Aucune clôture synchronisée ne possède de montant encore remisable.</p>}
      <div className="grid gap-3 sm:grid-cols-2"><div><Label>Référence (optionnelle)</Label><Input value={reference} maxLength={160} onChange={(event) => setReference(event.target.value)} /></div><div><Label>Note (optionnelle)</Label><Input value={declarationNote} maxLength={1000} onChange={(event) => setDeclarationNote(event.target.value)} /></div></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-semibold">Déclaré remis : {money(selectedTotal)}</p><Button disabled={selectedTotal <= 0 || declareMutation.isPending} onClick={() => declareMutation.mutate()}>{declareMutation.isPending ? "Déclaration…" : "Déclarer la remise"}</Button></div>
    </div> : null}

    {workspace.access.confirm && pendingRemittances.length ? <div className="space-y-3 rounded-xl border border-warning/30 bg-warning/[0.05] p-4">
      <div><h3 className="font-semibold">Confirmer une réception physique</h3><p className="mt-1 text-sm text-muted-foreground">Le confirmateur doit être différent du déclarant. La confirmation crée un transfert, jamais une recette.</p></div>
      <Select value={confirmationId} onValueChange={(id) => { const remittance = pendingRemittances.find((item) => item.id === id); setConfirmationId(id); setReceivedAmount(remittance ? String(remittance.declaredAmount) : ""); }}><SelectTrigger><SelectValue placeholder="Choisir une remise à confirmer" /></SelectTrigger><SelectContent>{pendingRemittances.map((remittance) => <SelectItem key={remittance.id} value={remittance.id}>{remittance.cashier} · {money(remittance.declaredAmount)} · {when(remittance.declaredAt)}</SelectItem>)}</SelectContent></Select>
      {selectedRemittance ? <div className="grid gap-3 sm:grid-cols-2"><div><Label>Montant réellement reçu</Label><Input type="number" min="1" max={selectedRemittance.declaredAmount} value={receivedAmount} onChange={(event) => setReceivedAmount(event.target.value)} /></div><div><Label>Wallet destination autorisé</Label><Select value={destinationWalletId} onValueChange={setDestinationWalletId}><SelectTrigger><SelectValue placeholder="Wallet de collecte / exploitation" /></SelectTrigger><SelectContent>{workspace.destinationWallets.map((wallet) => <SelectItem key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.purpose}</SelectItem>)}</SelectContent></Select></div><div className="sm:col-span-2"><Label>Note de réception (optionnelle)</Label><Input value={confirmationNote} maxLength={1000} onChange={(event) => setConfirmationNote(event.target.value)} /></div><div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3"><p className="text-sm">Attendu {money(selectedRemittance.expectedAmount)} · déclaré {money(selectedRemittance.declaredAmount)}</p><Button disabled={!destinationWalletId || Number(receivedAmount) <= 0 || Number(receivedAmount) > selectedRemittance.declaredAmount || confirmMutation.isPending} onClick={() => confirmMutation.mutate()}>{confirmMutation.isPending ? "Confirmation…" : "Confirmer la réception"}</Button></div></div> : null}
    </div> : null}

    <div><h3 className="mb-2 font-semibold">Historique</h3>{history.length ? <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[920px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Date / caissier</th><th className="px-3 py-2">Clôtures</th><th className="px-3 py-2 text-right">Attendu</th><th className="px-3 py-2 text-right">Déclaré</th><th className="px-3 py-2 text-right">Reçu</th><th className="px-3 py-2 text-right">Écart</th><th className="px-3 py-2">Statut / confirmateur</th></tr></thead><tbody className="divide-y divide-border/60">{history.map((remittance) => <tr key={remittance.id}><td className="px-3 py-2.5"><strong>{when(remittance.declaredAt)}</strong><span className="block text-xs text-muted-foreground">{remittance.cashier}</span></td><td className="px-3 py-2.5">{remittance.closures.length}<span className="block max-w-56 truncate text-xs text-muted-foreground">{remittance.closures.map((closure) => closure.cashSessionId).join(", ")}</span></td><td className="px-3 py-2.5 text-right tabular-nums">{money(remittance.expectedAmount)}</td><td className="px-3 py-2.5 text-right tabular-nums">{money(remittance.declaredAmount)}</td><td className="px-3 py-2.5 text-right tabular-nums">{remittance.receivedAmount === null ? "—" : money(remittance.receivedAmount)}</td><td className="px-3 py-2.5 text-right tabular-nums">{remittance.remittanceDifference === null ? money(remittance.cashDifference) : money(remittance.remittanceDifference)}</td><td className="px-3 py-2.5"><span className={remittance.status === "CONFIRMED" ? "font-semibold text-success" : remittance.status === "DECLARED" ? "font-semibold text-warning" : "text-muted-foreground"}>{remittance.status === "CONFIRMED" ? "CONFIRMÉ" : remittance.status === "DECLARED" ? "À CONFIRMER" : "ANNULÉ"}</span><span className="block text-xs text-muted-foreground">{remittance.confirmer ?? "Réception en attente"}</span></td></tr>)}</tbody></table></div> : <p className="rounded-lg bg-muted/30 p-4 text-center text-sm text-muted-foreground">Aucune remise déclarée.</p>}</div>
  </div>;
}

function Summary({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Banknote }) {
  return <div className="rounded-xl border border-border bg-muted/[0.12] p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span><Icon className="size-4 text-primary" /></div><p className="mt-2 font-semibold tabular-nums">{value}</p></div>;
}
