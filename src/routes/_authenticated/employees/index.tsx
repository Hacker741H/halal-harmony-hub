import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UserCheck, UserMinus, Users, Wallet } from "lucide-react";

import { EmployeeForm } from "@/components/employees/employee-form";
import { EmployeeTable } from "@/components/employees/employee-table";
import { SalaryPaymentForm } from "@/components/employees/salary-payment-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getEmployees, type Employee } from "@/lib/employees.functions";

export const Route = createFileRoute("/_authenticated/employees/")({
  component: EmployeesPage,
});

function EmployeesPage() {
  const queryClient = useQueryClient();
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [salaryDialogOpen, setSalaryDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const { data: employees = [], isPending } = useQuery({ queryKey: ["employees"], queryFn: () => getEmployees() });
  const activeEmployees = employees.filter((employee) => employee.statut === "actif").length;
  const inactiveEmployees = employees.filter((employee) => employee.statut === "inactif").length;
  const totalPayroll = employees.reduce((total, employee) => total + Number(employee.salaire_base ?? 0), 0);

  async function refreshEmployees() {
    await queryClient.invalidateQueries({ queryKey: ["employees"] });
    setSelectedEmployee(null);
    setEmployeeDialogOpen(false);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div><h1 className="flex items-center gap-3 text-3xl font-bold"><Users className="h-7 w-7" />Employés</h1><p className="text-muted-foreground">De la dalle à la direction, même ambition, autre dimension.</p></div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={salaryDialogOpen} onOpenChange={setSalaryDialogOpen}><DialogTrigger asChild><Button variant="outline"><Wallet className="mr-2 h-4 w-4" />Payer un salaire</Button></DialogTrigger><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Paiement de salaire</DialogTitle></DialogHeader><SalaryPaymentForm onSuccess={async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["salary-payments"] }), queryClient.invalidateQueries({ queryKey: ["finance-operations"] }), queryClient.invalidateQueries({ queryKey: ["wallets"] })]); setSalaryDialogOpen(false); }} /></DialogContent></Dialog>
          <Dialog open={employeeDialogOpen} onOpenChange={(open) => { setEmployeeDialogOpen(open); if (!open) setSelectedEmployee(null); }}><DialogTrigger asChild><Button onClick={() => setSelectedEmployee(null)}><Plus className="mr-2 h-4 w-4" />Nouvel employé</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{selectedEmployee ? "Modifier un employé" : "Ajouter un employé"}</DialogTitle></DialogHeader><EmployeeForm employee={selectedEmployee} onSuccess={refreshEmployees} /></DialogContent></Dialog>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Employés" value={employees.length} detail="Nombre total" icon={Users} />
        <StatCard title="Actifs" value={activeEmployees} detail="En activité" icon={UserCheck} iconClass="text-green-600" />
        <StatCard title="Inactifs" value={inactiveEmployees} detail="Hors service" icon={UserMinus} iconClass="text-orange-500" />
        <StatCard title="Masse salariale" value={`${totalPayroll.toLocaleString("fr-FR")} FCFA`} detail="Salaires cumulés" icon={Wallet} iconClass="text-primary" compact />
      </div>
      <Card><CardHeader><CardTitle>Liste des employés</CardTitle></CardHeader><CardContent><EmployeeTable employees={employees} loading={isPending} onEdit={(employee) => { setSelectedEmployee(employee); setEmployeeDialogOpen(true); }} /></CardContent></Card>
    </div>
  );
}

function StatCard({ title, value, detail, icon: Icon, iconClass = "text-muted-foreground", compact = false }: { title: string; value: string | number; detail: string; icon: typeof Users; iconClass?: string; compact?: boolean }) {
  return <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm">{title}</CardTitle><Icon className={`h-5 w-5 ${iconClass}`} /></CardHeader><CardContent><div className={compact ? "text-2xl font-bold" : "text-3xl font-bold"}>{value}</div><p className="text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}
