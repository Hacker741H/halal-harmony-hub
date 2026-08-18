import { useState } from "react";
import { Link, Outlet, createFileRoute, useMatchRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bike,
  Car,
  CircleDollarSign,
  FileText,
  History,
  Pencil,
  ShieldCheck,
  UserRound,
  Wallet,
} from "lucide-react";

import { EntityDocumentsTab } from "@/components/documents/entity-documents-tab";
import { EntityAlertsSection } from "@/components/notifications/entity-alerts-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MetricCard } from "@/components/ui/metric-card";
import { ModuleHero } from "@/components/ui/module-hero";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DriverForm } from "@/components/drivers/driver-form";
import { getDriverAssignments } from "@/lib/assignments.functions";
import { getContractsForRelation } from "@/lib/contracts.functions";
import { getDocumentsForRelation } from "@/lib/documents.functions";
import { getDriver, getDriverFinanceOperations } from "@/lib/drivers.functions";
import { getSalaryPaymentsByDriver } from "@/lib/salary-payments.functions";

export const Route = createFileRoute("/_authenticated/drivers/$driverId")({ component: DriverDetailsPage });

function formatAmount(value: number) {
  return `${value.toLocaleString("fr-FR")} FCFA`;
}

function DriverDetailsPage() {
  const { driverId } = Route.useParams();
  const matchRoute = useMatchRoute();
  const isActivityRoute = Boolean(
    matchRoute({
      to: "/drivers/$driverId/activity",
      params: { driverId },
      fuzzy: false,
    }),
  );

  if (isActivityRoute) {
    return <Outlet />;
  }

  return <DriverDetailsContent driverId={driverId} />;
}

function DriverDetailsContent({ driverId }: { driverId: string }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const driverQuery = useQuery({
    queryKey: ["driver", driverId],
    queryFn: () => getDriver({ data: driverId }),
  });
  const assignmentsQuery = useQuery({
    queryKey: ["driver-assignments", driverId],
    queryFn: () => getDriverAssignments({ data: driverId }),
  });
  const contractsQuery = useQuery({
    queryKey: ["driver-contracts", driverId],
    queryFn: () => getContractsForRelation({ data: { entity_id: driverId, relation: "driver" } }),
  });
  const documentsQuery = useQuery({
    queryKey: ["driver-documents", driverId],
    queryFn: () => getDocumentsForRelation({ data: { entity_id: driverId, relation: "driver" } }),
  });
  const financeQuery = useQuery({
    queryKey: ["driver-finance", driverId],
    queryFn: () => getDriverFinanceOperations({ data: driverId }),
  });
  const salariesQuery = useQuery({
    queryKey: ["driver-salaries", driverId],
    queryFn: () => getSalaryPaymentsByDriver({ data: driverId }),
  });

  if (driverQuery.isPending) {
    return <p className="text-muted-foreground">Chargement du chauffeur…</p>;
  }

  const driver = driverQuery.data;
  if (!driver) {
    return (
      <Card>
        <CardContent className="p-6">Chauffeur introuvable ou inaccessible.</CardContent>
      </Card>
    );
  }

  const assignments = assignmentsQuery.data ?? { vehicles: [], motorcycles: [] };
  const contracts = contractsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const finance = financeQuery.data ?? [];
  const salaries = salariesQuery.data ?? [];
  const financeTotal = finance.reduce((total, operation) => total + Number(operation.amount), 0);
  const driverName = [driver.employees?.nom, driver.employees?.prenom].filter(Boolean).join(" ") || "Chauffeur sans employé";

  return (
    <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
      <Button asChild variant="ghost">
        <Link to="/drivers">
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Retour aux chauffeurs
        </Link>
      </Button>

      <ModuleHero
        icon={UserRound}
        eyebrow="Profil opérationnel"
        title={driverName}
        description="Une vue unique des affectations, contrats, documents et opérations liés à ce chauffeur."
        actions={
          <>
            <Badge variant="info" appearance="soft">{driver.statut || "Statut non renseigné"}</Badge>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
              Modifier
            </Button>
            <Button asChild variant="outline">
              <Link to="/drivers/$driverId/activity" params={{ driverId }}>
                <Wallet className="mr-2 h-4 w-4" aria-hidden="true" />
                Activité & rémunération
              </Link>
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Véhicules affectés"
            value={assignments.vehicles.length}
            description="Affectations enregistrées"
            icon={Car}
            tone="info"
          />
          <MetricCard
            label="Motos affectées"
            value={assignments.motorcycles.length}
            description="Affectations enregistrées"
            icon={Bike}
            tone="primary"
          />
          <MetricCard
            label="Documents liés"
            value={documents.length}
            description="Documents accessibles"
            icon={FileText}
            tone="success"
          />
          <MetricCard
            label="Opérations liées"
            value={finance.length}
            description="Écritures financières associées"
            icon={CircleDollarSign}
            tone="warning"
          />
        </div>
      </ModuleHero>

      <Tabs defaultValue="informations" className="space-y-4">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border bg-surface-elevated/80 p-1.5">
          <TabsTrigger value="informations">Informations</TabsTrigger>
          <TabsTrigger value="affectations">Affectations</TabsTrigger>
          <TabsTrigger value="vehicules">Véhicules</TabsTrigger>
          <TabsTrigger value="motos">Motos</TabsTrigger>
          <TabsTrigger value="contrats">Contrats</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="finances">Finances</TabsTrigger>
          <TabsTrigger value="salaires">Salaires</TabsTrigger>
          <TabsTrigger value="alertes">Alertes</TabsTrigger>
          <TabsTrigger value="historique">Historique</TabsTrigger>
          <TabsTrigger value="statistiques">Statistiques</TabsTrigger>
        </TabsList>

        <TabsContent value="informations">
          <Card variant="section">
            <CardHeader>
              <CardTitle>Informations du chauffeur</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Info label="Employé" value={driverName} />
              <Info label="Téléphone" value={driver.employees?.telephone} />
              <Info label="Poste" value={driver.employees?.poste} />
              <Info label="Permis" value={driver.numero_permis} />
              <Info label="Catégorie" value={driver.categorie_permis} />
              <Info label="Expiration permis" value={driver.date_expiration_permis} />
              <Info label="Statut" value={driver.statut} />
              <Info label="Notes" value={driver.notes} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="affectations">
          <AssignmentHistory vehicles={assignments.vehicles} motorcycles={assignments.motorcycles} />
        </TabsContent>
        <TabsContent value="vehicules">
          <AssetList
            title="Véhicules"
            assets={assignments.vehicles.map((assignment) => ({
              id: assignment.vehicle?.id,
              label: assignment.vehicle?.registration,
              date: assignment.start_date,
              active: assignment.status === "ACTIVE",
            }))}
            route="vehicle"
          />
        </TabsContent>
        <TabsContent value="motos">
          <AssetList
            title="Motos"
            assets={assignments.motorcycles.map((assignment) => ({
              id: assignment.motorcycle?.id,
              label: assignment.motorcycle?.immatriculation,
              date: assignment.start_date,
              active: assignment.status === "ACTIVE",
            }))}
            route="motorcycle"
          />
        </TabsContent>
        <TabsContent value="contrats">
          <SimpleList
            title="Contrats liés"
            items={contracts.map((contract) => ({
              id: contract.id,
              title: contract.reference || contract.type || "Contrat",
              detail: contract.partie || contract.statut || "-",
            }))}
          />
        </TabsContent>
        <TabsContent value="documents">
          <EntityDocumentsTab entityId={driverId} relation="driver" />
        </TabsContent>
        <TabsContent value="finances">
          <SimpleList
            title="Opérations financières"
            items={finance.map((operation) => ({
              id: operation.id,
              title: `${operation.type} · ${formatAmount(Number(operation.amount))}`,
              detail: operation.description || operation.operation_date,
            }))}
          />
        </TabsContent>
        <TabsContent value="salaires">
          <SimpleList
            title="Salaires versés"
            items={salaries.map((salary) => ({
              id: salary.id,
              title: formatAmount(Number(salary.amount)),
              detail: `${salary.period_start} · ${salary.status}`,
            }))}
          />
        </TabsContent>
        <TabsContent value="alertes">
          <EntityAlertsSection entityId={driverId} relation="driver" />
        </TabsContent>
        <TabsContent value="historique">
          <Card variant="section">
            <CardHeader>
              <CardTitle>
                <History className="mr-2 inline h-5 w-5" aria-hidden="true" />
                Historique
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              Créé le {new Intl.DateTimeFormat("fr-FR").format(new Date(driver.created_at))}. Les changements
              d’affectation sont tracés dans leur historique ci-dessus.
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="statistiques">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              label="Véhicules affectés"
              value={assignments.vehicles.length}
              description="Historique des affectations"
              icon={Car}
              tone="info"
            />
            <MetricCard
              label="Motos affectées"
              value={assignments.motorcycles.length}
              description="Historique des affectations"
              icon={Bike}
              tone="primary"
            />
            <MetricCard
              label="Montant financier"
              value={formatAmount(financeTotal)}
              description="Total des opérations liées"
              icon={CircleDollarSign}
              tone="success"
            />
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Modifier le chauffeur</DialogTitle></DialogHeader>
          <DriverForm
            driver={driver}
            onSuccess={() => {
              setEditOpen(false);
              void queryClient.invalidateQueries({ queryKey: ["driver", driverId] });
              void queryClient.invalidateQueries({ queryKey: ["drivers"] });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-xl border border-border/75 bg-surface-elevated/55 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 break-words font-medium text-foreground">{value || "-"}</p>
    </div>
  );
}

function SimpleList({
  title,
  items,
}: {
  title: string;
  items: Array<{ id: string; title: string; detail: string; href?: string | null }>;
}) {
  return (
    <Card variant="analytics">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed p-7 text-center text-sm text-muted-foreground">
            Aucune donnée liée.
          </p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-border/75 bg-surface/70 p-4 transition-ui hover:border-primary/25 hover:shadow-xs"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{item.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
              </div>
              {item.href ? (
                <Button asChild size="sm" variant="outline">
                  <a href={item.href} target="_blank" rel="noreferrer">Ouvrir</a>
                </Button>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function AssetList({
  title,
  assets,
  route,
}: {
  title: string;
  assets: Array<{ id: string | undefined; label: string | undefined; date: string | null; active: boolean }>;
  route: "vehicle" | "motorcycle";
}) {
  return (
    <Card variant="analytics">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {assets.length === 0 ? (
          <p className="rounded-xl border border-dashed p-7 text-center text-sm text-muted-foreground">
            Aucune affectation.
          </p>
        ) : (
          assets.map((asset, index) => (
            <div
              key={`${asset.id}-${index}`}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/75 bg-surface/70 p-4"
            >
              <div>
                <p className="font-medium text-foreground">{asset.label || "Actif supprimé"}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {asset.active ? "Affectation active" : "Affectation terminée"} · {asset.date || "date inconnue"}
                </p>
              </div>
              {asset.id && route === "vehicle" ? (
                <Button asChild size="sm" variant="outline">
                  <Link to="/vehicles/$vehicleId" params={{ vehicleId: asset.id }}>Ouvrir</Link>
                </Button>
              ) : null}
              {asset.id && route === "motorcycle" ? (
                <Button asChild size="sm" variant="outline">
                  <Link to="/motorcycles/$motorcycleId" params={{ motorcycleId: asset.id }}>Ouvrir</Link>
                </Button>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function AssignmentHistory({
  vehicles,
  motorcycles,
}: {
  vehicles: Awaited<ReturnType<typeof getDriverAssignments>>["vehicles"];
  motorcycles: Awaited<ReturnType<typeof getDriverAssignments>>["motorcycles"];
}) {
  return (
    <Card variant="analytics">
      <CardHeader>
        <CardTitle>
          <ShieldCheck className="mr-2 inline h-5 w-5" aria-hidden="true" />
          Historique des affectations
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {vehicles.length + motorcycles.length === 0 ? (
          <p className="rounded-xl border border-dashed p-7 text-center text-sm text-muted-foreground sm:col-span-2">
            Aucune affectation.
          </p>
        ) : (
          <>
            <Info label="Véhicules" value={`${vehicles.length} affectation${vehicles.length > 1 ? "s" : ""}`} />
            <Info label="Motos" value={`${motorcycles.length} affectation${motorcycles.length > 1 ? "s" : ""}`} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
