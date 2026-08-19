import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Archive, ArrowLeft, Building2, Clock, Merge, Pencil, Receipt, RotateCcw, ShoppingCart, TrendingUp, Undo2, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ClientForm } from "@/components/clients/client-form";
import { EntityDocumentsTab } from "@/components/documents/entity-documents-tab";
import { ClientSelect } from "@/components/selects/entity-selects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MetricCard } from "@/components/ui/metric-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/hooks/use-confirm";
import { usePermissions } from "@/hooks/use-permissions";
import { formatXOF } from "@/lib/format";
import {
  archiveClient,
  getClient,
  getClientAuditHistory,
  getClientFinancialMetrics,
  getCommercialClientFinancialMetrics,
  mergeClients,
  restoreClient,
  type CommercialClientFinancialMetrics,
} from "@/lib/clients.functions";
import { getCommercialSales } from "@/lib/commercial-sales.functions";
import type { CommercialSaleListItem } from "@/lib/commercial-sales.functions";

export const Route = createFileRoute("/_authenticated/clients/$clientId")({
  component: ClientDetailsPage,
});

function EmptyPanel({ children }: { children: string }) {
  return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{children}</CardContent></Card>;
}

function ClientDetailsPage() {
  const { clientId } = Route.useParams();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { confirm, dialog } = useConfirm();
  const [editOpen, setEditOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeReason, setMergeReason] = useState("");
  const clientQuery = useQuery({ queryKey: ["client", clientId], queryFn: () => getClient({ data: clientId }) });
  const historyQuery = useQuery({ queryKey: ["client-history", clientId], queryFn: () => getClientAuditHistory({ data: clientId }) });
  const metricsQuery = useQuery({
    queryKey: ["client-financial-metrics", clientId],
    queryFn: () => getClientFinancialMetrics({ data: clientId }),
    enabled: can("clients.financial.read"),
  });
  const canReadCommercialFinance = can("sales.finance.read");
  const commercialMetricsQuery = useQuery({
    queryKey: ["client-commercial-metrics", clientId],
    queryFn: () => getCommercialClientFinancialMetrics({ data: clientId }),
    enabled: canReadCommercialFinance,
  });
  const commercialSalesQuery = useQuery({
    queryKey: ["client-commercial-sales", clientId],
    queryFn: () => getCommercialSales({ data: {
      page: 1, pageSize: 5, search: "", status: null, clientId, farmId: null, from: null, to: null,
    } }),
    enabled: canReadCommercialFinance,
  });
  const archiveMutation = useMutation({
    mutationFn: archiveClient,
    onSuccess: () => { toast.success("Client archivé."); void queryClient.invalidateQueries({ queryKey: ["client", clientId] }); void queryClient.invalidateQueries({ queryKey: ["clients"] }); void historyQuery.refetch(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Impossible d’archiver ce client."),
  });
  const restoreMutation = useMutation({
    mutationFn: restoreClient,
    onSuccess: () => { toast.success("Client restauré."); void queryClient.invalidateQueries({ queryKey: ["client", clientId] }); void queryClient.invalidateQueries({ queryKey: ["clients"] }); void historyQuery.refetch(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Impossible de restaurer ce client."),
  });
  const mergeMutation = useMutation({
    mutationFn: () => mergeClients({ data: { sourceClientId: clientId, targetClientId: mergeTargetId, reason: mergeReason } }),
    onSuccess: () => { toast.success("Client fusionné et archivé."); setMergeOpen(false); void queryClient.invalidateQueries({ queryKey: ["client", clientId] }); void queryClient.invalidateQueries({ queryKey: ["clients"] }); void historyQuery.refetch(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Impossible de fusionner les clients."),
  });

  if (clientQuery.isPending) return <div className="p-6 text-muted-foreground">Chargement du client…</div>;
  if (clientQuery.isError || !clientQuery.data) return <div className="space-y-4 p-6"><p className="text-destructive">Client introuvable ou non autorisé.</p><Button asChild variant="outline"><Link to="/clients"><ArrowLeft className="mr-2 h-4 w-4" />Retour aux clients</Link></Button></div>;

  const client = clientQuery.data;
  const metrics = metricsQuery.data;
  const canEdit = can("clients.update") && client.status === "ACTIVE";
  const canArchive = can("clients.archive");
  const canMerge = can("clients.merge") && client.status === "ACTIVE";

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><Button asChild variant="ghost" className="px-0"><Link to="/clients"><ArrowLeft className="mr-2 h-4 w-4" />Clients</Link></Button><h1 className="mt-2 flex items-center gap-3 text-3xl font-bold"><Building2 className="h-7 w-7" />{client.display_name}</h1><p className="text-muted-foreground">{client.client_number}{client.legal_name ? ` · ${client.legal_name}` : ""}</p></div><div className="flex flex-wrap gap-2"><Badge variant={client.status === "ACTIVE" ? "success" : "outline"}>{client.status === "ACTIVE" ? "Actif" : "Archivé"}</Badge>{canEdit ? <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="mr-2 h-4 w-4" />Modifier</Button> : null}{canMerge ? <Button variant="outline" onClick={() => setMergeOpen(true)}><Merge className="mr-2 h-4 w-4" />Fusionner</Button> : null}{canArchive && client.status === "ACTIVE" ? <Button variant="outline" onClick={() => confirm({ title: "Archiver ce client", description: `Archiver ${client.display_name} ?`, variant: "destructive", confirmLabel: "Archiver", onConfirm: async () => { await archiveMutation.mutateAsync({ data: { id: client.id } }); } })} disabled={archiveMutation.isPending}><Archive className="mr-2 h-4 w-4" />Archiver</Button> : null}{canArchive && client.status === "ARCHIVED" && !client.merged_into_client_id ? <Button variant="outline" onClick={() => restoreMutation.mutate({ data: { id: client.id } })} disabled={restoreMutation.isPending}><RotateCcw className="mr-2 h-4 w-4" />Restaurer</Button> : null}</div></div>

      <Tabs defaultValue="informations" className="space-y-5"><TabsList className="h-auto flex-wrap justify-start"><TabsTrigger value="informations">Informations</TabsTrigger><TabsTrigger value="commerce">Activité commerciale</TabsTrigger><TabsTrigger value="missions">Missions</TabsTrigger><TabsTrigger value="factures">Factures</TabsTrigger><TabsTrigger value="paiements">Paiements</TabsTrigger><TabsTrigger value="documents">Documents</TabsTrigger><TabsTrigger value="historique">Historique</TabsTrigger><TabsTrigger value="rentabilite">Rentabilité</TabsTrigger></TabsList>
        <TabsContent value="informations"><Card><CardHeader><CardTitle>Informations générales</CardTitle></CardHeader><CardContent className="grid gap-5 md:grid-cols-2"><Info label="Type" value={client.kind === "INDIVIDUAL" ? "Personne physique" : "Organisation"} /><Info label="Pays" value={client.country_code === "CI" ? "Côte d’Ivoire" : client.country_code === "SN" ? "Sénégal" : client.country_code} /><Info label="Téléphone" value={client.telephone} /><Info label="E-mail" value={client.email} /><Info label="Ville" value={client.city} /><Info label="Adresse" value={client.address} /><Info label="Contact principal" value={client.contact_name} /><Info label="Téléphone du contact" value={client.contact_phone} /><Info label="E-mail du contact" value={client.contact_email} /><Info label="Identifiant légal" value={client.registration_identifier_type && client.registration_identifier_value ? `${client.registration_identifier_type} · ${client.registration_identifier_value}` : null} /><div className="md:col-span-2"><Info label="Notes internes" value={client.notes} /></div>{client.merged_into_client_id ? <div className="md:col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">Ce client a été fusionné et archivé. Les relations ont été transférées vers la fiche cible.</div> : null}</CardContent></Card></TabsContent>
        <TabsContent value="commerce">{!canReadCommercialFinance ? <EmptyPanel>Vous n’avez pas l’autorisation de consulter l’activité commerciale de ce client.</EmptyPanel> : <CommercialActivityPanel clientId={clientId} metricsQuery={commercialMetricsQuery} salesQuery={commercialSalesQuery} />}</TabsContent>
        <TabsContent value="missions"><EmptyPanel>Les Missions de transport ne sont pas encore implémentées. Aucune donnée fictive n’est affichée.</EmptyPanel></TabsContent>
        <TabsContent value="factures"><EmptyPanel>Les Factures de mission ne sont pas encore implémentées. Aucune créance n’est calculée.</EmptyPanel></TabsContent>
        <TabsContent value="paiements"><EmptyPanel>Les Paiements de mission ne sont pas encore implémentés. Aucun encaissement n’est affiché.</EmptyPanel></TabsContent>
        <TabsContent value="documents"><EntityDocumentsTab entityId={clientId} relation="client" /></TabsContent>
        <TabsContent value="historique"><Card><CardHeader><CardTitle>Historique Client</CardTitle></CardHeader><CardContent>{historyQuery.isPending ? <p className="text-sm text-muted-foreground">Chargement de l’historique…</p> : historyQuery.isError ? <p className="text-sm text-destructive">Impossible de charger l’historique.</p> : historyQuery.data?.length ? <ol className="space-y-3">{historyQuery.data.map((entry) => <li key={entry.id} className="rounded-lg border p-3"><p className="font-medium">{historyLabel(entry.action)}</p><p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.created_at))}</p></li>)}</ol> : <p className="py-8 text-center text-sm text-muted-foreground">Aucun événement visible.</p>}</CardContent></Card></TabsContent>
        <TabsContent value="rentabilite">{!can("clients.financial.read") ? <EmptyPanel>Vous n’avez pas l’autorisation de consulter les indicateurs financiers Client.</EmptyPanel> : metricsQuery.isPending ? <EmptyPanel>Calcul des indicateurs financiers…</EmptyPanel> : !metrics?.metrics_available ? <EmptyPanel>Les indicateurs financiers seront calculés depuis les Missions, Factures et Paiements lorsqu’ils seront implémentés. Aucune valeur n’est présentée comme zéro.</EmptyPanel> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard icon={Receipt} label="Facturé" value={formatXOF(metrics.total_billed)} description="Total facturé au client" /><MetricCard icon={Wallet} label="Encaissé" value={formatXOF(metrics.total_received)} description="Total encaissé" tone="success" /><MetricCard icon={Clock} label="À recevoir" value={formatXOF(metrics.amount_due)} description="Reste à encaisser" tone="warning" /><MetricCard icon={TrendingUp} label="Résultat brut" value={formatXOF(metrics.gross_result)} description="Encaissé moins coûts directs" tone="info" /></div>}</TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Modifier le client</DialogTitle></DialogHeader><ClientForm client={client} onSuccess={() => { setEditOpen(false); void queryClient.invalidateQueries({ queryKey: ["client", clientId] }); void queryClient.invalidateQueries({ queryKey: ["clients"] }); void historyQuery.refetch(); }} /></DialogContent></Dialog>
      <Dialog open={mergeOpen} onOpenChange={(open) => { setMergeOpen(open); if (!open) { setMergeTargetId(""); setMergeReason(""); } }}><DialogContent><DialogHeader><DialogTitle>Fusionner ce client</DialogTitle></DialogHeader><div className="space-y-4"><p className="text-sm text-muted-foreground">Le client actuel sera archivé. Les relations autorisées seront transférées au client cible dans une transaction auditée.</p><div className="space-y-2"><label className="text-sm font-medium" htmlFor="merge-target">Client cible</label><ClientSelect value={mergeTargetId} onValueChange={setMergeTargetId} placeholder="Sélectionner le client à conserver" /></div><div className="space-y-2"><label className="text-sm font-medium" htmlFor="merge-reason">Justification</label><Textarea id="merge-reason" value={mergeReason} onChange={(event) => setMergeReason(event.target.value)} placeholder="Expliquez la raison de cette fusion…" /></div><Button className="w-full" disabled={!mergeTargetId || mergeReason.trim().length < 10 || mergeMutation.isPending} onClick={() => mergeMutation.mutate()}>{mergeMutation.isPending ? "Fusion en cours…" : "Confirmer la fusion"}</Button></div></DialogContent></Dialog>
      {dialog}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return <div><p className="text-sm font-medium">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{value || "—"}</p></div>;
}

function historyLabel(action: string) {
  const labels: Record<string, string> = { CREATE: "Création", UPDATE: "Modification", ARCHIVE: "Archivage", RESTORE: "Restauration", MERGE: "Fusion" };
  return labels[action] ?? action;
}

function saleStatusLabel(status: string) {
  const labels: Record<string, string> = { DRAFT: "Brouillon", CONFIRMED: "Confirmée", CANCELLED: "Annulée", ARCHIVED: "Archivée" };
  return labels[status] ?? status;
}

function saleStatusVariant(status: string): "outline" | "success" | "danger" | "neutral" {
  if (status === "CONFIRMED") return "success";
  if (status === "CANCELLED") return "danger";
  if (status === "ARCHIVED") return "neutral";
  return "outline";
}

function CommercialActivityPanel({
  clientId,
  metricsQuery,
  salesQuery,
}: {
  clientId: string;
  metricsQuery: UseQueryResult<CommercialClientFinancialMetrics>;
  salesQuery: UseQueryResult<{ sales: CommercialSaleListItem[]; total: number }>;
}) {
  const metrics = metricsQuery.data;
  const sales = salesQuery.data?.sales ?? [];
  const totalSales = salesQuery.data?.total ?? 0;

  return (
    <div className="space-y-5">
      {metricsQuery.isPending ? (
        <EmptyPanel>Calcul des indicateurs commerciaux…</EmptyPanel>
      ) : metricsQuery.isError || !metrics ? (
        <EmptyPanel>Impossible de charger les indicateurs. Réessayez dans un instant.</EmptyPanel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={ShoppingCart} label="Ventes" value={metrics.sale_count} description="Ventes commerciales" />
          <MetricCard icon={Receipt} label="Facturé" value={formatXOF(metrics.total_invoiced)} description="Total facturé" />
          <MetricCard icon={Wallet} label="Encaissé" value={formatXOF(metrics.total_received)} description="Total encaissé" tone="success" />
          <MetricCard icon={Undo2} label="Retourné" value={formatXOF(metrics.total_returned)} description="Montant retourné" tone="warning" />
          <MetricCard icon={Clock} label="Reste à recevoir" value={formatXOF(metrics.amount_due)} description="Solde dû" tone="info" />
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>Ventes récentes</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link to="/sales" search={{ clientId }}>Voir toutes les ventes{totalSales ? ` (${totalSales})` : ""}</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {salesQuery.isPending ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Chargement des ventes…</p>
          ) : salesQuery.isError ? (
            <p className="py-8 text-center text-sm text-destructive">Impossible de charger les ventes. Réessayez dans un instant.</p>
          ) : sales.length ? (
            <ul className="space-y-2">
              {sales.map((sale) => (
                <li key={sale.id}>
                  <Link
                    to="/sales/$saleId"
                    params={{ saleId: sale.id }}
                    className="flex flex-col gap-2 rounded-lg border p-3 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{sale.sale_number}</span>
                        <Badge variant={saleStatusVariant(sale.status)}>{saleStatusLabel(sale.status)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${sale.sale_date}T12:00:00`))}
                      </p>
                    </div>
                    <p className="text-sm font-semibold">
                      {sale.amountDue !== null && sale.amountDue > 0
                        ? `Reste dû : ${formatXOF(sale.amountDue)}`
                        : sale.totalInvoiced !== null
                          ? formatXOF(sale.totalInvoiced)
                          : "—"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">Aucune vente commerciale pour ce client.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
