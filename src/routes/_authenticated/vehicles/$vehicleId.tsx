import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Car,
  CircleDollarSign,
  FileText,
  Gauge,
  History,
  Pencil,
  Trash2,
  UserRound,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DriverAssignmentPanel } from "@/components/assignments/driver-assignment-panel";
import { DocumentUpload } from "@/components/documents/document-upload";
import { EntityDocumentsTab } from "@/components/documents/entity-documents-tab";
import { EntityAlertsSection } from "@/components/notifications/entity-alerts-section";
import VehicleForm from "@/components/vehicles/vehicle-form";
import { VehicleMaintenanceForm } from "@/components/vehicles/vehicle-maintenance-form";
import {
  deleteVehicleMaintenance,
  getVehicle,
  getVehicleDriver,
  getVehicleFinanceOperations,
  getVehicleMaintenances,
  updateVehicleStatus,
  VEHICLE_STATUSES,
  VEHICLE_STATUS_LABELS,
  type VehicleMaintenance,
  type VehicleStatus,
} from "@/lib/vehicles.functions";
import { getDocumentsForRelation } from "@/lib/documents.functions";
import { archiveDocument } from "@/lib/documents.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/vehicles/$vehicleId")({
  component: VehicleDetailsPage,
});

function formatAmount(value: number | null) {
  return `${Number(value ?? 0).toLocaleString("fr-FR")} FCFA`;
}

function formatDate(value: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(`${value.slice(0, 10)}T00:00:00`),
  );
}

function statusLabel(status: string | null) {
  return status && status in VEHICLE_STATUS_LABELS
    ? VEHICLE_STATUS_LABELS[status as VehicleStatus]
    : status || "Non renseigné";
}

function VehicleDetailsPage() {
  const { vehicleId } = Route.useParams();
  const queryClient = useQueryClient();
  const [maintenanceDialogOpen, setMaintenanceDialogOpen] = useState(false);
  const [selectedMaintenance, setSelectedMaintenance] = useState<VehicleMaintenance | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const vehicleQuery = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => getVehicle({ data: vehicleId }),
  });
  const maintenanceQuery = useQuery({
    queryKey: ["vehicle-maintenances", vehicleId],
    queryFn: () => getVehicleMaintenances({ data: vehicleId }),
  });
  const financeQuery = useQuery({
    queryKey: ["vehicle-finance-operations", vehicleId],
    queryFn: () => getVehicleFinanceOperations({ data: vehicleId }),
  });
  const documentsQuery = useQuery({
    queryKey: ["vehicle-documents", vehicleId],
    queryFn: () => getDocumentsForRelation({ data: { entity_id: vehicleId, relation: "vehicle" } }),
  });
  const driverQuery = useQuery({
    queryKey: ["vehicle-driver", vehicleQuery.data?.driver_id],
    queryFn: () => getVehicleDriver({ data: vehicleQuery.data?.driver_id ?? null }),
    enabled: vehicleQuery.isSuccess,
  });
  const statusMutation = useMutation({
    mutationFn: updateVehicleStatus,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ["vehicles"] }),
      ]);
    },
  });

  const deleteMaintenanceMutation = useMutation({
    mutationFn: deleteVehicleMaintenance,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["vehicle-maintenances", vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ["vehicle-finance-operations", vehicleId] }),
      ]);
    },
  });

  const archiveDocumentMutation = useMutation({
    mutationFn: archiveDocument,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["vehicle-documents", vehicleId],
      });
      toast.success("Document supprimé.");
    },
    onError: (error) => {
      console.error(error);
      toast.error("Impossible de supprimer ce document.");
    },
  });

  function removeDocument(documentId: string) {
    if (!window.confirm("Supprimer ce document ?")) return;
    archiveDocumentMutation.mutate({ data: { id: documentId } });
  }

  async function refreshMaintenances() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["vehicle-maintenances", vehicleId] }),
      queryClient.invalidateQueries({ queryKey: ["vehicle-finance-operations", vehicleId] }),
    ]);
    setMaintenanceDialogOpen(false);
    setSelectedMaintenance(null);
  }

  if (vehicleQuery.isPending) {
    return <div className="p-6 text-muted-foreground">Chargement du véhicule…</div>;
  }

  if (vehicleQuery.isError) {
    return (
      <div className="space-y-4 p-6">
        <Button asChild variant="outline">
          <Link to="/vehicles">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour aux véhicules
          </Link>
        </Button>
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <p className="font-medium text-destructive">Impossible de charger ce véhicule.</p>
            <p className="text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void vehicleQuery.refetch()}>Réessayer</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!vehicleQuery.data) {
    return (
      <div className="space-y-4 p-6">
        <Button asChild variant="outline">
          <Link to="/vehicles">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour aux véhicules
          </Link>
        </Button>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Véhicule introuvable ou inaccessible.
          </CardContent>
        </Card>
      </div>
    );
  }

  const vehicle = vehicleQuery.data;
  const maintenances = maintenanceQuery.data ?? [];
  const operations = financeQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const driver = driverQuery.data;
  const maintenanceTotal = maintenances.reduce(
    (total, maintenance) => total + Number(maintenance.cout ?? 0),
    0,
  );
  const expenseTotal = operations
    .filter((operation) => operation.type === "EXPENSE")
    .reduce((total, operation) => total + Number(operation.amount), 0);
  const currentStatus = VEHICLE_STATUSES.includes(vehicle.status as VehicleStatus)
    ? (vehicle.status as VehicleStatus)
    : "EN_SERVICE";

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <Button asChild variant="outline">
            <Link to="/vehicles">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Retour aux véhicules
            </Link>
          </Button>
          <h1 className="mt-4 flex items-center gap-2 text-3xl font-bold">
            <Car className="h-8 w-8" />
            {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "Véhicule"}
          </h1>
          <p className="text-muted-foreground">{vehicle.registration}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Badge>{statusLabel(vehicle.status)}</Badge>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Modifier
          </Button>
          <select
            aria-label="Modifier le statut du véhicule"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={currentStatus}
            disabled={statusMutation.isPending}
            onChange={(event) =>
              statusMutation.mutate({
                data: {
                  id: vehicle.id,
                  status: event.target.value as VehicleStatus,
                },
              })
            }
          >
            {VEHICLE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {VEHICLE_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Kilométrage</CardTitle>
            <Gauge className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(vehicle.kilometrage ?? 0).toLocaleString("fr-FR")} km
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Prix d'achat</CardTitle>
            <CircleDollarSign className="h-5 w-5 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatAmount(vehicle.purchase_price)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Entretiens</CardTitle>
            <Wrench className="h-5 w-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{maintenances.length}</div>
            <p className="text-xs text-muted-foreground">{formatAmount(maintenanceTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Dépenses liées</CardTitle>
            <CircleDollarSign className="h-5 w-5 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatAmount(expenseTotal)}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="informations" className="space-y-6">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="informations">Informations</TabsTrigger>
          <TabsTrigger value="entretiens">Entretiens</TabsTrigger>
          <TabsTrigger value="finances">Finances</TabsTrigger>
          <TabsTrigger value="affectations">Affectations</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="alertes">Alertes</TabsTrigger>
          <TabsTrigger value="historique">Historique</TabsTrigger>
          <TabsTrigger value="statistiques">Statistiques</TabsTrigger>
        </TabsList>

        <TabsContent value="informations">
          <Card>
            <CardHeader>
              <CardTitle>Informations générales</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              {vehicle.photo_url && (
                <img
                  src={vehicle.photo_url}
                  alt={`Photo du véhicule ${vehicle.registration}`}
                  className="aspect-video w-full rounded-lg border object-cover md:row-span-4"
                />
              )}
              <Info label="Immatriculation" value={vehicle.registration} />
              <Info label="Marque" value={vehicle.brand} />
              <Info label="Modèle" value={vehicle.model} />
              <Info label="Type" value={vehicle.type} />
              <Info label="Année" value={vehicle.year?.toString()} />
              <Info label="Couleur" value={vehicle.color} />
              <Info label="N° de châssis" value={vehicle.chassis_number} />
              <Info label="N° moteur" value={vehicle.engine_number} />
              <Info label="Date d'achat" value={formatDate(vehicle.purchase_date)} />
              <Info label="Fournisseur" value={vehicle.supplier} />
              <div className="md:col-span-2">
                <p className="text-sm font-medium">Description</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {vehicle.description || "Aucune description."}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="entretiens">
          <Card>
            <div className="flex justify-end px-6 pt-2">
              <Button
                size="sm"
                onClick={() => {
                  setSelectedMaintenance(null);
                  setMaintenanceDialogOpen(true);
                }}
              >
                Ajouter un entretien
              </Button>
            </div>
            <CardHeader>
              <CardTitle>Entretiens du véhicule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {maintenances.length === 0 ? (
                <EmptyState label="Aucun entretien n'est enregistré pour ce véhicule." />
              ) : (
                maintenances.map((maintenance) => (
                  <div
                    key={maintenance.id}
                    className="grid gap-2 rounded-lg border p-4 md:grid-cols-4"
                  >
                    <div className="flex gap-2 md:col-span-4">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedMaintenance(maintenance);
                          setMaintenanceDialogOpen(true);
                        }}
                      >
                        Modifier
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={deleteMaintenanceMutation.isPending}
                        onClick={() => {
                          if (window.confirm("Annuler cet entretien et sa dépense liée ?")) {
                            deleteMaintenanceMutation.mutate({ data: { id: maintenance.id } });
                          }
                        }}
                      >
                        Annuler
                      </Button>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Date</p>
                      <p>{formatDate(maintenance.date)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Type</p>
                      <p>{maintenance.type || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Prestataire</p>
                      <p>{maintenance.prestataire || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Coût</p>
                      <p>{formatAmount(maintenance.cout)}</p>
                    </div>
                    {maintenance.notes && (
                      <p className="text-sm text-muted-foreground md:col-span-4">
                        {maintenance.notes}
                      </p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Dialog open={maintenanceDialogOpen} onOpenChange={setMaintenanceDialogOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {selectedMaintenance ? "Modifier l'entretien" : "Nouvel entretien"}
                </DialogTitle>
              </DialogHeader>
              <VehicleMaintenanceForm
                vehicleId={vehicleId}
                maintenance={selectedMaintenance}
                onSuccess={refreshMaintenances}
                onCancel={() => {
                  setMaintenanceDialogOpen(false);
                  setSelectedMaintenance(null);
                }}
              />
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="finances">
          <Card>
            <CardHeader>
              <CardTitle>Opérations financières liées</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {operations.length === 0 ? (
                <EmptyState label="Aucune opération financière n'est liée à ce véhicule." />
              ) : (
                operations.map((operation) => (
                  <div
                    key={operation.id}
                    className="grid gap-2 rounded-lg border p-4 md:grid-cols-4"
                  >
                    <div>
                      <p className="text-xs text-muted-foreground">Date</p>
                      <p>{formatDate(operation.operation_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Type</p>
                      <p>{operation.type}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Catégorie</p>
                      <p>{operation.category || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Montant</p>
                      <p>{formatAmount(operation.amount)}</p>
                    </div>
                    {operation.description && (
                      <p className="text-sm text-muted-foreground md:col-span-4">
                        {operation.description}
                      </p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="affectations">
          <DriverAssignmentPanel assetType="vehicle" assetId={vehicleId} />
          <Card>
            <CardHeader>
              <CardTitle>Chauffeur affecté</CardTitle>
            </CardHeader>
            <CardContent>
              {!vehicle.driver_id ? (
                <EmptyState label="Aucun chauffeur n'est affecté à ce véhicule." />
              ) : driverQuery.isPending ? (
                <p className="text-sm text-muted-foreground">Chargement de l'affectation…</p>
              ) : driver ? (
                <div className="grid gap-4 md:grid-cols-3">
                  <Info
                    label="Chauffeur"
                    value={[driver.employees?.nom, driver.employees?.prenom]
                      .filter(Boolean)
                      .join(" ")}
                  />
                  <Info label="Téléphone" value={driver.employees?.telephone} />
                  <Info
                    label="Permis"
                    value={[driver.categorie_permis, driver.numero_permis]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  <div className="md:col-span-3">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/drivers/$driverId/activity" params={{ driverId: driver.id }}>
                        Suivre l’activité & la rémunération
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <EmptyState label="L'affectation pointe vers un chauffeur introuvable." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <EntityDocumentsTab entityId={vehicleId} relation="vehicle" />
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DocumentUpload
                entityId={vehicleId}
                relation="vehicle"
                onSuccess={() => {
                  void queryClient.invalidateQueries({
                    queryKey: ["vehicle-documents", vehicleId],
                  });
                }}
              />
              {documents.length === 0 ? (
                <EmptyState label="Aucun document n'est rattaché à ce véhicule." />
              ) : (
                documents.map((document) => (
                  <div
                    key={document.id}
                    className="flex items-center justify-between gap-4 rounded-lg border p-4"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{document.nom}</p>
                        <p className="text-sm text-muted-foreground">
                          {document.type || "Document"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {document.url && (
                        <Button asChild variant="outline" size="sm">
                          <a href={document.url} target="_blank" rel="noreferrer">
                            Ouvrir
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={archiveDocumentMutation.isPending}
                        onClick={() => removeDocument(document.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Supprimer
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alertes">
          <EntityAlertsSection entityId={vehicleId} relation="vehicle" />
        </TabsContent>

        <TabsContent value="historique">
          <Card>
            <CardHeader>
              <CardTitle>Historique</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <History className="h-5 w-5 text-muted-foreground" />
              <Info label="Créé le" value={formatDate(vehicle.created_at)} />
              <Info label="Dernière mise à jour" value={formatDate(vehicle.updated_at)} />
              <Info
                label="Dernière opération financière"
                value={operations[0] ? formatDate(operations[0].operation_date) : "Aucune"}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statistiques">
          <div className="grid gap-4 md:grid-cols-3">
            <Statistic
              icon={<Gauge className="h-5 w-5" />}
              label="Kilométrage"
              value={`${(vehicle.kilometrage ?? 0).toLocaleString("fr-FR")} km`}
            />
            <Statistic
              icon={<Wrench className="h-5 w-5" />}
              label="Coût des entretiens"
              value={formatAmount(maintenanceTotal)}
            />
            <Statistic
              icon={<CircleDollarSign className="h-5 w-5" />}
              label="Coût financier"
              value={formatAmount(expenseTotal)}
            />
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Modifier le véhicule</DialogTitle></DialogHeader>
          <VehicleForm
            vehicle={vehicle}
            onSuccess={() => {
              setEditOpen(false);
              void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
              void queryClient.invalidateQueries({ queryKey: ["vehicles"] });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-1 text-sm text-muted-foreground">{value || "-"}</p>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label}</p>;
}

function Statistic({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
