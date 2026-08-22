import { useEffect, useMemo, useState } from "react";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, UserCheck, UserMinus, Users, Wallet } from "lucide-react";
import { z } from "zod";

import { EmployeeForm } from "@/components/employees/employee-form";
import { EmployeeTable } from "@/components/employees/employee-table";
import { SalaryPaymentForm } from "@/components/employees/salary-payment-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getEmployees, type Employee } from "@/lib/employees.functions";

export const Route = createFileRoute("/_authenticated/employees/")({
  validateSearch: z.object({ create: z.literal("true").optional() }),
  component: EmployeesPage,
});

function EmployeesPage() {
  const { create } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [salaryDialogOpen, setSalaryDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "actif" | "inactif">("ALL");

  const { data: employees = [], isPending, isError } = useQuery({
    queryKey: ["employees"],
    queryFn: () => getEmployees(),
  });

  const activeEmployees = employees.filter((employee) => employee.statut === "actif").length;
  const inactiveEmployees = employees.filter((employee) => employee.statut === "inactif").length;
  const totalPayroll = employees.reduce((total, employee) => total + Number(employee.salaire_base ?? 0), 0);

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees.filter((employee) => {
      const matchesSearch =
        !term ||
        [employee.nom, employee.prenom, employee.poste, employee.telephone, employee.email].some((field) =>
          field?.toLowerCase().includes(term),
        );
      const matchesStatus = statusFilter === "ALL" || employee.statut === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [employees, search, statusFilter]);

  useEffect(() => {
    if (create === "true") {
      setSelectedEmployee(null);
      setEmployeeDialogOpen(true);
    }
  }, [create]);

  const clearQuickCreate = () => {
    if (create === "true") void navigate({ search: {}, replace: true });
  };

  async function refreshEmployees() {
    await queryClient.invalidateQueries({ queryKey: ["employees"] });
    setSelectedEmployee(null);
    setEmployeeDialogOpen(false);
    clearQuickCreate();
  }

  return (
    <div className="space-y-7">
      <OperationalHero
        variant="deep"
        icon={Users}
        eyebrow="Ressources"
        title="Équipe et rémunérations"
        description="Vue d'ensemble de l'effectif, des statuts et de la masse salariale."
        primaryStat={{ label: "Effectif total", value: employees.length }}
        secondaryStats={[
          { label: "Actifs", value: activeEmployees, tone: "success" },
          { label: "Masse salariale", value: `${totalPayroll.toLocaleString("fr-FR")} FCFA`, tone: "info" },
        ]}
        actions={
          <>
            <Dialog open={salaryDialogOpen} onOpenChange={setSalaryDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Wallet className="h-4 w-4" />
                  Payer un salaire
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Paiement de salaire</DialogTitle>
                </DialogHeader>
                <SalaryPaymentForm
                  onSuccess={async () => {
                    await Promise.all([
                      queryClient.invalidateQueries({ queryKey: ["salary-payments"] }),
                      queryClient.invalidateQueries({ queryKey: ["finance-operations"] }),
                      queryClient.invalidateQueries({ queryKey: ["wallets"] }),
                    ]);
                    setSalaryDialogOpen(false);
                  }}
                />
              </DialogContent>
            </Dialog>

            <Dialog
              open={employeeDialogOpen}
              onOpenChange={(nextOpen) => {
                setEmployeeDialogOpen(nextOpen);
                if (!nextOpen) {
                  setSelectedEmployee(null);
                  clearQuickCreate();
                }
              }}
            >
              <DialogTrigger asChild>
                <Button onClick={() => setSelectedEmployee(null)}>
                  <Plus className="h-4 w-4" />
                  Nouvel employé
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{selectedEmployee ? "Modifier un employé" : "Ajouter un employé"}</DialogTitle>
                </DialogHeader>
                <EmployeeForm employee={selectedEmployee} onSuccess={refreshEmployees} />
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <Card variant="section" className="p-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher une personne, poste, contact…"
              aria-label="Rechercher un employé"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les statuts</SelectItem>
              <SelectItem value="actif">Actif</SelectItem>
              <SelectItem value="inactif">Inactif</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Employés" value={employees.length} description="Personnes enregistrées" icon={Users} />
        <MetricCard label="Actifs" value={activeEmployees} description="En activité" icon={UserCheck} tone="success" />
        <MetricCard
          label="Inactifs"
          value={inactiveEmployees}
          description="Hors activité actuellement"
          icon={UserMinus}
          tone={inactiveEmployees > 0 ? "warning" : "primary"}
        />
        <MetricCard
          label="Masse salariale"
          value={`${totalPayroll.toLocaleString("fr-FR")} FCFA`}
          description="Somme des salaires de base renseignés"
          icon={Wallet}
          tone="info"
        />
      </div>

      <Card variant="section" className="overflow-hidden">
        <CardHeader className="border-b border-border/70">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Référentiel équipe</p>
              <CardTitle className="mt-1 text-xl">Employés suivis</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              {isPending ? "Chargement des employés…" : "Recherchez une personne, ouvrez sa fiche ou mettez son dossier à jour."}
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          <EmployeeTable
            employees={filteredEmployees}
            loading={isPending}
            error={isError}
            onEdit={(employee) => {
              setSelectedEmployee(employee);
              setEmployeeDialogOpen(true);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
