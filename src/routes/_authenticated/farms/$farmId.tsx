import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Calendar,
  Coins,
  MapPin,
  Phone,
  Plus,
  Ruler,
  Sprout,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { DocumentUpload } from "@/components/documents/document-upload";
import { EntityDocumentsTab } from "@/components/documents/entity-documents-tab";
import { EntityAlertsSection } from "@/components/notifications/entity-alerts-section";
import { getDocumentsForRelation } from "@/lib/documents.functions";
import { Button } from "@/components/ui/button";

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

function FarmDetailsPage() {
  const { farmId } = Route.useParams();

  const queryClient = useQueryClient();

  const [openHarvest, setOpenHarvest] = useState(false);
  const [actingHarvestId, setActingHarvestId] = useState<string | undefined>();

  const [openExpense, setOpenExpense] = useState(false);
  const [editingExpense, setEditingExpense] =
    useState<Expense | null>(null);

  const {
    data: farm,
    isPending,
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
    if (!window.confirm("Annuler cette récolte planifiée ?")) return;
    void runHarvestAction(harvest.id, () => cancelHarvestPlan({ data: { id: harvest.id } }), "Récolte annulée.");
  }

  async function refreshExpenses() {
    setOpenExpense(false);
    setEditingExpense(null);

    await queryClient.invalidateQueries({
      queryKey: ["expenses", farmId],
    });
  }

  async function removeHarvest(
    harvest: Harvest,
  ) {
    if (
      !window.confirm(
        "Supprimer cette récolte ?",
      )
    ) {
      return;
    }

    await deleteHarvest({
      data: {
        id: harvest.id,
      },
    });

    await refreshHarvests();
  }

  async function removeExpense(
    expense: Expense,
  ) {
    if (
      !window.confirm(
        "Supprimer cette dépense ?",
      )
    ) {
      return;
    }

    await deleteExpense({
      data: {
        id: expense.id,
      },
    });

    await refreshExpenses();
  }

  if (isPending) {
    return <div>Chargement...</div>;
  }

  if (!farm) {
    return <div>Exploitation introuvable.</div>;
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

      <div className="flex items-center justify-between">

        <div>
          <h1 className="text-3xl font-bold">
            {farm.code} — {farm.nom}
          </h1>

          <p className="text-muted-foreground">
            Tableau de bord de l'exploitation
          </p>
        </div>

        <Button onClick={() => setOpenHarvest(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nouvelle récolte
        </Button>

      </div>

      <div className="grid gap-4 md:grid-cols-4">

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Culture</CardTitle>
            <Sprout className="h-5 w-5" />
          </CardHeader>

          <CardContent>
            <div className="text-xl font-semibold">
              {farm.type_culture || "-"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Superficie</CardTitle>
            <Ruler className="h-5 w-5" />
          </CardHeader>

          <CardContent>
            <div className="text-xl font-semibold">
              {farm.superficie ?? 0} ha
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Prix / kg</CardTitle>
            <Coins className="h-5 w-5" />
          </CardHeader>

          <CardContent>
            <div className="text-xl font-semibold">
              {farm.prix_kg ?? 0} FCFA
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Statut</CardTitle>
            <MapPin className="h-5 w-5" />
          </CardHeader>

          <CardContent>
            <div className="text-xl font-semibold">
              {farm.statut}
            </div>
          </CardContent>
        </Card>

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

            <div className="flex justify-between items-center">

              <Card className="w-72">

                <CardHeader>
                  <CardTitle>Total des dépenses</CardTitle>
                </CardHeader>

                <CardContent>

                  <div className="text-3xl font-bold text-red-600">

                    {expenses
                      .reduce(
                        (total: number, expense: Expense) =>
                          total + Number(expense.amount),
                        0,
                      )
                      .toLocaleString()}{" "}
                    FCFA

                  </div>

                </CardContent>

              </Card>

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
            alert("Document ajouté.");
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

          <div className="grid gap-4 md:grid-cols-3">

            <Card>

              <CardHeader>
                <CardTitle>Recettes</CardTitle>
              </CardHeader>

              <CardContent>

                <div className="text-3xl font-bold text-green-600">

                  {harvests
                    .reduce(
                      (total: number, harvest: Harvest) =>
                        total +
                        Number(
                          harvest.montant_total ??
                            Number(harvest.quantite_kg) *
                              Number(harvest.prix_kg),
                        ),
                      0,
                    )
                    .toLocaleString()}{" "}
                  FCFA

                </div>

              </CardContent>

            </Card>

            <Card>

              <CardHeader>
                <CardTitle>Dépenses</CardTitle>
              </CardHeader>

              <CardContent>

                <div className="text-3xl font-bold text-red-600">

                  {expenses
                    .reduce(
                      (total: number, expense: Expense) =>
                        total +
                        Number(expense.amount),
                      0,
                    )
                    .toLocaleString()}{" "}
                  FCFA

                </div>

              </CardContent>

            </Card>

            <Card>

              <CardHeader>
                <CardTitle>Bénéfice</CardTitle>
              </CardHeader>

              <CardContent>

                <div className="text-3xl font-bold text-blue-600">

                  {(
                    harvests.reduce(
                      (total: number, harvest: Harvest) =>
                        total +
                        Number(
                          harvest.montant_total ??
                            Number(harvest.quantite_kg) *
                              Number(harvest.prix_kg),
                        ),
                      0,
                    ) -
                    expenses.reduce(
                      (total: number, expense: Expense) =>
                        total +
                        Number(expense.amount),
                      0,
                    )
                  ).toLocaleString()}{" "}
                  FCFA

                </div>

              </CardContent>

            </Card>

          </div>

        </TabsContent>

      </Tabs>

    </div>
  );
}
