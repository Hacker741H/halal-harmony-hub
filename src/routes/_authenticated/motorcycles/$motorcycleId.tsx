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
  Pencil,
  Shield,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DriverAssignmentPanel } from "@/components/assignments/driver-assignment-panel";
import { EntityDocumentsTab } from "@/components/documents/entity-documents-tab";
import { EntityAlertsSection } from "@/components/notifications/entity-alerts-section";
import { MotorcycleForm } from "@/components/motorcycles/motorcycle-form";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { useConfirm } from "@/hooks/use-confirm";

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
  MOTORCYCLE_STATUS_LABELS,
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
import { formatDate, formatNumber, formatXOF } from "@/lib/format";

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

  const [editOpen, setEditOpen] = useState(false);

  const {
    data: motorcycle,
    isPending,
    isError,
    refetch,
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
    isPending: maintenancesLoading,
    isError: maintenancesError,
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

  const { confirm, dialog } = useConfirm();

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

  function removeMaintenance(maintenance: MotorcycleMaintenance) {
    confirm({
      title: "Annuler cet entretien",
      description: "Annuler cet entretien et sa dépense liée ?",
      variant: "destructive",
      confirmLabel: "Annuler l'entretien",
      onConfirm: async () => { await deleteMutation.mutateAsync({ data: { id: maintenance.id } }); },
    });
  }

  if (isPending) {
    return <div>Chargement...</div>;
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <Button asChild variant="outline">
          <Link to="/motorcycles">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour aux motos
          </Link>
        </Button>
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <p className="font-medium text-destructive">Impossible de charger cette moto.</p>
            <p className="text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>Réessayer</Button>
          </CardContent>
        </Card>
      </div>
    );
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
            Retour aux motos
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

  const expenseTotal = financeOperations
    .filter((operation) => operation.type === "EXPENSE")
    .reduce((total, operation) => total + Number(operation.amount), 0);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" className="-ml-2 px-2">
        <Link to="/motorcycles">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Retour aux motos
        </Link>
      </Button>

      <OperationalHero
        variant="deep"
        icon={Gauge}
        eyebrow="Moto"
        title={`${motorcycle.marque} ${motorcycle.modele}`}
        description={motorcycle.immatriculation}
        primaryStat={{ label: "Kilométrage", value: `${formatNumber(motorcycle.kilometrage ?? 0)} km` }}
        secondaryStats={[{ label: "Entretiens", value: maintenances.length, tone: maintenances.length > 0 ? "warning" : "neutral" }]}
        actions={
          <>
            <Badge variant={motorcycle.statut === "en_reparation" ? "warning" : "success"}>
              {MOTORCYCLE_STATUS_LABELS[motorcycle.statut] ?? motorcycle.statut}
            </Badge>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Modifier
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <MetricCard
          icon={Gauge}
          label="Kilométrage"
          value={`${formatNumber(motorcycle.kilometrage ?? 0)} km`}
          description="Compteur relevé"
          tone="info"
        />
        <MetricCard
          icon={Coins}
          label="Prix d'achat"
          value={formatXOF(motorcycle.prix_achat ?? 0)}
          description="Valeur d'acquisition"
        />
        <MetricCard
          icon={Shield}
          label="Assurance"
          value={motorcycle.assurance_expiration ?? "-"}
          description="Échéance"
        />
        <MetricCard
          icon={Wrench}
          label="Révision"
          value={motorcycle.prochaine_revision ?? "-"}
          description="Prochaine échéance"
        />
      </div>

      <Tabs defaultValue="infos" className="space-y-6">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="infos">Informations</TabsTrigger>
          <TabsTrigger value="maintenance">Entretiens</TabsTrigger>
          <TabsTrigger value="expenses">Dépenses</TabsTrigger>
          <TabsTrigger value="assignments">Affectations</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="alertes">Alertes</TabsTrigger>
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
                {formatNumber(motorcycle.kilometrage ?? 0)} km
              </div>

              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4" />
                <strong>Prix d'achat :</strong>
                {formatXOF(motorcycle.prix_achat ?? 0)}
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
            loading={maintenancesLoading}
            error={maintenancesError}
            onEdit={(maintenance) => {
              setSelectedMaintenance(maintenance);
              setDialogOpen(true);
            }}
            onDelete={removeMaintenance}
          />
        </TabsContent>

        <TabsContent value="expenses">

          <Card>
            <CardHeader><CardTitle>Opérations financières liées</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {financeOperations.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">Aucune opération financière liée.</p>
              ) : financeOperations.map((operation) => (
                <div key={operation.id} className="grid gap-2 rounded-lg border p-3 md:grid-cols-4">
                  <span>{formatDate(operation.operation_date)}</span>
                  <span>{operation.category || operation.type}</span>
                  <span>{operation.wallet_id}</span>
                  <span className="font-medium">{formatXOF(operation.amount)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              icon={Coins}
              label="Total des dépenses"
              value={formatXOF(expenseTotal)}
              description="Somme des opérations de type dépense"
              tone="danger"
            />
          </div>

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
      </Tabs>

      {dialog}

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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Modifier la moto</DialogTitle></DialogHeader>
          <MotorcycleForm
            motorcycle={motorcycle}
            onSuccess={() => {
              setEditOpen(false);
              void queryClient.invalidateQueries({ queryKey: ["motorcycle", motorcycleId] });
              void queryClient.invalidateQueries({ queryKey: ["motorcycles"] });
            }}
          />
        </DialogContent>
      </Dialog>

    </div>
  );
}
