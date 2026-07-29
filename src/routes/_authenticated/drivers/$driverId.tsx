import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Car, FileText, History, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EntityDocumentsTab } from "@/components/documents/entity-documents-tab";
import { EntityAlertsSection } from "@/components/notifications/entity-alerts-section";
import { getDriver, getDriverFinanceOperations } from "@/lib/drivers.functions";
import { getDriverAssignments } from "@/lib/assignments.functions";
import { getContractsForRelation } from "@/lib/contracts.functions";
import { getDocumentsForRelation } from "@/lib/documents.functions";
import { getSalaryPaymentsByDriver } from "@/lib/salary-payments.functions";

export const Route = createFileRoute("/_authenticated/drivers/$driverId")({ component: DriverDetailsPage });

function formatAmount(value: number) {
  return `${value.toLocaleString("fr-FR")} FCFA`;
}

function DriverDetailsPage() {
  const { driverId } = Route.useParams();
  const driverQuery = useQuery({ queryKey: ["driver", driverId], queryFn: () => getDriver({ data: driverId }) });
  const assignmentsQuery = useQuery({ queryKey: ["driver-assignments", driverId], queryFn: () => getDriverAssignments({ data: driverId }) });
  const contractsQuery = useQuery({ queryKey: ["driver-contracts", driverId], queryFn: () => getContractsForRelation({ data: { entity_id: driverId, relation: "driver" } }) });
  const documentsQuery = useQuery({ queryKey: ["driver-documents", driverId], queryFn: () => getDocumentsForRelation({ data: { entity_id: driverId, relation: "driver" } }) });
  const financeQuery = useQuery({ queryKey: ["driver-finance", driverId], queryFn: () => getDriverFinanceOperations({ data: driverId }) });
  const salariesQuery = useQuery({ queryKey: ["driver-salaries", driverId], queryFn: () => getSalaryPaymentsByDriver({ data: driverId }) });

  if (driverQuery.isPending) return <p className="text-muted-foreground">Chargement du chauffeur…</p>;
  const driver = driverQuery.data;
  if (!driver) return <Card><CardContent className="p-6">Chauffeur introuvable ou inaccessible.</CardContent></Card>;

  const assignments = assignmentsQuery.data ?? { vehicles: [], motorcycles: [] };
  const contracts = contractsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const finance = financeQuery.data ?? [];
  const salaries = salariesQuery.data ?? [];
  const financeTotal = finance.reduce((total, operation) => total + Number(operation.amount), 0);

  return <div className="space-y-6">
    <Button asChild variant="ghost"><Link to="/drivers"><ArrowLeft className="mr-2 h-4 w-4" />Retour aux chauffeurs</Link></Button>
    <div><h1 className="text-3xl font-bold">{[driver.employees?.nom, driver.employees?.prenom].filter(Boolean).join(" ") || "Chauffeur sans employé"}</h1><p className="text-muted-foreground">Fiche chauffeur à 360°</p></div>
    <Tabs defaultValue="informations" className="space-y-4">
      <TabsList className="h-auto flex-wrap justify-start"><TabsTrigger value="informations">Informations</TabsTrigger><TabsTrigger value="affectations">Affectations</TabsTrigger><TabsTrigger value="vehicules">Véhicules</TabsTrigger><TabsTrigger value="motos">Motos</TabsTrigger><TabsTrigger value="contrats">Contrats</TabsTrigger><TabsTrigger value="documents">Documents</TabsTrigger><TabsTrigger value="finances">Finances</TabsTrigger><TabsTrigger value="salaires">Salaires</TabsTrigger><TabsTrigger value="alertes">Alertes</TabsTrigger><TabsTrigger value="historique">Historique</TabsTrigger><TabsTrigger value="statistiques">Statistiques</TabsTrigger></TabsList>
      <TabsContent value="informations"><Card><CardHeader><CardTitle>Informations</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3"><Info label="Employé" value={[driver.employees?.nom, driver.employees?.prenom].filter(Boolean).join(" ")} /><Info label="Téléphone" value={driver.employees?.telephone} /><Info label="Poste" value={driver.employees?.poste} /><Info label="Permis" value={driver.numero_permis} /><Info label="Catégorie" value={driver.categorie_permis} /><Info label="Expiration permis" value={driver.date_expiration_permis} /><Info label="Statut" value={driver.statut} /><Info label="Notes" value={driver.notes} /></CardContent></Card></TabsContent>
      <TabsContent value="affectations"><AssignmentHistory vehicles={assignments.vehicles} motorcycles={assignments.motorcycles} /></TabsContent>
      <TabsContent value="vehicules"><AssetList title="Véhicules" assets={assignments.vehicles.map((assignment) => ({ id: assignment.vehicle?.id, label: assignment.vehicle?.registration, date: assignment.start_date, active: assignment.status === "ACTIVE" }))} route="vehicle" /></TabsContent>
      <TabsContent value="motos"><AssetList title="Motos" assets={assignments.motorcycles.map((assignment) => ({ id: assignment.motorcycle?.id, label: assignment.motorcycle?.immatriculation, date: assignment.start_date, active: assignment.status === "ACTIVE" }))} route="motorcycle" /></TabsContent>
      <TabsContent value="contrats"><SimpleList title="Contrats liés" items={contracts.map((contract) => ({ id: contract.id, title: contract.reference || contract.type || "Contrat", detail: contract.partie || contract.statut || "-" }))} /></TabsContent>
      <TabsContent value="documents"><EntityDocumentsTab entityId={driverId} relation="driver" /></TabsContent>
      <TabsContent value="finances"><SimpleList title="Opérations financières" items={finance.map((operation) => ({ id: operation.id, title: `${operation.type} · ${formatAmount(Number(operation.amount))}`, detail: operation.description || operation.operation_date }))} /></TabsContent>
      <TabsContent value="salaires"><SimpleList title="Salaires versés" items={salaries.map((salary) => ({ id: salary.id, title: formatAmount(Number(salary.amount)), detail: `${salary.period_start} · ${salary.status}` }))} /></TabsContent>
      <TabsContent value="alertes"><EntityAlertsSection entityId={driverId} relation="driver" /></TabsContent>
      <TabsContent value="historique"><Card><CardHeader><CardTitle><History className="mr-2 inline h-5 w-5" />Historique</CardTitle></CardHeader><CardContent>Créé le {new Intl.DateTimeFormat("fr-FR").format(new Date(driver.created_at))}. Les changements d'affectation sont tracés dans leur historique ci-dessus.</CardContent></Card></TabsContent>
      <TabsContent value="statistiques"><div className="grid gap-4 md:grid-cols-3"><Statistic label="Véhicules affectés" value={assignments.vehicles.length} /><Statistic label="Motos affectées" value={assignments.motorcycles.length} /><Statistic label="Montant financier" value={formatAmount(financeTotal)} /></div></TabsContent>
    </Tabs>
  </div>;
}

function Info({ label, value }: { label: string; value: string | null | undefined }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{value || "-"}</p></div>; }
function Statistic({ label, value }: { label: string; value: string | number }) { return <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></CardContent></Card>; }
function SimpleList({ title, items }: { title: string; items: Array<{ id: string; title: string; detail: string; href?: string | null }> }) { return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="space-y-2">{items.length === 0 ? <p className="text-sm text-muted-foreground">Aucune donnée liée.</p> : items.map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg border p-3"><div><p className="font-medium">{item.title}</p><p className="text-sm text-muted-foreground">{item.detail}</p></div>{item.href ? <Button asChild size="sm" variant="outline"><a href={item.href} target="_blank" rel="noreferrer">Ouvrir</a></Button> : null}</div>)}</CardContent></Card>; }
function AssetList({ title, assets, route }: { title: string; assets: Array<{ id: string | undefined; label: string | undefined; date: string | null; active: boolean }>; route: "vehicle" | "motorcycle" }) { return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="space-y-2">{assets.length === 0 ? <p className="text-sm text-muted-foreground">Aucune affectation.</p> : assets.map((asset, index) => <div key={`${asset.id}-${index}`} className="flex justify-between rounded-lg border p-3"><div><p className="font-medium">{asset.label || "Actif supprimé"}</p><p className="text-sm text-muted-foreground">{asset.active ? "Affectation active" : "Affectation terminée"} · {asset.date || "date inconnue"}</p></div>{asset.id && route === "vehicle" ? <Button asChild size="sm" variant="outline"><Link to="/vehicles/$vehicleId" params={{ vehicleId: asset.id }}>Ouvrir</Link></Button> : null}{asset.id && route === "motorcycle" ? <Button asChild size="sm" variant="outline"><Link to="/motorcycles/$motorcycleId" params={{ motorcycleId: asset.id }}>Ouvrir</Link></Button> : null}</div>)}</CardContent></Card>; }
function AssignmentHistory({ vehicles, motorcycles }: { vehicles: Awaited<ReturnType<typeof getDriverAssignments>>["vehicles"]; motorcycles: Awaited<ReturnType<typeof getDriverAssignments>>["motorcycles"] }) { return <Card><CardHeader><CardTitle><Car className="mr-2 inline h-5 w-5" />Historique des affectations</CardTitle></CardHeader><CardContent className="space-y-2">{vehicles.length + motorcycles.length === 0 ? <p className="text-sm text-muted-foreground">Aucune affectation.</p> : <><p className="font-medium">Véhicules : {vehicles.length}</p><p className="font-medium">Motos : {motorcycles.length}</p></>}</CardContent></Card>; }
