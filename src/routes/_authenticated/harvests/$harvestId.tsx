import { useEffect, useState, type ReactNode } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Sprout } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { isSessionExpiredError, SESSION_EXPIRED_MESSAGE } from "@/lib/error-classification";
import { formatXOF } from "@/lib/format";
import { triggerSessionRecovery } from "@/lib/notify-mutation-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClientSelect } from "@/components/selects/entity-selects";
import { useConfirm } from "@/hooks/use-confirm";

import { createCommercialSale } from "@/lib/commercial-sales.functions";
import {
  cancelHarvestPlan,
  closeHarvest,
  configureHarvestRecurrence,
  getHarvest,
  getHarvestRecurrenceRule,
  getHarvestSaleAvailability,
  recordHarvest,
  recordHarvestDelivery,
  rescheduleHarvest,
  startHarvest,
  type HarvestSaleAvailability,
  type HarvestStatus,
} from "@/lib/harvests.functions";

export const Route = createFileRoute("/_authenticated/harvests/$harvestId")({
  head: () => ({ meta: [{ title: "Récolte — HALAL ERP" }] }),
  component: HarvestDetailPage,
});

const statusLabels: Record<HarvestStatus, string> = {
  PLANNED: "Planifiée",
  STARTED: "Démarrée",
  HARVESTED: "Récoltée",
  DELIVERED: "Livrée",
  CLOSED: "Clôturée",
  CANCELLED: "Annulée",
  LEGACY: "Historique",
};

function getErrorMessage(error: unknown): string {
  if (isSessionExpiredError(error)) {
    triggerSessionRecovery();
    return SESSION_EXPIRED_MESSAGE;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Action impossible.";
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/50 py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value ?? "—"}</span>
    </div>
  );
}

function HarvestDetailPage() {
  const { harvestId } = Route.useParams();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<"record" | "deliver" | "createSale" | "reschedule" | "recurrence" | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const harvestQuery = useQuery({
    queryKey: ["harvest", harvestId],
    queryFn: () => getHarvest({ data: harvestId }),
  });
  const harvest = harvestQuery.data;

  const recurrenceQuery = useQuery({
    queryKey: ["harvest-recurrence", harvest?.farm_id, harvest?.produit],
    queryFn: () => getHarvestRecurrenceRule({ data: { farmId: harvest!.farm_id, produit: harvest!.produit } }),
    enabled: Boolean(harvest),
  });

  const availabilityQuery = useQuery({
    queryKey: ["harvest-sale-availability", harvestId],
    queryFn: () => getHarvestSaleAvailability({ data: harvestId }),
  });

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ["harvest", harvestId] });
    await queryClient.invalidateQueries({ queryKey: ["harvests"] });
    await queryClient.invalidateQueries({ queryKey: ["harvest-sale-availability", harvestId] });
  }

  const startMutation = useMutation({
    mutationFn: () => startHarvest({ data: { id: harvestId } }),
    onSuccess: async () => { await invalidate(); toast.success("Récolte démarrée."); },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  const closeMutation = useMutation({
    mutationFn: () => closeHarvest({ data: { id: harvestId } }),
    onSuccess: async () => { await invalidate(); toast.success("Récolte clôturée."); },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  const cancelMutation = useMutation({
    mutationFn: (reason: string) => cancelHarvestPlan({ data: { id: harvestId, reason: reason || null } }),
    onSuccess: async () => { await invalidate(); toast.success("Récolte annulée."); },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  if (harvestQuery.isLoading) return <div className="p-6 text-sm text-muted-foreground">Chargement…</div>;
  if (harvestQuery.isError) {
    return (
      <div className="space-y-3 p-6 text-center text-sm">
        <p className="font-medium text-destructive">Impossible de charger cette récolte.</p>
        <p className="text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void harvestQuery.refetch()}>Réessayer</Button>
      </div>
    );
  }
  if (!harvest) return <div className="p-6 text-sm text-destructive">Récolte introuvable.</div>;

  const status = harvest.status as HarvestStatus;
  const farmName = (harvest as unknown as { farms?: { nom?: string; id?: string } }).farms?.nom ?? "Exploitation";

  return (
    <div className="space-y-7">
      <Link to="/farms/$farmId" params={{ farmId: harvest.farm_id }} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> Retour à {farmName}
      </Link>

      <OperationalHero
        variant="deep"
        icon={Sprout}
        eyebrow="Récolte"
        title={harvest.produit}
        description={`${farmName} · Récolte ${statusLabels[status] ?? status}${harvest.parcelle ? ` — ${harvest.parcelle}` : ""}`}
        actions={
          <>
            {status === "PLANNED" ? (
              <>
                <Button disabled={startMutation.isPending} onClick={() => startMutation.mutate()}>Démarrer</Button>
                <Button variant="outline" onClick={() => setDialog("reschedule")}>Reporter</Button>
                <Button
                  variant="destructive"
                  disabled={cancelMutation.isPending}
                  onClick={() => confirm({
                    title: "Annuler cette récolte ?",
                    description: "La planification sera annulée. Cette action est irréversible.",
                    variant: "destructive",
                    confirmLabel: "Annuler la récolte",
                    cancelLabel: "Retour",
                    onConfirm: async () => { await cancelMutation.mutateAsync(""); },
                  })}
                >
                  Annuler
                </Button>
              </>
            ) : null}
            {status === "STARTED" ? <Button onClick={() => setDialog("record")}>Enregistrer la récolte</Button> : null}
            {status === "HARVESTED" ? (
              <Button onClick={() => setDialog("deliver")}>Enregistrer la livraison</Button>
            ) : null}
            {status === "DELIVERED" ? (
              <>
                <Button disabled={closeMutation.isPending} onClick={() => closeMutation.mutate()}>Clôturer</Button>
                <Button
                  variant="outline"
                  disabled={!availabilityQuery.data || availabilityQuery.data.hasLegacySale || availabilityQuery.data.remainingKg <= 0}
                  onClick={() => setDialog("createSale")}
                >
                  Créer une vente
                </Button>
              </>
            ) : null}
            {status === "CLOSED" ? (
              <Button
                variant="outline"
                disabled={!availabilityQuery.data || availabilityQuery.data.hasLegacySale || availabilityQuery.data.remainingKg <= 0}
                onClick={() => setDialog("createSale")}
              >
                Créer une vente
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card variant="section">
          <CardHeader><CardTitle className="text-lg">Planification</CardTitle></CardHeader>
          <CardContent>
            <InfoRow label="Date prévue" value={harvest.planned_date} />
            <InfoRow label="Parcelle" value={harvest.parcelle} />
            <InfoRow label="Équipe prévue" value={harvest.equipe} />
            <InfoRow label="Transporteur prévu" value={harvest.transporteur} />
            <InfoRow label="Véhicule prévu" value={harvest.vehicule} />
            <InfoRow label="Destination prévue" value={harvest.destination_prevue} />
            <InfoRow label="Tarif transport (FCFA/kg)" value={harvest.transport_rate_per_kg} />
            {harvest.planning_notes ? <p className="mt-2 text-sm text-muted-foreground">{harvest.planning_notes}</p> : null}
          </CardContent>
        </Card>

        <Card variant="section">
          <CardHeader><CardTitle className="text-lg">Exécution</CardTitle></CardHeader>
          <CardContent>
            <InfoRow label="Démarrée le" value={harvest.started_at ? new Date(harvest.started_at).toLocaleString("fr-FR") : null} />
            {harvest.departure_notes ? <p className="mt-2 text-sm text-muted-foreground">{harvest.departure_notes}</p> : null}
          </CardContent>
        </Card>

        <Card variant="section">
          <CardHeader><CardTitle className="text-lg">Récolte</CardTitle></CardHeader>
          <CardContent>
            <InfoRow label="Poids récolté" value={harvest.poids_recolte_kg !== null ? `${harvest.poids_recolte_kg} kg` : null} />
            <InfoRow label="Pertes" value={harvest.poids_perte_recolte_kg !== null ? `${harvest.poids_perte_recolte_kg} kg` : null} />
            <InfoRow label="Récoltée le" value={harvest.harvested_at ? new Date(harvest.harvested_at).toLocaleString("fr-FR") : null} />
            {harvest.observations ? <p className="mt-2 text-sm text-muted-foreground">{harvest.observations}</p> : null}
          </CardContent>
        </Card>

        <Card variant="section">
          <CardHeader><CardTitle className="text-lg">Livraison &amp; Transport</CardTitle></CardHeader>
          <CardContent>
            <InfoRow label="Poids livré" value={harvest.poids_livre_kg !== null ? `${harvest.poids_livre_kg} kg` : null} />
            <InfoRow label="Écart récolté/livré" value={harvest.ecart_livraison_kg !== null ? `${harvest.ecart_livraison_kg} kg` : null} />
            <InfoRow label="Destination réelle" value={harvest.destination_reelle} />
            <InfoRow label="Réceptionnaire" value={harvest.receptionnaire} />
            <InfoRow label="Livrée le" value={harvest.delivered_at ? new Date(harvest.delivered_at).toLocaleString("fr-FR") : null} />
            <InfoRow
              label="Transport théorique"
              value={harvest.transport_amount_theorique !== null ? formatXOF(harvest.transport_amount_theorique) : null}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Montant calculé à titre indicatif — aucun paiement transport n'est déclenché automatiquement.
            </p>
          </CardContent>
        </Card>

        <Card variant="section" className="lg:col-span-2">
          <CardHeader><CardTitle className="text-lg">Commercial &amp; Finance</CardTitle></CardHeader>
          <CardContent>
            {harvest.sale_wallet_id ? (
              <>
                <Badge variant="neutral" appearance="soft">Vente historique (circuit direct)</Badge>
                <InfoRow label="Quantité vendue" value={harvest.quantite_kg !== null ? `${harvest.quantite_kg} kg` : null} />
                <InfoRow label="Prix / kg" value={harvest.prix_kg !== null ? formatXOF(harvest.prix_kg) : null} />
                <InfoRow label="Montant" value={harvest.montant_total !== null ? formatXOF(harvest.montant_total) : null} />
                <InfoRow label="Acheteur" value={harvest.acheteur} />
              </>
            ) : null}

            {harvest.poids_livre_kg !== null ? (
              <>
                <InfoRow label="Quantité livrée" value={`${harvest.poids_livre_kg} kg`} />
                <InfoRow label="Déjà vendu (GFC)" value={availabilityQuery.data ? `${availabilityQuery.data.alreadySoldKg} kg` : "—"} />
                <InfoRow label="Restant vendable (GFC)" value={availabilityQuery.data ? `${availabilityQuery.data.remainingKg} kg` : "—"} />
              </>
            ) : null}

            {availabilityQuery.data && availabilityQuery.data.linkedSales.length > 0 ? (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ventes GFC liées</p>
                {availabilityQuery.data.linkedSales.map((sale) => (
                  <Link
                    key={sale.saleId}
                    to="/sales/$saleId"
                    params={{ saleId: sale.saleId }}
                    className="flex items-center justify-between gap-4 rounded-md border border-border/50 px-3 py-2 text-sm hover:bg-accent"
                  >
                    <span>{sale.saleNumber ?? sale.saleId}</span>
                    <span className="text-muted-foreground">{sale.quantity} kg — {sale.status}</span>
                  </Link>
                ))}
              </div>
            ) : null}

            {availabilityQuery.data?.hasLegacySale ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Cette récolte a déjà été vendue via l'ancien circuit direct — aucune nouvelle vente GFC n'est possible pour elle.
              </p>
            ) : null}

            {!harvest.sale_wallet_id && !availabilityQuery.data?.linkedSales.length ? (
              <p className="text-sm text-muted-foreground">
                Aucune vente enregistrée pour cette récolte.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card variant="section" className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Récurrence</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setDialog("recurrence")}>
                {recurrenceQuery.data ? "Modifier" : "Configurer"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recurrenceQuery.data ? (
              <>
                <InfoRow label="Fréquence" value={recurrenceQuery.data.frequency} />
                <InfoRow label="Prochaine récolte estimée" value={recurrenceQuery.data.next_expected_date} />
                <InfoRow label="Rappel avant" value={`${recurrenceQuery.data.reminder_days_before} jour(s)`} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aucune récurrence configurée pour {harvest.produit} sur cette exploitation.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {status === "LEGACY" ? (
        <Card variant="information" className="p-4">
          <Badge variant="neutral" appearance="soft">Enregistrement historique</Badge>
          <p className="mt-2 text-sm text-muted-foreground">
            Cette récolte a été créée avant la refonte du parcours (planification/exécution/livraison/vente séparées)
            et conserve son format d'origine.
          </p>
        </Card>
      ) : null}

      <RecordHarvestDialog open={dialog === "record"} onClose={() => setDialog(null)} harvestId={harvestId} onSaved={invalidate} />
      <RecordDeliveryDialog open={dialog === "deliver"} onClose={() => setDialog(null)} harvestId={harvestId} onSaved={invalidate} />
      <CreateHarvestSaleDialog
        open={dialog === "createSale"}
        onClose={() => setDialog(null)}
        harvest={harvest}
        availability={availabilityQuery.data}
      />
      <RescheduleDialog open={dialog === "reschedule"} onClose={() => setDialog(null)} harvestId={harvestId} onSaved={invalidate} />
      <RecurrenceDialog
        open={dialog === "recurrence"}
        onClose={() => setDialog(null)}
        farmId={harvest.farm_id}
        produit={harvest.produit}
        onSaved={async () => {
          await queryClient.invalidateQueries({ queryKey: ["harvest-recurrence", harvest.farm_id, harvest.produit] });
        }}
      />
      {confirmDialog}
    </div>
  );
}

function DialogShell({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function RecordHarvestDialog({
  open, onClose, harvestId, onSaved,
}: { open: boolean; onClose: () => void; harvestId: string; onSaved: () => Promise<void> }) {
  const [poids, setPoids] = useState("");
  const [pertes, setPertes] = useState("");
  const [observations, setObservations] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const poidsValue = Number(poids);
    if (!Number.isFinite(poidsValue) || poidsValue <= 0) {
      setError("Le poids récolté est obligatoire et doit être positif.");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      await recordHarvest({
        data: {
          id: harvestId,
          poids_recolte_kg: poidsValue,
          poids_perte_recolte_kg: pertes.trim() ? Number(pertes) : null,
          observations: observations.trim() || null,
        },
      });
      await onSaved();
      toast.success("Récolte enregistrée.");
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <DialogShell open={open} onClose={onClose} title="Enregistrer la récolte">
      <div className="space-y-4">
        <div>
          <Label>Poids réellement récolté (kg)</Label>
          <Input type="number" min="0.01" step="0.01" value={poids} onChange={(e) => setPoids(e.target.value)} />
        </div>
        <div>
          <Label>Pertes (kg, si applicable)</Label>
          <Input type="number" min="0" step="0.01" value={pertes} onChange={(e) => setPertes(e.target.value)} />
        </div>
        <div>
          <Label>Observations</Label>
          <Textarea rows={3} value={observations} onChange={(e) => setObservations(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button className="w-full" disabled={loading} onClick={submit}>{loading ? "Enregistrement…" : "Enregistrer"}</Button>
      </div>
    </DialogShell>
  );
}

function RecordDeliveryDialog({
  open, onClose, harvestId, onSaved,
}: { open: boolean; onClose: () => void; harvestId: string; onSaved: () => Promise<void> }) {
  const [poids, setPoids] = useState("");
  const [destination, setDestination] = useState("");
  const [receptionnaire, setReceptionnaire] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const poidsValue = Number(poids);
    if (!Number.isFinite(poidsValue) || poidsValue < 0) {
      setError("Le poids livré est obligatoire.");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      await recordHarvestDelivery({
        data: {
          id: harvestId,
          poids_livre_kg: poidsValue,
          destination_reelle: destination.trim() || null,
          receptionnaire: receptionnaire.trim() || null,
          delivery_notes: notes.trim() || null,
        },
      });
      await onSaved();
      toast.success("Livraison enregistrée.");
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <DialogShell open={open} onClose={onClose} title="Enregistrer la livraison">
      <div className="space-y-4">
        <div>
          <Label>Poids livré (kg)</Label>
          <Input type="number" min="0" step="0.01" value={poids} onChange={(e) => setPoids(e.target.value)} />
        </div>
        <div>
          <Label>Destination réelle</Label>
          <Input value={destination} onChange={(e) => setDestination(e.target.value)} />
        </div>
        <div>
          <Label>Réceptionnaire</Label>
          <Input value={receptionnaire} onChange={(e) => setReceptionnaire(e.target.value)} />
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button className="w-full" disabled={loading} onClick={submit}>{loading ? "Enregistrement…" : "Enregistrer"}</Button>
      </div>
    </DialogShell>
  );
}

function CreateHarvestSaleDialog({
  open, onClose, harvest, availability,
}: {
  open: boolean;
  onClose: () => void;
  harvest: { id: string; produit: string; farm_id: string };
  availability: HarvestSaleAvailability | undefined;
}) {
  const navigate = useNavigate();
  const [clientId, setClientId] = useState("");
  const [quantite, setQuantite] = useState("");
  const [prix, setPrix] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingKg = availability?.remainingKg ?? 0;

  useEffect(() => {
    if (open) setQuantite(remainingKg > 0 ? String(remainingKg) : "");
  }, [open, remainingKg]);

  async function submit() {
    const quantiteValue = Number(quantite);
    const prixValue = Number(prix);
    if (!clientId) { setError("Sélectionnez le client de la vente."); return; }
    if (!Number.isFinite(quantiteValue) || quantiteValue <= 0) { setError("La quantité doit être positive."); return; }
    if (quantiteValue > remainingKg) { setError(`La quantité ne peut pas dépasser le restant vendable (${remainingKg} kg).`); return; }
    if (!Number.isFinite(prixValue) || prixValue < 0) { setError("Le prix au kg est obligatoire."); return; }
    try {
      setLoading(true);
      setError(null);
      const sale = await createCommercialSale({
        data: {
          client_id: clientId,
          farm_id: harvest.farm_id,
          business_location_id: null,
          sale_date: new Date().toISOString().slice(0, 10),
          reference: null,
          notes: null,
          lines: [
            {
              description: harvest.produit,
              quantity: quantiteValue,
              unit: "KG",
              unit_price: prixValue,
              inventory_item_id: null,
              harvest_id: harvest.id,
              farm_id: harvest.farm_id,
            },
          ],
        },
      });
      toast.success("Vente créée — poursuivez la confirmation et la facturation depuis la fiche vente.");
      onClose();
      await navigate({ to: "/sales/$saleId", params: { saleId: sale.id } });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <DialogShell open={open} onClose={onClose} title="Créer une vente">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {harvest.produit} — {remainingKg} kg restant vendable sur {availability?.poidsLivreKg ?? "—"} kg livré.
        </p>
        <div>
          <Label>Client <span className="text-destructive">*</span></Label>
          <ClientSelect value={clientId} onValueChange={setClientId} placeholder="Sélectionner un client" disabled={loading} />
        </div>
        <div>
          <Label>Quantité vendue (kg)</Label>
          <Input type="number" min="0.01" max={remainingKg || undefined} step="0.01" value={quantite} onChange={(e) => setQuantite(e.target.value)} />
        </div>
        <div>
          <Label>Prix / kg (FCFA)</Label>
          <Input type="number" min="0" step="0.01" value={prix} onChange={(e) => setPrix(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <p className="text-xs text-muted-foreground">
          Cette vente crée une facture et une créance dans la Grande Fonction Commerciale — l'encaissement se fait ensuite, séparément, depuis la fiche vente.
        </p>
        <Button className="w-full" disabled={loading || remainingKg <= 0} onClick={submit}>{loading ? "Création…" : "Créer la vente"}</Button>
      </div>
    </DialogShell>
  );
}

function RescheduleDialog({
  open, onClose, harvestId, onSaved,
}: { open: boolean; onClose: () => void; harvestId: string; onSaved: () => Promise<void> }) {
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!date) { setError("Une nouvelle date est obligatoire."); return; }
    try {
      setLoading(true);
      setError(null);
      await rescheduleHarvest({ data: { id: harvestId, newDate: date } });
      await onSaved();
      toast.success("Récolte reportée.");
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <DialogShell open={open} onClose={onClose} title="Reporter la récolte">
      <div className="space-y-4">
        <div>
          <Label>Nouvelle date prévue</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button className="w-full" disabled={loading} onClick={submit}>{loading ? "Enregistrement…" : "Reporter"}</Button>
      </div>
    </DialogShell>
  );
}

function RecurrenceDialog({
  open, onClose, farmId, produit, onSaved,
}: { open: boolean; onClose: () => void; farmId: string; produit: string; onSaved: () => Promise<void> }) {
  const [frequency, setFrequency] = useState<"WEEKLY" | "MONTHLY" | "CUSTOM_DAYS">("MONTHLY");
  const [interval, setInterval_] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("");
  const [reminderDays, setReminderDays] = useState("7");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const intervalValue = Number(interval);
    const reminderValue = Number(reminderDays);
    if (!Number.isInteger(intervalValue) || intervalValue <= 0) { setError("L'intervalle doit être un entier positif."); return; }
    try {
      setLoading(true);
      setError(null);
      await configureHarvestRecurrence({
        data: {
          farm_id: farmId,
          produit,
          frequency,
          interval_value: intervalValue,
          day_of_month: frequency === "MONTHLY" && dayOfMonth.trim() ? Number(dayOfMonth) : null,
          reminder_days_before: Number.isInteger(reminderValue) && reminderValue >= 0 ? reminderValue : 3,
        },
      });
      await onSaved();
      toast.success("Récurrence configurée.");
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <DialogShell open={open} onClose={onClose} title={`Récurrence — ${produit}`}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="harvest-recurrence-frequency">Fréquence</Label>
          <Select value={frequency} onValueChange={(value) => setFrequency(value as typeof frequency)}>
            <SelectTrigger id="harvest-recurrence-frequency" className="mt-1 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="WEEKLY">Hebdomadaire</SelectItem>
              <SelectItem value="MONTHLY">Mensuelle</SelectItem>
              <SelectItem value="CUSTOM_DAYS">Tous les N jours</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{frequency === "WEEKLY" ? "Toutes les N semaines" : frequency === "CUSTOM_DAYS" ? "Tous les N jours" : "Tous les N mois"}</Label>
          <Input type="number" min="1" step="1" value={interval} onChange={(e) => setInterval_(e.target.value)} />
        </div>
        {frequency === "MONTHLY" ? (
          <div>
            <Label>Jour indicatif du mois (optionnel)</Label>
            <Input type="number" min="1" max="31" placeholder="18" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
          </div>
        ) : null}
        <div>
          <Label>Rappel avant (jours)</Label>
          <Input type="number" min="0" step="1" value={reminderDays} onChange={(e) => setReminderDays(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button className="w-full" disabled={loading} onClick={submit}>{loading ? "Enregistrement…" : "Enregistrer"}</Button>
      </div>
    </DialogShell>
  );
}
