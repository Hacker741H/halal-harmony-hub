import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

import {
  ArrowLeft,
  Bike,
  Calendar,
  Coins,
  Gauge,
  Shield,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DriverAssignmentPanel } from "@/components/assignments/driver-assignment-panel";
import { EntityDocumentsTab } from "@/components/documents/entity-documents-tab";
import { DocumentUpload } from "@/components/documents/document-upload";
import { EntityAlertsSection } from "@/components/notifications/entity-alerts-section";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import {
  getMotorcycle,
  getMotorcycleFinanceOperations,
} from "@/lib/motorcycles.functions";

import {
  deleteMotorcycleMaintenance,
  getMotorcycleMaintenances,
  type MotorcycleMaintenance,
} from "@/lib/motorcycle-maintenances.functions";

import {
  MotorcycleMaintenanceForm,
} from "@/components/motorcycles/motorcycle-maintenance-form";

import {
  MotorcycleMaintenanceTable,
} from "@/components/motorcycles/motorcycle-maintenance-table";
import { getDocumentsForRelation } from "@/lib/documents.functions";

export const Route = createFileRoute(
  "/_authenticated/motorcycles/$motorcycleId",
)({
  component: MotorcycleDetailsPage,
});

function MotorcycleDetailsPage() {
  const { motorcycleId } = Route.useParams();

  const queryClient = useQueryClient();

  const [
    selectedMaintenance,
    setSelectedMaintenance,
  ] =
    useState<MotorcycleMaintenance | null>(
      null,
    );

  const [dialogOpen, setDialogOpen] =
    useState(false);

  const {
    data: motorcycle,
    isPending,
  } = useQuery({
    queryKey: [
      "motorcycle",
      motorcycleId,
    ],
    queryFn: () =>
      getMotorcycle({
        data: motorcycleId,
      }),
  });

  const {
    data: maintenances = [],
  } = useQuery({
    queryKey: [
      "motorcycle-maintenances",
      motorcycleId,
    ],
    queryFn: () =>
      getMotorcycleMaintenances({
        data: motorcycleId,
      }),
  });

  const { data: financeOperations = [] } = useQuery({
    queryKey: ["motorcycle-finance-operations", motorcycleId],
    queryFn: () => getMotorcycleFinanceOperations({ data: motorcycleId }),
  });
  const { data: documents = [] } = useQuery({
    queryKey: ["motorcycle-documents", motorcycleId],
    queryFn: () => getDocumentsForRelation({ data: { entity_id: motorcycleId, relation: "motorcycle" } }),
  });

  const deleteMutation = useMutation({
    mutationFn:
      deleteMotorcycleMaintenance,

    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [
          "motorcycle-maintenances",
          motorcycleId,
        ],
      });
      await queryClient.invalidateQueries({
        queryKey: ["motorcycle-finance-operations", motorcycleId],
      });
    },
  });

  if (isPending) {
    return <div>Chargement...</div>;
  }

  if (!motorcycle) {
    return (
      <div className="space-y-4">

        <Button
          asChild
          variant="outline"
        >
          <Link to="/motorcycles">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </Link>
        </Button>

        <Card>

          <CardContent className="py-12 text-center">

            Moto introuvable.

          </CardContent>

        </Card>

      </div>
    );
  }

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">

        <div>

          <Button
            asChild
            variant="outline"
          >
            <Link to="/motorcycles">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Retour aux motos
            </Link>
          </Button>

          <h1 className="mt-4 flex items-center gap-2 text-3xl font-bold">
            <Bike className="h-8 w-8" />
            {motorcycle.marque} {motorcycle.modele}
          </h1>

          <p className="text-muted-foreground">
            {motorcycle.immatriculation}
          </p>

        </div>

      </div>

      <div className="grid gap-4 md:grid-cols-5">        <Card>

          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Statut</CardTitle>
            <Bike className="h-5 w-5" />
          </CardHeader>

          <CardContent>

            <div className="text-xl font-semibold">
              {motorcycle.statut}
            </div>

          </CardContent>

        </Card>

        <Card>

          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Kilométrage</CardTitle>
            <Gauge className="h-5 w-5" />
          </CardHeader>

          <CardContent>

            <div className="text-xl font-semibold">
              {(motorcycle.kilometrage ?? 0).toLocaleString()} km
            </div>

          </CardContent>

        </Card>

        <Card>

          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Prix d'achat</CardTitle>
            <Coins className="h-5 w-5" />
          </CardHeader>

          <CardContent>

            <div className="text-xl font-semibold">
              {(motorcycle.prix_achat ?? 0).toLocaleString()} FCFA
            </div>

          </CardContent>

        </Card>

        <Card>

          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Assurance</CardTitle>
            <Shield className="h-5 w-5" />
          </CardHeader>

          <CardContent>

            <div className="text-sm font-medium">
              {motorcycle.assurance_expiration ?? "-"}
            </div>

          </CardContent>

        </Card>

        <Card>

          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Révision</CardTitle>
            <Wrench className="h-5 w-5" />
          </CardHeader>

          <CardContent>

            <div className="text-sm font-medium">
              {motorcycle.prochaine_revision ?? "-"}
            </div>

          </CardContent>

        </Card>

      </div>

      <Tabs
        defaultValue="infos"
        className="space-y-6"
      >

        <TabsList>

          <TabsTrigger value="infos">
            Informations
          </TabsTrigger>

          <TabsTrigger value="maintenance">
            Entretiens
          </TabsTrigger>

          <TabsTrigger value="expenses">
            Dépenses
          </TabsTrigger>

          <TabsTrigger value="assignments">
            Affectations
          </TabsTrigger>

          <TabsTrigger value="documents">
            Documents
          </TabsTrigger>

          <TabsTrigger value="alertes">
            Alertes
          </TabsTrigger>

          <TabsTrigger value="stats">
            Statistiques
          </TabsTrigger>

        </TabsList>

        <TabsContent value="infos">

          <Card>

            <CardHeader>
              <CardTitle>
                Informations générales
              </CardTitle>
            </CardHeader>

            <CardContent className="grid gap-4 md:grid-cols-2">

              <div className="flex items-center gap-2">
                <Bike className="h-4 w-4" />
                <strong>Immatriculation :</strong>
                {motorcycle.immatriculation}
              </div>

              <div className="flex items-center gap-2">
                <Bike className="h-4 w-4" />
                <strong>Marque :</strong>
                {motorcycle.marque || "-"}
              </div>

              <div className="flex items-center gap-2">
                <Bike className="h-4 w-4" />
                <strong>Modèle :</strong>
                {motorcycle.modele || "-"}
              </div>

              <div className="flex items-center gap-2">
                <Bike className="h-4 w-4" />
                <strong>Couleur :</strong>
                {motorcycle.couleur || "-"}
              </div>

              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <strong>Année :</strong>
                {motorcycle.annee ?? "-"}
              </div>              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4" />
                <strong>Kilométrage :</strong>
                {(motorcycle.kilometrage ?? 0).toLocaleString()} km
              </div>

              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4" />
                <strong>Prix d'achat :</strong>
                {(motorcycle.prix_achat ?? 0).toLocaleString()} FCFA
              </div>

              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <strong>Date d'achat :</strong>
                {motorcycle.date_achat || "-"}
              </div>

              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                <strong>Assurance :</strong>
                {motorcycle.assurance_expiration || "-"}
              </div>

              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                <strong>Prochaine révision :</strong>
                {motorcycle.prochaine_revision || "-"}
              </div>

            </CardContent>

          </Card>

        </TabsContent>

        <TabsContent value="maintenance">

          <div className="flex justify-end">
            <Button onClick={() => { setSelectedMaintenance(null); setDialogOpen(true); }}>
              Ajouter un entretien
            </Button>
          </div>

          <MotorcycleMaintenanceTable
            maintenances={maintenances}
            onEdit={(maintenance) => {
              setSelectedMaintenance(maintenance);
              setDialogOpen(true);
            }}
            onDelete={(maintenance) => {
              if (window.confirm("Annuler cet entretien et sa dépense liée ?")) {
                deleteMutation.mutate({ data: { id: maintenance.id } });
              }
            }}
          />

          <Card>

            <CardHeader>
              <CardTitle>
                Entretiens
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              <DocumentUpload entityId={motorcycleId} relation="motorcycle" onSuccess={() => { void queryClient.invalidateQueries({ queryKey: ["motorcycle-documents", motorcycleId] }); }} />
              {documents.length === 0 ? <p className="text-sm text-muted-foreground">Aucun document lié à cette moto.</p> : documents.map((document) => (
                <div key={document.id} className="flex items-center justify-between rounded-lg border p-3"><div><p className="font-medium">{document.nom}</p><p className="text-sm text-muted-foreground">{document.type || "Document"}</p></div>{document.url ? <Button asChild size="sm" variant="outline"><a href={document.url} target="_blank" rel="noreferrer">Ouvrir</a></Button> : null}</div>
              ))}
              <div className="py-12 text-center text-muted-foreground">
                Les entretiens de cette moto apparaîtront ici.
              </div>

            </CardContent>

          </Card>

        </TabsContent>

        <TabsContent value="expenses">

          <Card>
            <CardHeader><CardTitle>Opérations financières liées</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {financeOperations.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">Aucune opération financière liée.</p>
              ) : financeOperations.map((operation) => (
                <div key={operation.id} className="grid gap-2 rounded-lg border p-3 md:grid-cols-4">
                  <span>{operation.operation_date}</span>
                  <span>{operation.category || operation.type}</span>
                  <span>{operation.wallet_id}</span>
                  <span className="font-medium">{Number(operation.amount).toLocaleString("fr-FR")} FCFA</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>

            <CardHeader>
              <CardTitle>
                Dépenses
              </CardTitle>
            </CardHeader>

            <CardContent>

              <div className="grid gap-4 md:grid-cols-3">

                <Card>

                  <CardHeader>
                    <CardTitle>
                      Total des dépenses
                    </CardTitle>
                  </CardHeader>

                  <CardContent>

                    <div className="text-3xl font-bold text-red-600">
                      0 FCFA
                    </div>

                  </CardContent>

                </Card>

              </div>

              <div className="mt-8 py-12 text-center text-muted-foreground">
                Les dépenses de cette moto apparaîtront ici.
              </div>

            </CardContent>

          </Card>

        </TabsContent>

        <TabsContent value="assignments">
          <DriverAssignmentPanel assetType="motorcycle" assetId={motorcycleId} />
        </TabsContent>

        <TabsContent value="documents">

          <Card>

            <CardHeader>
              <CardTitle>
                Documents
              </CardTitle>
            </CardHeader>

            <CardContent>

              <EntityDocumentsTab entityId={motorcycleId} relation="motorcycle" />

            </CardContent>

          </Card>

        </TabsContent>

        <TabsContent value="alertes">
          <EntityAlertsSection entityId={motorcycleId} relation="motorcycle" />
        </TabsContent>

        <TabsContent value="stats">

          <div className="grid gap-4 md:grid-cols-4">

            <Card>

              <CardHeader>
                <CardTitle>Kilométrage</CardTitle>
              </CardHeader>              <CardContent>

                <div className="text-3xl font-bold">
                  {(motorcycle.kilometrage ?? 0).toLocaleString()}
                </div>

                <div className="text-muted-foreground">
                  kilomètres
                </div>

              </CardContent>

            </Card>

            <Card>

              <CardHeader>
                <CardTitle>Prix d'achat</CardTitle>
              </CardHeader>

              <CardContent>

                <div className="text-3xl font-bold text-green-600">
                  {(motorcycle.prix_achat ?? 0).toLocaleString()} FCFA
                </div>

              </CardContent>

            </Card>

            <Card>

              <CardHeader>
                <CardTitle>Assurance</CardTitle>
              </CardHeader>

              <CardContent>

                <div className="text-lg font-semibold">
                  {motorcycle.assurance_expiration ?? "-"}
                </div>

              </CardContent>

            </Card>

            <Card>

              <CardHeader>
                <CardTitle>Prochaine révision</CardTitle>
              </CardHeader>

              <CardContent>

                <div className="text-lg font-semibold">
                  {motorcycle.prochaine_revision ?? "-"}
                </div>

              </CardContent>

            </Card>

          </div>

        </TabsContent>

      </Tabs>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);

          if (!open) {
            setSelectedMaintenance(null);
          }
        }}
      >

        <DialogContent className="max-w-3xl">

          <DialogHeader>

            <DialogTitle>
              Modifier un entretien
            </DialogTitle>

          </DialogHeader>

          <MotorcycleMaintenanceForm
            motorcycleId={motorcycleId}
            maintenance={selectedMaintenance}
            onSuccess={async () => {
              await queryClient.invalidateQueries({
                queryKey: [
                  "motorcycle-maintenances",
                  motorcycleId,
                ],
              });
              await queryClient.invalidateQueries({
                queryKey: ["motorcycle-finance-operations", motorcycleId],
              });

              setDialogOpen(false);
              setSelectedMaintenance(null);
            }}
            onCancel={() => {
              setDialogOpen(false);
              setSelectedMaintenance(null);
            }}
          />

        </DialogContent>

      </Dialog>

    </div>
  );
}
