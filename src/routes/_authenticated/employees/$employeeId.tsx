import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Banknote, FileText, Pencil, UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MetricCard } from "@/components/ui/metric-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentUpload } from "@/components/documents/document-upload";
import { EntityDocumentsTab } from "@/components/documents/entity-documents-tab";
import { EmployeeForm } from "@/components/employees/employee-form";
import { EntityAlertsSection } from "@/components/notifications/entity-alerts-section";
import { getContractsForRelation } from "@/lib/contracts.functions";
import { getDocumentsForRelation } from "@/lib/documents.functions";
import { formatDate, formatXOF } from "@/lib/format";
import {
  getEmployee,
  getEmployeeDriver,
  getEmployeeFinanceOperations,
} from "@/lib/employees.functions";
import { getSalaryPaymentsByEmployee } from "@/lib/salary-payments.functions";

export const Route = createFileRoute("/_authenticated/employees/$employeeId")({
  component: EmployeeDetailsPage,
});

function EmployeeDetailsPage() {
  const { employeeId } = Route.useParams();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const employeeQuery = useQuery({
    queryKey: ["employee", employeeId],
    queryFn: () => getEmployee({ data: employeeId }),
  });
  const driverQuery = useQuery({
    queryKey: ["employee-driver", employeeId],
    queryFn: () => getEmployeeDriver({ data: employeeId }),
  });
  const contractsQuery = useQuery({
    queryKey: ["employee-contracts", employeeId],
    queryFn: () =>
      getContractsForRelation({ data: { entity_id: employeeId, relation: "employee" } }),
  });
  const documentsQuery = useQuery({
    queryKey: ["employee-documents", employeeId],
    queryFn: () =>
      getDocumentsForRelation({ data: { entity_id: employeeId, relation: "employee" } }),
  });
  const salariesQuery = useQuery({
    queryKey: ["employee-salaries", employeeId],
    queryFn: () => getSalaryPaymentsByEmployee({ data: employeeId }),
  });
  const financeQuery = useQuery({
    queryKey: ["employee-finance", employeeId],
    queryFn: () => getEmployeeFinanceOperations({ data: employeeId }),
  });

  if (employeeQuery.isPending)
    return <p className="text-muted-foreground">Chargement de l'employé…</p>;
  const employee = employeeQuery.data;
  if (!employee)
    return (
      <Card>
        <CardContent className="p-6">Employé introuvable ou inaccessible.</CardContent>
      </Card>
    );
  const driver = driverQuery.data;
  const contracts = contractsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const salaries = salariesQuery.data ?? [];
  const finance = financeQuery.data ?? [];
  const paidTotal = salaries.reduce((total, salary) => total + Number(salary.amount), 0);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost">
        <Link to="/employees">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Retour aux employés
        </Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">
            {[employee.nom, employee.prenom].filter(Boolean).join(" ")}
          </h1>
          <p className="text-muted-foreground">Fiche employé à 360°</p>
        </div>
        <Button variant="outline" onClick={() => setEditOpen(true)}>
          <Pencil className="mr-2 h-4 w-4" />
          Modifier
        </Button>
      </div>
      <Tabs defaultValue="informations" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="informations">Informations</TabsTrigger>
          <TabsTrigger value="role">Rôle métier</TabsTrigger>
          <TabsTrigger value="chauffeur">Chauffeur</TabsTrigger>
          <TabsTrigger value="contrats">Contrats</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="salaires">Salaires</TabsTrigger>
          <TabsTrigger value="finances">Finances</TabsTrigger>
          <TabsTrigger value="alertes">Alertes</TabsTrigger>
          <TabsTrigger value="historique">Historique</TabsTrigger>
          <TabsTrigger value="statistiques">Statistiques</TabsTrigger>
        </TabsList>
        <TabsContent value="informations">
          <Card>
            <CardHeader>
              <CardTitle>Informations</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <Info label="Matricule" value={employee.matricule} />
              <Info label="Téléphone" value={employee.telephone} />
              <Info label="E-mail" value={employee.email} />
              <Info label="Poste" value={employee.poste} />
              <Info label="Date d'embauche" value={formatDate(employee.date_embauche)} />
              <Info label="Statut" value={employee.statut} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="role">
          <Card>
            <CardHeader>
              <CardTitle>Rôle métier</CardTitle>
            </CardHeader>
            <CardContent>{employee.poste || "Aucun rôle métier renseigné."}</CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="chauffeur">
          <Card>
            <CardHeader>
              <CardTitle>Profil chauffeur</CardTitle>
            </CardHeader>
            <CardContent>
              {driver ? (
                <div className="space-y-3">
                  <p>Permis : {driver.numero_permis || "-"}</p>
                  <Button asChild>
                    <Link to="/drivers/$driverId" params={{ driverId: driver.id }}>
                      <UserCheck className="mr-2 h-4 w-4" />
                      Ouvrir la fiche chauffeur
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground">Cet employé n'a pas de profil chauffeur.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="contrats">
          <Card>
            <CardHeader>
              <CardTitle>Contrats liés</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {contracts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun contrat lié.</p>
              ) : (
                contracts.map((contract) => (
                  <Link
                    key={contract.id}
                    to="/contracts/$contractId"
                    params={{ contractId: contract.id }}
                    className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"
                  >
                    <p className="font-medium">
                      {contract.reference || contract.type || "Contrat"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {contract.partie || contract.statut || "-"}
                    </p>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="documents">
          <EntityDocumentsTab entityId={employeeId} relation="employee" />
          <div className="space-y-4">
            <DocumentUpload
              entityId={employeeId}
              relation="employee"
              onSuccess={() => {
                void documentsQuery.refetch();
              }}
            />
            <List
              title="Documents liés"
              rows={documents.map((document) => [document.nom, document.type || "Document"])}
            />
          </div>
        </TabsContent>
        <TabsContent value="salaires">
          <List
            title="Paiements de salaire"
            rows={salaries.map((salary) => [
              formatXOF(salary.amount),
              `${salary.period_start} · ${salary.status}`,
            ])}
          />
        </TabsContent>
        <TabsContent value="finances">
          <List
            title="Opérations financières"
            rows={finance.map((operation) => [
              `${operation.type} · ${formatXOF(operation.amount)}`,
              operation.description || operation.operation_date,
            ])}
          />
        </TabsContent>
        <TabsContent value="alertes">
          <EntityAlertsSection entityId={employeeId} relation="employee" />
        </TabsContent>
        <TabsContent value="historique">
          <Card>
            <CardHeader>
              <CardTitle>Historique</CardTitle>
            </CardHeader>
            <CardContent>
              Créé le {new Intl.DateTimeFormat("fr-FR").format(new Date(employee.created_at))}.
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="statistiques">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <MetricCard icon={Banknote} label="Total salaires" value={formatXOF(paidTotal)} description="Somme versée" tone="success" />
            <MetricCard icon={UserCheck} label="Contrats" value={contracts.length} description="Contrats liés" />
            <MetricCard icon={FileText} label="Documents" value={documents.length} description="Documents liés" tone="info" />
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Modifier l'employé</DialogTitle></DialogHeader>
          <EmployeeForm
            employee={employee}
            onSuccess={() => {
              setEditOpen(false);
              void queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
              void queryClient.invalidateQueries({ queryKey: ["employees"] });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value || "-"}</p>
    </div>
  );
}
function List({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune donnée liée.</p>
        ) : (
          rows.map(([titleValue, detail], index) => (
            <div key={`${titleValue}-${index}`} className="rounded-lg border p-3">
              <p className="font-medium">{titleValue}</p>
              <p className="text-sm text-muted-foreground">{detail}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
