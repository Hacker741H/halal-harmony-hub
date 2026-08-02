import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  CircleDollarSign,
  Fuel,
  ReceiptText,
  Route,
  Utensils,
  WalletCards,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { SalaryPaymentForm } from "@/components/employees/salary-payment-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/use-permissions";
import { getDriver } from "@/lib/drivers.functions";
import {
  DRIVER_ACTIVITY_EXPENSE_LABELS,
  getDriverActivitySummary,
  type DriverActivityExpenseCategory,
} from "@/lib/driver-activity.functions";

type Period = { from: string; to: string };

const expenseIcons: Record<DriverActivityExpenseCategory, typeof Fuel> = {
  FUEL: Fuel,
  ROAD: Route,
  MEALS: Utensils,
  MISC: ReceiptText,
  EXCEPTIONAL_MAINTENANCE: Wrench,
};

const categoryOrder: DriverActivityExpenseCategory[] = [
  "FUEL",
  "ROAD",
  "MEALS",
  "MISC",
  "EXCEPTIONAL_MAINTENANCE",
];

export function DriverActivityRemuneration({ driverId }: { driverId: string }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [period, setPeriod] = useState<Period | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);

  useEffect(() => {
    setPeriod(defaultPeriod());
  }, []);

  const driverQuery = useQuery({
    queryKey: ["driver", driverId],
    queryFn: () => getDriver({ data: driverId }),
  });
  const summaryQuery = useQuery({
    queryKey: ["driver-activity-remuneration", driverId, period?.from, period?.to],
    queryFn: () => getDriverActivitySummary({ data: { driverId, from: period!.from, to: period!.to } }),
    enabled: period !== null && period.from <= period.to,
  });

  const driverName = useMemo(() => {
    const driver = driverQuery.data;
    return [driver?.employees?.nom, driver?.employees?.prenom].filter(Boolean).join(" ") || "Chauffeur";
  }, [driverQuery.data]);

  const summary = summaryQuery.data;
  const financial = summary?.financial ?? null;
  const salary = summary?.salary ?? null;
  const invalidPeriod = period !== null && period.from > period.to;

  return (
    <div className="mx-auto max-w-(--ds-content-max-width) space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.12] via-surface-elevated to-surface px-5 py-6 shadow-sm sm:px-7 sm:py-8">
        <div className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-primary/12 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-overline text-primary">
              <BriefcaseBusiness className="size-3.5" aria-hidden="true" />
              Activité & rémunération chauffeur
            </div>
            <h1 className="mt-3 text-display text-foreground">{driverName}</h1>
            <p className="mt-3 max-w-2xl text-body-sm leading-6 text-muted-foreground sm:text-base">
              Un bilan fiable des Courses affectées, de leurs encaissements et de leurs dépenses confirmées. Les flux financiers sont comptés à leur date réelle. Le montant de rémunération reste une décision humaine.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <DateField label="Du" value={period?.from ?? ""} onChange={(from) => setPeriod((current) => ({ ...(current ?? defaultPeriod()), from }))} />
            <DateField label="Au" value={period?.to ?? ""} onChange={(to) => setPeriod((current) => ({ ...(current ?? defaultPeriod()), to }))} />
          </div>
        </div>
      </section>

      {invalidPeriod ? (
        <StatusCard title="Période à corriger" description="La date de fin doit être postérieure ou égale à la date de début." />
      ) : summaryQuery.isError ? (
        <StatusCard
          title="Impossible de charger le bilan chauffeur"
          description={summaryQuery.error instanceof Error ? summaryQuery.error.message : "Réessayez dans quelques instants."}
          action={<Button variant="outline" onClick={() => void summaryQuery.refetch()}>Réessayer</Button>}
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicateurs d’activité chauffeur">
            <MetricCard icon={CalendarDays} label="Courses suivies" value={summary ? String(summary.activity.coursesCount) : null} detail="Affectées ou avec un flux sur la période" />
            <MetricCard icon={CircleDollarSign} label="Encaissements liés" value={financial ? formatXOF(financial.collectedAmount) : summary ? "Réservé" : null} detail={financial ? "Paiements client confirmés" : "Permission financière requise"} tone="success" />
            <MetricCard icon={ReceiptText} label="Dépenses de Courses" value={financial ? formatXOF(financial.expenseAmount) : summary ? "Réservé" : null} detail={financial ? "Seulement les dépenses confirmées" : "Permission financière requise"} tone="warning" />
            <MetricCard icon={WalletCards} label="Résultat des Courses" value={financial ? formatXOF(financial.netAmount) : summary ? "Réservé" : null} detail={financial ? "Encaissements moins dépenses" : "Permission financière requise"} tone={financial && financial.netAmount < 0 ? "danger" : "primary"} />
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(19rem,0.75fr)]">
            <Card variant="section">
              <CardHeader>
                <CardTitle>Dépenses imputées aux Courses</CardTitle>
                <CardDescription>
                  Les entretiens et frais généraux du véhicule ne sont pas imputés ici. Seules les dépenses confirmées et rattachées à une Course de ce chauffeur sont prises en compte.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {summaryQuery.isPending ? <ExpenseSkeleton /> : financial ? <ExpenseBreakdown totals={financial.expensesByCategory} /> : <FinancialRestricted />}
              </CardContent>
            </Card>

            <Card variant="information" className="border-primary/15">
              <CardHeader>
                <CardTitle>Rémunération variable</CardTitle>
                <CardDescription>
                  Aucun pourcentage n’est appliqué automatiquement. Cette vue éclaire la décision du responsable, sans transformer la rentabilité en salaire imposé.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {summaryQuery.isPending ? <Skeleton className="h-16 w-full" /> : salary ? (
                  <div className="rounded-xl border border-border/70 bg-surface px-4 py-3">
                    <p className="text-caption text-muted-foreground">Déjà versé sur la période</p>
                    <p className="mt-1 text-h3 text-foreground">{formatXOF(salary.paidAmount)}</p>
                    <p className="mt-1 text-caption">{salary.paymentCount} paiement{salary.paymentCount > 1 ? "s" : ""} confirmé{salary.paymentCount > 1 ? "s" : ""} ou en cours.</p>
                  </div>
                ) : <FinancialRestricted message="Les paiements de salaire sont réservés aux rôles autorisés." />}

                {can("salaries.pay") ? (
                  <Button className="w-full" onClick={() => setPaymentOpen(true)}>
                    <Banknote className="mr-2 size-4" aria-hidden="true" />
                    Préparer un paiement de salaire
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          </section>

          <Card variant="section">
            <CardHeader>
              <CardTitle>Courses suivies</CardTitle>
              <CardDescription>
                Une Course apparaît si elle est affectée au chauffeur ou possède un encaissement ou une dépense confirmée durant la période. Les montants sont réservés aux utilisateurs disposant du droit de lecture financière des Courses.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {summaryQuery.isPending ? <CoursesSkeleton /> : summary && summary.courses.length > 0 ? <CourseList courses={summary.courses} showFinancial={financial !== null} /> : <EmptyCourses />}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Paiement de salaire — {driverName}</DialogTitle>
            <DialogDescription>
              Le montant est décidé manuellement. Après validation, l’ERP créera la dépense de salaire et l’écriture financière associée via le flux sécurisé existant.
            </DialogDescription>
          </DialogHeader>
          <SalaryPaymentForm
            initialDriverId={driverId}
            initialPeriodStart={period?.from}
            defaultDescription={period ? `Rémunération chauffeur — activité Courses du ${period.from} au ${period.to}` : undefined}
            onSuccess={async () => {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["driver-activity-remuneration", driverId] }),
                queryClient.invalidateQueries({ queryKey: ["driver-salaries", driverId] }),
                queryClient.invalidateQueries({ queryKey: ["finance-operations"] }),
                queryClient.invalidateQueries({ queryKey: ["wallets"] }),
              ]);
              setPaymentOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-1.5 text-caption font-medium text-muted-foreground"><span>{label}</span><Input type="date" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function MetricCard({ icon: Icon, label, value, detail, tone = "primary" }: { icon: typeof CalendarDays; label: string; value: string | null; detail: string; tone?: "primary" | "success" | "warning" | "danger" }) {
  const iconClass = { primary: "bg-primary/10 text-primary", success: "bg-success/10 text-success", warning: "bg-warning/15 text-warning-foreground", danger: "bg-destructive/10 text-destructive" }[tone];
  return <Card variant="kpi" className="min-w-0"><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-caption text-muted-foreground">{label}</p><p className="mt-2 min-w-0 break-words text-h3 text-foreground">{value ?? <Skeleton className="h-8 w-28" />}</p></div><span className={`grid size-9 shrink-0 place-items-center rounded-xl ${iconClass}`}><Icon className="size-4" aria-hidden="true" /></span></div><p className="mt-2 text-caption">{detail}</p></CardContent></Card>;
}

function ExpenseBreakdown({ totals }: { totals: Record<DriverActivityExpenseCategory, number> }) {
  return <div className="grid gap-2 sm:grid-cols-2">{categoryOrder.map((category) => { const Icon = expenseIcons[category]; return <div key={category} className="flex items-center gap-3 rounded-xl border border-border/70 bg-surface px-3 py-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></span><div className="min-w-0"><p className="text-sm font-medium">{DRIVER_ACTIVITY_EXPENSE_LABELS[category]}</p><p className="text-caption text-muted-foreground">{formatXOF(totals[category])}</p></div></div>; })}</div>;
}

function CourseList({ courses, showFinancial }: { courses: Awaited<ReturnType<typeof getDriverActivitySummary>>["courses"]; showFinancial: boolean }) {
  return <div className="overflow-x-auto"><div className="min-w-[44rem] divide-y divide-border rounded-xl border border-border/70">{courses.map((course) => <div key={course.id} className="grid grid-cols-[minmax(10rem,1.2fr)_minmax(12rem,1.7fr)_repeat(3,minmax(8rem,1fr))] items-center gap-4 px-4 py-3.5"><div><Link className="font-medium text-primary hover:underline" to="/courses/$courseId" params={{ courseId: course.id }}>{course.mission_number}</Link><p className="mt-1 text-caption text-muted-foreground">{formatDate(course.activityDate)}</p></div><div><p className="font-medium">{course.departure_location || "Départ non renseigné"} → {course.destination_location || "Destination non renseignée"}</p><p className="mt-1 text-caption text-muted-foreground">{courseStatusLabel(course.status)}</p>{showFinancial && course.walletNames.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Wallets des opérations confirmées">{course.walletNames.map((walletName) => <Badge key={walletName} variant="info" appearance="soft">Confirmé : {walletName}</Badge>)}</div> : null}</div><AmountColumn label="Encaissé" value={showFinancial ? course.collectedAmount : null} /><AmountColumn label="Dépenses" value={showFinancial ? course.expenseAmount : null} /><AmountColumn label="Résultat" value={showFinancial ? course.netAmount : null} emphasis /></div>)}</div></div>;
}

function courseStatusLabel(status: string): string {
  return {
    DRAFT: "Brouillon",
    PLANNED: "Planifiée",
    IN_PROGRESS: "En cours",
    COMPLETED: "Terminée",
    CLOSED: "Clôturée",
    CANCELLED: "Annulée",
  }[status] ?? status;
}

function AmountColumn({ label, value, emphasis = false }: { label: string; value: number | null; emphasis?: boolean }) {
  return <div><p className="text-caption text-muted-foreground">{label}</p><p className={`mt-1 text-sm ${emphasis ? "font-semibold" : "font-medium"}`}>{value === null ? "Réservé" : formatXOF(value)}</p></div>;
}

function StatusCard({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <Card variant="information"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>{action ? <CardContent>{action}</CardContent> : null}</Card>;
}

function FinancialRestricted({ message = "Les montants financiers ne sont pas accessibles avec vos permissions actuelles." }: { message?: string }) {
  return <div className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">{message}</div>;
}

function EmptyCourses() {
  return <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center"><p className="font-medium">Aucune Course réalisée sur cette période</p><p className="mt-2 text-sm text-muted-foreground">Les Courses sont comptées lorsqu’un départ réel a été enregistré puis que leur statut est terminé ou clôturé.</p></div>;
}

function ExpenseSkeleton() { return <div className="grid gap-2 sm:grid-cols-2">{[0, 1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-[4.5rem]" />)}</div>; }
function CoursesSkeleton() { return <div className="space-y-2">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-20 w-full" />)}</div>; }

function defaultPeriod(): Period {
  const now = new Date();
  const to = toInputDate(now);
  const from = toInputDate(new Date(now.getFullYear(), now.getMonth(), 1));
  return { from, to };
}

function toInputDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatXOF(value: number): string { return `${value.toLocaleString("fr-FR")} FCFA`; }
function formatDate(value: string | null): string { return value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value)) : "Date non renseignée"; }
