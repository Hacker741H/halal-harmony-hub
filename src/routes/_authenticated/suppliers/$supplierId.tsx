import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { ArrowLeft, Clock, Contact, Package, Pencil, Receipt, Wallet } from "lucide-react";

import { SupplierForm } from "@/components/suppliers/supplier-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/use-permissions";
import { formatXOF } from "@/lib/format";
import { getSupplier, getSupplierFinancialMetrics, type SupplierFinancialMetrics } from "@/lib/suppliers.functions";
import { getPurchases } from "@/lib/purchases.functions";
import type { PurchaseListItem } from "@/lib/purchases.functions";

export const Route = createFileRoute("/_authenticated/suppliers/$supplierId")({
  component: SupplierDetailsPage,
});

function EmptyPanel({ children }: { children: string }) {
  return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{children}</CardContent></Card>;
}

function Info({ label, value }: { label: string; value: string | null }) {
  return <div><p className="text-sm font-medium">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{value || "—"}</p></div>;
}

function purchaseStatusLabel(status: string) {
  return status === "CANCELLED" ? "Annulé" : "Réceptionné";
}

function SupplierDetailsPage() {
  const { supplierId } = Route.useParams();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [editOpen, setEditOpen] = useState(false);
  const supplierQuery = useQuery({ queryKey: ["supplier", supplierId], queryFn: () => getSupplier({ data: supplierId }) });
  const canReadFinance = can("purchases.finance.read");
  const metricsQuery = useQuery({
    queryKey: ["supplier-financial-metrics", supplierId],
    queryFn: () => getSupplierFinancialMetrics({ data: supplierId }),
    enabled: canReadFinance,
  });
  const purchasesQuery = useQuery({
    queryKey: ["supplier-purchases", supplierId],
    queryFn: () => getPurchases({ data: { page: 1, pageSize: 10, search: "", supplierId, businessLocationId: null, status: null } }),
  });

  if (supplierQuery.isPending) return <div className="p-6 text-muted-foreground">Chargement du fournisseur…</div>;
  if (supplierQuery.isError || !supplierQuery.data) return <div className="space-y-4 p-6"><p className="text-destructive">Fournisseur introuvable ou non autorisé.</p><Button asChild variant="outline"><Link to="/suppliers"><ArrowLeft className="mr-2 h-4 w-4" />Retour aux fournisseurs</Link></Button></div>;

  const supplier = supplierQuery.data;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <Button asChild variant="ghost" className="-ml-2 px-2"><Link to="/suppliers"><ArrowLeft className="mr-2 h-4 w-4" />Fournisseurs</Link></Button>

      <OperationalHero
        variant="deep"
        icon={Contact}
        eyebrow="Fournisseur"
        title={supplier.display_name}
        description={`${supplier.supplier_number}${supplier.legal_name ? ` · ${supplier.legal_name}` : ""}`}
        actions={
          <>
            <Badge variant={supplier.status === "ACTIVE" ? "success" : "outline"}>{supplier.status === "ACTIVE" ? "Actif" : "Archivé"}</Badge>
            {can("suppliers.update") && supplier.status === "ACTIVE" ? (
              <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="mr-2 h-4 w-4" />Modifier</Button>
            ) : null}
          </>
        }
      />

      <Tabs defaultValue="informations" className="space-y-5">
        <TabsList className="h-auto flex-wrap justify-start"><TabsTrigger value="informations">Informations</TabsTrigger><TabsTrigger value="achats">Achats & dette</TabsTrigger></TabsList>
        <TabsContent value="informations">
          <Card>
            <CardHeader><CardTitle>Informations générales</CardTitle></CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <Info label="Pays" value={supplier.country_code === "CI" ? "Côte d’Ivoire" : supplier.country_code === "SN" ? "Sénégal" : supplier.country_code} />
              <Info label="Téléphone" value={supplier.telephone} />
              <Info label="E-mail" value={supplier.email} />
              <Info label="Ville" value={supplier.city} />
              <Info label="Adresse" value={supplier.address} />
              <div className="md:col-span-2"><Info label="Notes internes" value={supplier.notes} /></div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="achats">
          {!canReadFinance ? <EmptyPanel>Vous n’avez pas l’autorisation de consulter les achats et dettes de ce fournisseur.</EmptyPanel> : (
            <SupplierPurchasesPanel supplierId={supplierId} metricsQuery={metricsQuery} purchasesQuery={purchasesQuery} />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Modifier le fournisseur</DialogTitle></DialogHeader>
          <SupplierForm
            supplier={supplier}
            onSuccess={() => {
              setEditOpen(false);
              void queryClient.invalidateQueries({ queryKey: ["supplier", supplierId] });
              void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SupplierPurchasesPanel({
  supplierId,
  metricsQuery,
  purchasesQuery,
}: {
  supplierId: string;
  metricsQuery: UseQueryResult<SupplierFinancialMetrics>;
  purchasesQuery: UseQueryResult<{ purchases: PurchaseListItem[]; total: number }>;
}) {
  const metrics = metricsQuery.data;
  const purchases = purchasesQuery.data?.purchases ?? [];
  const total = purchasesQuery.data?.total ?? 0;

  return (
    <div className="space-y-5">
      {metricsQuery.isPending ? (
        <EmptyPanel>Calcul des indicateurs fournisseur…</EmptyPanel>
      ) : metricsQuery.isError || !metrics ? (
        <EmptyPanel>Impossible de charger les indicateurs. Réessayez dans un instant.</EmptyPanel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Package} label="Achats" value={metrics.purchase_count} description="Achats enregistrés" />
          <MetricCard icon={Receipt} label="Total acheté" value={formatXOF(metrics.total_purchased)} description="Montant total des achats" />
          <MetricCard icon={Wallet} label="Payé" value={formatXOF(metrics.total_paid)} description="Total réglé au fournisseur" tone="success" />
          <MetricCard icon={Clock} label="Dette restante" value={formatXOF(metrics.amount_due)} description="Solde dû au fournisseur" tone="warning" />
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>Achats récents</CardTitle>
          <Button asChild variant="outline" size="sm"><Link to="/purchases" search={{ supplierId }}>Voir tous les achats{total ? ` (${total})` : ""}</Link></Button>
        </CardHeader>
        <CardContent>
          {purchasesQuery.isPending ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Chargement des achats…</p>
          ) : purchasesQuery.isError ? (
            <p className="py-8 text-center text-sm text-destructive">Impossible de charger les achats. Réessayez dans un instant.</p>
          ) : purchases.length ? (
            <ul className="space-y-2">
              {purchases.map((purchase) => (
                <li key={purchase.id}>
                  <Link to="/purchases/$purchaseId" params={{ purchaseId: purchase.id }} className="flex flex-col gap-2 rounded-lg border p-3 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{purchase.purchase_number}</span>
                        <Badge variant={purchase.status === "CANCELLED" ? "danger" : "success"}>{purchaseStatusLabel(purchase.status)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${purchase.purchase_date}T12:00:00`))}</p>
                    </div>
                    <p className="text-sm font-semibold">
                      {purchase.amountDue !== null && purchase.amountDue > 0 ? `Reste dû : ${formatXOF(purchase.amountDue)}` : formatXOF(purchase.total_amount)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">Aucun achat pour ce fournisseur.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
