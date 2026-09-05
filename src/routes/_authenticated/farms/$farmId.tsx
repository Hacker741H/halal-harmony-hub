import { useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Calendar,
  Coins,
  MapPin,
  Phone,
  Plus,
  Ruler,
  Sprout,
  TrendingDown,
  TrendingUp,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { DocumentUpload } from "@/components/documents/document-upload";
import { EntityDocumentsTab } from "@/components/documents/entity-documents-tab";
import { EntityAlertsSection } from "@/components/notifications/entity-alerts-section";
import { getDocumentsForRelation } from "@/lib/documents.functions";
import { formatNumber, formatXOF } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";

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

import { HarvestForm } from "@/components/harvest/harvest-form";
import { HarvestTable } from "@/components/harvest/harvest-table";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseTable } from "@/components/expenses/expense-table";

import {
  FARM_STATUS_LABELS,
  getFarm,
} from "@/lib/farms.functions";

import {
  cancelHarvestPlan,
  closeHarvest,
  deleteHarvest,
  getHarvestsByFarm,
  startHarvest,
  type Harvest,
} from "@/lib/harvests.functions";

import {
  deleteExpense,
  getExpensesByFarm,
  type Expense,
} from "@/lib/expenses.functions";

export const Route = createFileRoute(
  "/_authenticated/farms/$farmId",
)({
  component: FarmDetailsPage,
});

function farmStatusVariant(statut: string): "success" | "secondary" | "outline" {
  if (statut === "actif" || statut === "en_service") return "success";
  if (statut === "archive") return "outline";
  return "secondary";
}

function FarmDetailsPage() {
  const { farmId } = Route.useParams();

  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();

  const [openHarvest, setOpenHarvest] = useState(false);
  const [actingHarvestId, setActingHarvestId] = useState<string | undefined>();

  const [openExpense, setOpenExpense] = useState(false);
  const [editingExpense, setEditingExpense] =
    useState<Expense | null>(null);

  const {
    data: farm,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["farm", farmId],
    queryFn: () =>
      getFarm({
        data: farmId,
      }),
  });

  const {
    data: harvests = [],
    isPending: harvestsLoading,
  } = useQuery({
    queryKey: ["harvests", farmId],
    queryFn: () =>
      getHarvestsByFarm({
        data: farmId,
      }),
  });

  const {
    data: expenses = [],
    isPending: expensesLoading,
    isError: expensesError,
  } = useQuery({
    queryKey: ["expenses", farmId],
    queryFn: () =>
      getExpensesByFarm({
        data: farmId,
      }),
  });
  const { data: documents = [] } = useQuery({
    queryKey: ["farm-documents", farmId],
    queryFn: () => getDocumentsForRelation({ data: { entity_id: farmId, relation: "farm" } }),
  });

  async function refreshHarvests() {
    setOpenHarvest(false);

    await queryClient.invalidateQueries({
      queryKey: ["harvests", farmId],
    });
  }

  async function runHarvestAction(harvestId: string, action: () => Promise<unknown>, successMessage: string) {
    try {
      setActingHarvestId(harvestId);
      await action();
      await queryClient.invalidateQueries({ queryKey: ["harvests", farmId] });
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action impossible.");
    } finally {
      setActingHarvestId(undefined);
    }
  }

  function startHarvestAction(harvest: Harvest) {
    void runHarvestAction(harvest.id, () => startHarvest({ data: { id: harvest.id } }), "Récolte démarrée.");
  }

  function closeHarvestAction(harvest: Harvest) {
    void runHarvestAction(harvest.id, () => closeHarvest({ data: { id: harvest.id } }), "Récolte clôturée.");
  }

  function cancelHarvestAction(harvest: Harvest) {
    confirm({
      title: "Annuler la récolte",
      description: "Annuler cette récolte planifiée ?",
      variant: "destructive",
      onConfirm: () =>
        runHarvestAction(harvest.id, () => cancelHarvestPlan({ data: { id: harvest.id } }), "Récolte annulée."),
    });
  }

  async function refreshExpenses() {
    setOpenExpense(false);
    setEditingExpense(null);

    await queryClient.invalidateQueries({
      queryKey: ["expenses", farmId],
    });
  }

  function removeHarvest(
    harvest: Harvest,
  ) {
    confirm({
      title: "Supprimer la récolte",
      description: "Supprimer cette récolte ?",
      variant: "destructive",
      onConfirm: async () => {
        await deleteHarvest({
          data: {
            id: harvest.id,
          },
        });

        await refreshHarvests();
      },
    });
  }

  function removeExpense(
    expense: Expense,
  ) {
    confirm({
      title: "Supprimer la dépense",
      description: "Supprimer cette dépense ?",
      variant: "destructive",
      onConfirm: async () => {
        await deleteExpense({
          data: {
            id: expense.id,
          },
        });

        await refreshExpenses();
      },
    });
  }

  if (isPending) {
    return <div>Chargement...</div>;
  }

  if (isError) {
    return (
      <div className="space-y-4 p-6">
        <Button asChild variant="outline">
          <Link to="/farms">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour aux exploitations
          </Link>
        </Button>
        <div className="space-y-3 text-center">
          <p className="font-medium text-destructive">Impossible de charger cette exploitation.</p>
          <p className="text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>Réessayer</Button>
        </div>
      </div>
    );
  }

  if (!farm) {
    return (
      <div className="space-y-4 p-6">
        <Button asChild variant="outline">
          <Link to="/farms">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour aux exploitations
          </Link>
        </Button>
        <p className="text-muted-foreground">Exploitation introuvable.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">      <Dialog open={openHarvest} onOpenChange={setOpenHarvest}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nouvelle récolte</DialogTitle>
          </DialogHeader>

          <HarvestForm farmId={farmId} onSuccess={refreshHarvests} />
        </DialogContent>
      </Dialog>

      <Dialog
        open={openExpense}
        onOpenChange={(open) => {
          setOpenExpense(open);

          if (!open) {
            setEditingExpense(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingExpense
                ? "Modifier la dépense"
                : "Nouvelle dépense"}
            </DialogTitle>
          </DialogHeader>

          <ExpenseForm
            farmId={farmId}
            expense={editingExpense}
            onSuccess={refreshExpenses}
          />
        </DialogContent>
      </Dialog>

      <Button asChild variant="ghost" className="-ml-2 px-2">
        <Link to="/farms">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Exploitations
        </Link>
      </Button>

      <OperationalHero
        variant="deep"
        icon={Sprout}
        eyebrow="Exploitation"
        title={`${farm.code} — ${farm.nom}`}
        description="Tableau de bord de l'exploitation"
        primaryStat={{ label: "Récoltes", value: harvests.length }}
        secondaryStats={[{ label: "Dépenses liées", value: expenses.length }]}
        actions={
          <>
            <Badge variant={farmStatusVariant(farm.statut)} className="text-sm">
              {FARM_STATUS_LABELS[farm.statut] ?? farm.statut}
            </Badge>
            <Button onClick={() => setOpenHarvest(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nouvelle récolte
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        <MetricCard
          icon={Sprout}
          label="Culture"
          value={farm.type_culture || "-"}
          description="Type de culture suivi"
          tone="success"
        />
        <MetricCard
          icon={Ruler}
          label="Superficie"
          value={`${formatNumber(farm.superficie ?? 0)} ha`}
          description="Surface déclarée"
          tone="info"
        />
        <MetricCard
          icon={Coins}
          label="Prix / kg"
          value={formatXOF(farm.prix_kg ?? 0)}
          description="Tarif de référence"
        />
      </div>

      <Card>

        <CardHeader>
          <CardTitle>Informations générales</CardTitle>
        </CardHeader>

        <CardContent className="grid gap-4 md:grid-cols-2">

          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            {farm.localisation || "-"}
          </div>

          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            {farm.village || "-"}
          </div>

          <div className="flex items-center gap-2">
            <User className="h-4 w-4" />
            {farm.proprietaire || "-"}
          </div>

          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4" />
            {farm.telephone || "-"}
          </div>

          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {farm.date_debut_contrat || "-"}
          </div>

          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {farm.date_fin_contrat || "-"}
          </div>

        </CardContent>

      </Card>

      <Tabs
        defaultValue="infos"
        className="space-y-6"
      >

        <TabsList>
          <TabsTrigger value="infos">
            Informations
          </TabsTrigger>

          <TabsTrigger value="harvests">
            Récoltes
          </TabsTrigger>

          <TabsTrigger value="expenses">
            Dépenses
          </TabsTrigger>

          <TabsTrigger value="documents">
            Documents
          </TabsTrigger>

          <TabsTrigger value="alertes">
            Alertes
          </TabsTrigger>

          <TabsTrigger value="photos">
            Photos
          </TabsTrigger>

          <TabsTrigger value="map">
            Carte GPS
          </TabsTrigger>

          <TabsTrigger value="stats">
            Statistiques
          </TabsTrigger>
        </TabsList>        <TabsContent value="infos">

          <Card>

            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>

            <CardContent>
              {farm.description || "Aucune description."}
            </CardContent>

          </Card>

        </TabsContent>

        <TabsContent value="harvests">

          <div className="mb-4 flex justify-end">

            <Button onClick={() => setOpenHarvest(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nouvelle récolte
            </Button>

          </div>

          <HarvestTable
            harvests={harvests}
            loading={harvestsLoading}
            onStart={startHarvestAction}
            onClose={closeHarvestAction}
            onCancel={cancelHarvestAction}
            onDelete={removeHarvest}
            actingId={actingHarvestId}
          />

        </TabsContent>

        <TabsContent value="expenses">

          <div className="space-y-6">

            <div className="flex flex-wrap items-center justify-between gap-4">

              <MetricCard
                icon={ArrowDownRight}
                label="Total des dépenses"
                value={formatXOF(
                  expenses.reduce(
                    (total: number, expense: Expense) =>
                      total + Number(expense.amount),
                    0,
                  ),
                )}
                description={`${expenses.length} dépense${expenses.length > 1 ? "s" : ""} enregistrée${expenses.length > 1 ? "s" : ""}`}
                tone="danger"
                className="w-72"
              />

              <Button
                onClick={() => {
                  setEditingExpense(null);
                  setOpenExpense(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Nouvelle dépense
              </Button>

            </div>

            <ExpenseTable
              expenses={expenses}
              loading={expensesLoading}
              error={expensesError}
              onEdit={(expense) => {
                setEditingExpense(expense);
                setOpenExpense(true);
              }}
              onDelete={removeExpense}
            />

          </div>

        </TabsContent>        <TabsContent value="documents">
  <EntityDocumentsTab entityId={farmId} relation="farm" />

  <div className="space-y-6">

    <Card>

      <CardHeader>
        <CardTitle>
          Ajouter un document
        </CardTitle>
      </CardHeader>

      <CardContent>

        <DocumentUpload
          entityId={farmId}
          relation="farm"
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ["farm-documents", farmId] });
            toast.success("Document ajouté.");
          }}
        />

      </CardContent>

    </Card>

    <Card>

      <CardHeader>
        <CardTitle>
          Documents
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-2">
        {documents.length === 0 ? <p className="text-muted-foreground">Aucun document lié à cette exploitation.</p> : documents.map((document) => (
          <div key={document.id} className="flex items-center justify-between rounded-lg border p-3"><div><p className="font-medium">{document.nom}</p><p className="text-sm text-muted-foreground">{document.type || "Document"}</p></div>{document.url ? <Button asChild size="sm" variant="outline"><a href={document.url} target="_blank" rel="noreferrer">Ouvrir</a></Button> : null}</div>
        ))}

        <p className="text-muted-foreground">
          Les documents de cette exploitation apparaîtront ici.
        </p>

      </CardContent>

    </Card>

  </div>

</TabsContent>

        <TabsContent value="alertes">
          <EntityAlertsSection
            documentIds={documents.map((document) => document.id)}
            emptyMessage="Aucune alerte liée aux documents de cette exploitation. Les récoltes n'ont pas d'échéance métier configurée."
          />
        </TabsContent>

        <TabsContent value="photos">

          <Card>

            <CardHeader>
              <CardTitle>Photos</CardTitle>
            </CardHeader>

            <CardContent>
              <div className="text-center py-12 text-muted-foreground">
                Aucune photo enregistrée.
              </div>
            </CardContent>

          </Card>

        </TabsContent>

        <TabsContent value="map">

          <Card>

            <CardHeader>
              <CardTitle>Carte GPS</CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">

              <div>
                <strong>Latitude :</strong>{" "}
                {farm.latitude ?? "-"}
              </div>

              <div>
                <strong>Longitude :</strong>{" "}
                {farm.longitude ?? "-"}
              </div>

              {farm.latitude &&
                farm.longitude && (
                  <Button
                    asChild
                    variant="outline"
                  >
                    <a
                      href={`https://www.google.com/maps?q=${farm.latitude},${farm.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ouvrir dans Google Maps
                    </a>
                  </Button>
                )}

            </CardContent>

          </Card>

        </TabsContent>

        <TabsContent value="stats">
          {(() => {
            // montant_total est une colonne generee (quantite_kg * prix_kg),
            // et quantite_kg/prix_kg ne sont plus ecrits que par l'ancien
            // circuit direct (sellHarvest) -- une recolte vendue via GFC
            // (createCommercialSale) ou pas encore vendue a montant_total
            // NULL pour toujours. Number(null) valant 0, les compter
            // directement sous-estimait silencieusement les recettes ; on
            // les exclut du total et on le dit, plutot que de les compter a
            // 0 FCFA comme si de rien n'etait.
            const soldDirect = harvests.filter((harvest: Harvest) => harvest.montant_total !== null);
            const unaccountedCount = harvests.length - soldDirect.length;
            const revenueTotal = soldDirect.reduce(
              (total: number, harvest: Harvest) => total + Number(harvest.montant_total),
              0,
            );
            const expenseTotal = expenses.reduce((total: number, expense: Expense) => total + Number(expense.amount), 0);
            const profit = revenueTotal - expenseTotal;
            return (
              <div className="grid gap-4 md:grid-cols-3">
                <MetricCard
                  icon={ArrowUpRight}
                  label="Recettes"
                  value={formatXOF(revenueTotal)}
                  description={
                    unaccountedCount > 0
                      ? `Circuit direct seulement -- ${unaccountedCount} récolte(s) hors total (vendue via GFC ou pas encore vendue)`
                      : "Valeur des récoltes vendues via le circuit direct"
                  }
                  tone="success"
                />
                <MetricCard icon={ArrowDownRight} label="Dépenses" value={formatXOF(expenseTotal)} description="Total des dépenses liées" tone="danger" />
                <MetricCard icon={profit >= 0 ? TrendingUp : TrendingDown} label="Bénéfice" value={formatXOF(profit)} description="Recettes moins dépenses" tone={profit >= 0 ? "success" : "warning"} />
              </div>
            );
          })()}
        </TabsContent>
      </Tabs>

      {dialog}
    </div>
  );
}
