import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeDollarSign,
  ClipboardList,
  Flag,
  Fuel,
  Landmark,
  Plus,
  ReceiptText,
  Route as RouteIcon,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { EntityDocumentsTab } from "@/components/documents/entity-documents-tab";
import { WalletSelect } from "@/components/selects/entity-selects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/hooks/use-permissions";
import {
  cancelCourseExpense,
  cancelCoursePayment,
  confirmCourseExpense,
  confirmCoursePayment,
  COURSE_EXPENSE_CATEGORIES,
  COURSE_EXPENSE_CATEGORY_LABELS,
  COURSE_PAYMENT_KINDS,
  COURSE_STATUS_LABELS,
  COURSE_STATUSES,
  createCourseExpense,
  createCourseInvoice,
  createCoursePayment,
  getCourse,
  getCourseHistory,
  issueCourseInvoice,
  setCourseStatus,
  type Course,
  type CourseExpense,
  type CourseInvoice,
  type CoursePayment,
} from "@/lib/courses.functions";

export const Route = createFileRoute("/_authenticated/courses/$courseId")({ component: CourseDetailsPage });

type CourseStatus = (typeof COURSE_STATUSES)[number];

function formatAmount(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${Number(value).toLocaleString("fr-FR")} FCFA`;
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: value.includes("T") ? "short" : undefined }).format(new Date(value))
    : "Non renseigné";
}

function statusVariant(status: string): "outline" | "info" | "warning" | "success" | "danger" {
  if (["CLOSED", "PAID", "CONFIRMED"].includes(status)) return "success";
  if (status === "CANCELLED") return "outline";
  if (status === "IN_PROGRESS") return "info";
  if (["PLANNED", "ENGAGED", "ISSUED", "PARTIALLY_PAID"].includes(status)) return "warning";
  return "outline";
}

function invoiceLabel(status: string) {
  const labels: Record<string, string> = {
    DRAFT: "Brouillon",
    ISSUED: "Émise",
    PARTIALLY_PAID: "Partiellement payée",
    PAID: "Payée",
    CANCELLED: "Annulée",
  };
  return labels[status] ?? status;
}

function invoiceDue(invoice: CourseInvoice, payments: CoursePayment[]) {
  return Math.max(0, Number(invoice.total_amount) - payments
    .filter((payment) => payment.invoice_id === invoice.id && payment.status === "CONFIRMED")
    .reduce((sum, payment) => sum + Number(payment.amount), 0));
}

function CourseDetailsPage() {
  const { courseId } = Route.useParams();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string | null>(null);

  const courseQuery = useQuery({ queryKey: ["course", courseId], queryFn: () => getCourse({ data: courseId }) });
  const historyQuery = useQuery({ queryKey: ["course-history", courseId], queryFn: () => getCourseHistory({ data: courseId }) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["course", courseId] });
    void queryClient.invalidateQueries({ queryKey: ["courses"] });
    void queryClient.invalidateQueries({ queryKey: ["course-history", courseId] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ status, reason }: { status: CourseStatus; reason?: string | null }) =>
      setCourseStatus({ data: { id: courseId, status, reason: reason ?? null } }),
    onSuccess: () => { toast.success("Statut de la Course mis à jour."); refresh(); },
    onError: notificationError,
  });
  const confirmExpense = useMutation({
    mutationFn: (id: string) => confirmCourseExpense({ data: { id } }),
    onSuccess: () => { toast.success("Dépense validée et débitée du wallet."); refresh(); },
    onError: notificationError,
  });
  const cancelExpense = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => cancelCourseExpense({ data: { id, reason } }),
    onSuccess: () => { toast.success("Dépense annulée par contre-écriture."); refresh(); },
    onError: notificationError,
  });
  const issueInvoice = useMutation({
    mutationFn: (id: string) => issueCourseInvoice({ data: { id } }),
    onSuccess: () => { toast.success("Facture émise."); refresh(); },
    onError: notificationError,
  });
  const confirmPayment = useMutation({
    mutationFn: (id: string) => confirmCoursePayment({ data: { id } }),
    onSuccess: () => { toast.success("Paiement confirmé et crédité au wallet."); refresh(); },
    onError: notificationError,
  });
  const cancelPayment = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => cancelCoursePayment({ data: { id, reason } }),
    onSuccess: () => { toast.success("Paiement annulé par contre-écriture."); refresh(); },
    onError: notificationError,
  });

  if (courseQuery.isPending) return <div className="p-6 text-muted-foreground">Chargement de la Course…</div>;
  if (courseQuery.isError || !courseQuery.data) {
    return <div className="space-y-4 p-6"><p className="text-destructive">Course introuvable ou non autorisée.</p><Button asChild variant="outline"><Link to="/courses"><ArrowLeft className="mr-2 size-4" />Retour aux Courses</Link></Button></div>;
  }

  const detail = courseQuery.data;
  const { course, financial } = detail;
  const canFinance = can("missions.finance.read");
  const paymentInvoice = detail.invoices.find((invoice) => invoice.id === paymentInvoiceId) ?? null;
  const hasActiveInvoice = detail.invoices.some((invoice) => invoice.status !== "CANCELLED");

  const setStatus = (status: Exclude<CourseStatus, "DRAFT">) => {
    const needsReason = status === "CANCELLED" || status === "CLOSED";
    const reason = needsReason
      ? window.prompt(status === "CANCELLED" ? "Justification de l’annulation :" : "Justification de dérogation (laissez vide si les règles sont satisfaites) :")
      : null;
    if (status === "CANCELLED" && !reason?.trim()) return;
    statusMutation.mutate({ status, reason });
  };

  const invoiceSummary = !detail.invoices.length
    ? "Aucune facture"
    : `${detail.invoices.length} facture${detail.invoices.length > 1 ? "s" : ""} · ${detail.invoices.filter((invoice) => invoice.status === "PAID").length} réglée${detail.invoices.filter((invoice) => invoice.status === "PAID").length > 1 ? "s" : ""}`;

  return <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
    <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <Button asChild variant="ghost" className="px-0"><Link to="/courses"><ArrowLeft className="mr-2 size-4" />Courses</Link></Button>
        <div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="text-h1">{course.mission_number}</h1><Badge variant={statusVariant(course.status)} appearance="soft">{COURSE_STATUS_LABELS[course.status as CourseStatus]}</Badge></div>
        <p className="mt-2 text-body-sm text-muted-foreground">{detail.clientName ?? "Client non accessible"} · {[course.departure_location, course.destination_location].filter(Boolean).join(" → ") || "Itinéraire à préciser"}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {course.status === "DRAFT" && can("missions.dispatch") ? <Button onClick={() => setStatus("PLANNED")}>Planifier</Button> : null}
        {course.status === "PLANNED" && can("missions.dispatch") ? <Button onClick={() => setStatus("IN_PROGRESS")}>Démarrer</Button> : null}
        {course.status === "IN_PROGRESS" && can("missions.update") ? <Button onClick={() => setStatus("COMPLETED")}>Terminer</Button> : null}
        {course.status === "COMPLETED" && can("missions.close") ? <Button onClick={() => setStatus("CLOSED")}>Clôturer</Button> : null}
        {course.status !== "CLOSED" && course.status !== "CANCELLED" && can("missions.cancel") ? <Button variant="outline" onClick={() => setStatus("CANCELLED")}>Archiver</Button> : null}
      </div>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric icon={BadgeDollarSign} label="Montant transport" value={formatAmount(course.quoted_amount)} />
      <Metric icon={ReceiptText} label="Résultat brut" value={canFinance ? formatAmount(financial?.gross_result) : "Accès limité"} />
      <Metric icon={WalletCards} label="Résultat encaissé" value={canFinance ? formatAmount(financial?.cash_result) : "Accès limité"} />
      <Metric icon={Landmark} label="Reste à encaisser" value={canFinance ? formatAmount(financial?.amount_due) : "Accès limité"} />
      <Metric icon={Flag} label="Progression" value={course.status === "CLOSED" ? "Soldée" : course.status === "COMPLETED" ? "À clôturer" : COURSE_STATUS_LABELS[course.status as CourseStatus]} />
    </section>

    <Tabs defaultValue="overview" className="space-y-5">
      <TabsList className="h-auto max-w-full flex-wrap justify-start">
        <TabsTrigger value="overview">Vue générale</TabsTrigger><TabsTrigger value="transport">Transport</TabsTrigger><TabsTrigger value="vehicle">Véhicule</TabsTrigger><TabsTrigger value="driver">Chauffeur</TabsTrigger><TabsTrigger value="budget">Budget</TabsTrigger>
        {canFinance ? <><TabsTrigger value="expenses">Dépenses</TabsTrigger><TabsTrigger value="invoice">Facture</TabsTrigger><TabsTrigger value="payments">Paiements</TabsTrigger><TabsTrigger value="profitability">Rentabilité</TabsTrigger></> : null}
        <TabsTrigger value="documents">Documents</TabsTrigger><TabsTrigger value="history">Historique</TabsTrigger>
      </TabsList>

      <TabsContent value="overview"><div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <Card variant="section"><CardHeader><CardTitle>Situation de la Course</CardTitle></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2">
          <Info label="Client" value={detail.clientName ?? "Non accessible"} /><Info label="Wallets concernés" value={canFinance ? "Les wallets sont tracés dans les dépenses et paiements." : "Accès limité"} />
          <Info label="Départ prévu" value={formatDate(course.planned_departure_at)} /><Info label="Arrivée prévue" value={formatDate(course.planned_arrival_at)} />
          <Info label="Factures" value={invoiceSummary} /><Info label="Solde client" value={canFinance ? formatAmount(financial?.amount_due) : "Accès limité"} />
        </CardContent></Card>
        <Card variant="information"><CardHeader><CardTitle>Règle de clôture</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p>Une Course est clôturée lorsque toutes ses dépenses sont validées ou annulées, toutes ses factures actives sont réglées et le solde client est nul.</p><p>Les dérogations administrateur sont justifiées et conservées dans l’historique.</p></CardContent></Card>
      </div></TabsContent>

      <TabsContent value="transport"><Card><CardHeader><CardTitle>Informations de transport</CardTitle></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Info label="Départ" value={course.departure_location ?? "Non renseigné"} /><Info label="Destination" value={course.destination_location ?? "Non renseignée"} /><Info label="Distance prévue" value={course.distance_km === null ? "Non renseignée" : `${course.distance_km.toLocaleString("fr-FR")} km`} />
        <Info label="Marchandise" value={course.cargo_description ?? "Non renseignée"} /><Info label="Quantité" value={course.cargo_quantity === null ? "Non renseignée" : `${course.cargo_quantity} ${course.cargo_unit ?? ""}`.trim()} /><Info label="Poids / volume" value={[course.cargo_weight_kg ? `${course.cargo_weight_kg} kg` : null, course.cargo_volume_m3 ? `${course.cargo_volume_m3} m³` : null].filter(Boolean).join(" · ") || "Non renseigné"} />
        <Info label="Départ réel" value={formatDate(course.actual_departure_at)} /><Info label="Arrivée réelle" value={formatDate(course.actual_arrival_at)} /><Info label="Kilométrage" value={course.start_odometer !== null && course.end_odometer !== null ? `${course.start_odometer.toLocaleString("fr-FR")} → ${course.end_odometer.toLocaleString("fr-FR")} km` : "À renseigner au départ et à l’arrivée"} />
      </CardContent></Card></TabsContent>

      <TabsContent value="vehicle"><Card><CardHeader><CardTitle>Véhicule affecté</CardTitle></CardHeader><CardContent>{detail.vehicle ? <div className="grid gap-5 sm:grid-cols-2">
        <Info label="Véhicule" value={`${detail.vehicle.registration}${detail.vehicle.brand ? ` · ${detail.vehicle.brand}` : ""}${detail.vehicle.model ? ` ${detail.vehicle.model}` : ""}`} /><Info label="Statut" value={detail.vehicle.status ?? "Non renseigné"} /><Info label="Kilométrage enregistré" value={detail.vehicle.kilometrage === null ? "Non renseigné" : `${detail.vehicle.kilometrage.toLocaleString("fr-FR")} km`} />
        <div><p className="text-sm font-medium">Documents réglementaires</p><p className="mt-1 text-sm text-muted-foreground">Assurance et visite technique se consultent depuis la fiche du véhicule.</p><Button asChild className="mt-3" variant="outline" size="sm"><Link to="/vehicles/$vehicleId" params={{ vehicleId: detail.vehicle.id }}>Ouvrir le véhicule</Link></Button></div>
      </div> : <Empty message="Aucun véhicule n’est affecté à cette Course." />}</CardContent></Card></TabsContent>

      <TabsContent value="driver"><Card><CardHeader><CardTitle>Chauffeur affecté</CardTitle></CardHeader><CardContent>{detail.driver ? <div className="grid gap-5 sm:grid-cols-2">
        <Info label="Chauffeur" value={detail.driver.name} /><Info label="Téléphone" value={detail.driver.telephone ?? "Non renseigné"} /><Info label="Permis" value={detail.driver.licenseExpiry ? `Expire le ${formatDate(detail.driver.licenseExpiry)}` : "Non renseigné"} />
        <div><p className="text-sm font-medium">Historique et documents</p><p className="mt-1 text-sm text-muted-foreground">Les informations du chauffeur restent centralisées dans sa fiche.</p><Button asChild className="mt-3" variant="outline" size="sm"><Link to="/drivers/$driverId" params={{ driverId: detail.driver.id }}>Ouvrir le chauffeur</Link></Button></div>
      </div> : <Empty message="Aucun chauffeur n’est affecté à cette Course." />}</CardContent></Card></TabsContent>

      <TabsContent value="budget"><Card><CardHeader><CardTitle>Budget prévisionnel</CardTitle></CardHeader><CardContent>{detail.budgets.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{detail.budgets.map((line) => <div key={line.id} className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">{COURSE_EXPENSE_CATEGORY_LABELS[line.category as keyof typeof COURSE_EXPENSE_CATEGORY_LABELS] ?? line.category}</p><p className="mt-2 text-h3">{formatAmount(line.planned_amount)}</p></div>)}</div> : <Empty message="Aucun budget prévisionnel n’a été saisi. Il n’existe donc aucune hypothèse financière à afficher." />}</CardContent></Card></TabsContent>

      {canFinance ? <TabsContent value="expenses"><div className="space-y-4"><div className="flex justify-end">{can("missions.expenses.manage") && course.status !== "CLOSED" && course.status !== "CANCELLED" ? <Button onClick={() => setExpenseOpen(true)}><Plus className="mr-2 size-4" />Ajouter une dépense</Button> : null}</div><ExpensesPanel expenses={detail.expenses} canConfirm={can("missions.expenses.confirm")} confirmPending={confirmExpense.isPending} cancelPending={cancelExpense.isPending} onConfirm={(id) => confirmExpense.mutate(id)} onCancel={(id) => { const reason = window.prompt("Justification de l’annulation :"); if (reason?.trim()) cancelExpense.mutate({ id, reason }); }} /></div></TabsContent> : null}

      {canFinance ? <TabsContent value="invoice"><div className="space-y-4"><div className="flex justify-end">{can("missions.invoice") && !hasActiveInvoice && course.status !== "CLOSED" && course.status !== "CANCELLED" ? <Button onClick={() => setInvoiceOpen(true)}><Plus className="mr-2 size-4" />Créer la facture</Button> : null}</div><InvoicePanel invoices={detail.invoices} payments={detail.payments} course={course} clientName={detail.clientName} canIssue={can("missions.invoice")} canReceivePayments={can("missions.payments")} issuing={issueInvoice.isPending} onIssue={(id) => issueInvoice.mutate(id)} onRecordPayment={setPaymentInvoiceId} /></div></TabsContent> : null}

      {canFinance ? <TabsContent value="payments"><PaymentsPanel invoices={detail.invoices} payments={detail.payments} canConfirm={can("missions.payments")} confirmPending={confirmPayment.isPending} cancelPending={cancelPayment.isPending} onConfirm={(id) => confirmPayment.mutate(id)} onCancel={(id) => { const reason = window.prompt("Justification de l’annulation :"); if (reason?.trim()) cancelPayment.mutate({ id, reason }); }} /></TabsContent> : null}

      {canFinance ? <TabsContent value="profitability"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={BadgeDollarSign} label="Transport" value={formatAmount(financial?.quoted_amount)} /><Metric icon={ClipboardList} label="Budget prévu" value={formatAmount(financial?.budget_amount)} /><Metric icon={Fuel} label="Dépenses réelles" value={formatAmount(financial?.actual_expenses)} /><Metric icon={WalletCards} label="Montant encaissé" value={formatAmount(financial?.received_amount)} /><Metric icon={Landmark} label="Résultat brut" value={formatAmount(financial?.gross_result)} /><Metric icon={Landmark} label="Résultat encaissé" value={formatAmount(financial?.cash_result)} /><Metric icon={RouteIcon} label="Coût / km" value={financial?.cost_per_km === null || financial?.cost_per_km === undefined ? "Disponible lorsque les deux kilométrages sont valides" : formatAmount(financial.cost_per_km)} /><Metric icon={Flag} label="Écart prévu / réel" value={financial ? formatAmount(financial.budget_amount - financial.actual_expenses) : "—"} /></div></TabsContent> : null}

      <TabsContent value="documents"><EntityDocumentsTab entityId={courseId} relation="mission" /></TabsContent>
      <TabsContent value="history"><Card><CardHeader><CardTitle>Historique audité</CardTitle></CardHeader><CardContent>{historyQuery.isPending ? <p className="text-sm text-muted-foreground">Chargement de l’historique…</p> : historyQuery.isError ? <p className="text-sm text-destructive">Impossible de charger l’historique.</p> : historyQuery.data?.length ? <ol className="space-y-3">{historyQuery.data.map((entry) => <li key={entry.id} className="rounded-xl border p-4"><p className="font-medium">{historyLabel(entry.source_type, entry.action)}</p><p className="mt-1 text-sm text-muted-foreground">{formatDate(entry.created_at)}</p></li>)}</ol> : <Empty message="Aucun événement visible pour cette Course." />}</CardContent></Card></TabsContent>
    </Tabs>

    <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}><DialogContent><DialogHeader><DialogTitle>Ajouter une dépense</DialogTitle></DialogHeader><ExpenseForm missionId={courseId} onSuccess={() => { setExpenseOpen(false); refresh(); }} /></DialogContent></Dialog>
    <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}><DialogContent><DialogHeader><DialogTitle>Créer une facture</DialogTitle></DialogHeader><InvoiceForm missionId={courseId} defaultAmount={course.quoted_amount} onSuccess={() => { setInvoiceOpen(false); refresh(); }} /></DialogContent></Dialog>
    <Dialog open={paymentInvoiceId !== null} onOpenChange={(open) => { if (!open) setPaymentInvoiceId(null); }}><DialogContent><DialogHeader><DialogTitle>Enregistrer un paiement</DialogTitle></DialogHeader>{paymentInvoice ? <PaymentForm invoiceId={paymentInvoice.id} due={invoiceDue(paymentInvoice, detail.payments)} onSuccess={() => { setPaymentInvoiceId(null); refresh(); }} /> : null}</DialogContent></Dialog>
  </div>;
}

function notificationError(error: unknown) { toast.error(error instanceof Error ? error.message : "L’action n’a pas pu être effectuée."); }
function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) { return <Card variant="kpi" className="p-4"><div className="flex items-start justify-between gap-3"><p className="text-label text-muted-foreground">{label}</p><div className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></div></div><p className="mt-4 break-words text-h3 tabular-nums">{value}</p></Card>; }
function Info({ label, value }: { label: string; value: string }) { return <div><p className="text-sm font-medium">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{value}</p></div>; }
function Empty({ message }: { message: string }) { return <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">{message}</p>; }
function historyLabel(source: string, action: string) { const names: Record<string, string> = { COURSE: "Course", COURSE_EXPENSE: "Dépense", COURSE_INVOICE: "Facture", COURSE_PAYMENT: "Paiement" }; const actions: Record<string, string> = { CREATE: "créé", UPDATE: "mis à jour", CLOSE: "clôturé", CANCEL: "annulé" }; return `${names[source] ?? source} ${actions[action] ?? action}`; }

function ExpensesPanel({ expenses, canConfirm, confirmPending, cancelPending, onConfirm, onCancel }: { expenses: CourseExpense[]; canConfirm: boolean; confirmPending: boolean; cancelPending: boolean; onConfirm: (id: string) => void; onCancel: (id: string) => void }) {
  if (!expenses.length) return <Empty message="Aucune dépense n’est enregistrée. Une dépense n’impacte le wallet qu’après validation." />;
  return <Card><CardContent className="p-0"><div className="divide-y">{expenses.map((expense) => <div key={expense.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{COURSE_EXPENSE_CATEGORY_LABELS[expense.category as keyof typeof COURSE_EXPENSE_CATEGORY_LABELS] ?? expense.category} · {formatAmount(expense.amount)}</p><p className="mt-1 text-sm text-muted-foreground">{formatDate(expense.expense_date)} · Wallet {expense.wallet_id.slice(0, 8)} · {expense.description ?? "Sans description"}</p></div><div className="flex items-center gap-2"><Badge variant={statusVariant(expense.status)} appearance="soft">{expense.status === "PAID" ? "Validée" : expense.status === "ENGAGED" ? "Engagée" : expense.status === "CANCELLED" ? "Annulée" : "Prévue"}</Badge>{canConfirm && expense.status !== "PAID" && expense.status !== "CANCELLED" ? <Button size="sm" onClick={() => onConfirm(expense.id)} disabled={confirmPending}>Valider</Button> : null}{canConfirm && expense.status !== "CANCELLED" ? <Button size="sm" variant="outline" onClick={() => onCancel(expense.id)} disabled={cancelPending}>Annuler</Button> : null}</div></div>)}</div></CardContent></Card>;
}

function InvoicePanel({ invoices, payments, course, clientName, canIssue, canReceivePayments, issuing, onIssue, onRecordPayment }: { invoices: CourseInvoice[]; payments: CoursePayment[]; course: Pick<Course, "mission_number" | "departure_location" | "destination_location">; clientName: string | null; canIssue: boolean; canReceivePayments: boolean; issuing: boolean; onIssue: (id: string) => void; onRecordPayment: (id: string) => void }) {
  if (!invoices.length) return <Empty message="Aucune facture n’est créée. Une Course possède une facture active ; une facture annulée reste consultable dans son historique." />;
  return <div className="space-y-4">{invoices.map((invoice) => <Card key={invoice.id}><CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle>{invoice.invoice_number}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{invoiceLabel(invoice.status)}</p></div><div className="flex flex-wrap gap-2">{canIssue && invoice.status === "DRAFT" ? <Button onClick={() => onIssue(invoice.id)} disabled={issuing}>Émettre</Button> : null}{canReceivePayments && ["ISSUED", "PARTIALLY_PAID"].includes(invoice.status) && invoiceDue(invoice, payments) > 0 ? <Button variant="outline" onClick={() => onRecordPayment(invoice.id)}>Paiement</Button> : null}</div></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2"><div className="rounded-xl border bg-muted/30 p-4"><p className="text-overline text-primary">Prévisualisation</p><p className="mt-3 font-semibold">Facture {invoice.invoice_number}</p><p className="mt-1 text-sm text-muted-foreground">Client : {clientName ?? "Non accessible"}</p><p className="text-sm text-muted-foreground">Course : {course.mission_number}</p><p className="text-sm text-muted-foreground">{[course.departure_location, course.destination_location].filter(Boolean).join(" → ")}</p></div><dl className="space-y-3 text-sm"><Summary label="Montant HT" value={formatAmount(invoice.subtotal_amount)} /><Summary label="TVA" value={`${invoice.tax_rate.toLocaleString("fr-FR")} % · ${formatAmount(invoice.tax_amount)}`} /><Summary label="Total" value={formatAmount(invoice.total_amount)} /><Summary label="Reste à encaisser" value={formatAmount(invoiceDue(invoice, payments))} /><Summary label="Émission" value={formatDate(invoice.issue_date)} /></dl></CardContent></Card>)}</div>;
}

function PaymentsPanel({ invoices, payments, canConfirm, confirmPending, cancelPending, onConfirm, onCancel }: { invoices: CourseInvoice[]; payments: CoursePayment[]; canConfirm: boolean; confirmPending: boolean; cancelPending: boolean; onConfirm: (id: string) => void; onCancel: (id: string) => void }) {
  const invoiceNumbers = new Map(invoices.map((invoice) => [invoice.id, invoice.invoice_number]));
  if (!payments.length) return <Empty message="Aucun paiement n’est reçu. Un paiement confirmé crédite le wallet sélectionné." />;
  return <Card><CardContent className="p-0"><div className="divide-y">{payments.map((payment) => <div key={payment.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{formatAmount(payment.amount)} · {payment.payment_kind === "ADVANCE" ? "Acompte" : payment.payment_kind === "SETTLEMENT" ? "Règlement" : "Paiement"}</p><p className="mt-1 text-sm text-muted-foreground">{invoiceNumbers.get(payment.invoice_id) ?? "Facture non accessible"} · {formatDate(payment.payment_date)} · {payment.reference ?? "Sans référence"}</p></div><div className="flex items-center gap-2"><Badge variant={statusVariant(payment.status)} appearance="soft">{payment.status === "CONFIRMED" ? "Confirmé" : payment.status === "RECEIVED" ? "Reçu" : payment.status === "CANCELLED" ? "Annulé" : "Prévu"}</Badge>{canConfirm && payment.status !== "CONFIRMED" && payment.status !== "CANCELLED" ? <Button size="sm" disabled={confirmPending} onClick={() => onConfirm(payment.id)}>Confirmer</Button> : null}{canConfirm && payment.status !== "CANCELLED" ? <Button size="sm" variant="outline" disabled={cancelPending} onClick={() => onCancel(payment.id)}>Annuler</Button> : null}</div></div>)}</div></CardContent></Card>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="flex items-baseline justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>; }

function ExpenseForm({ missionId, onSuccess }: { missionId: string; onSuccess: () => void }) {
  const [walletId, setWalletId] = useState(""); const [category, setCategory] = useState<(typeof COURSE_EXPENSE_CATEGORIES)[number]>("FUEL"); const [amount, setAmount] = useState(""); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [description, setDescription] = useState("");
  const mutation = useMutation({ mutationFn: () => createCourseExpense({ data: { missionId, expense: { wallet_id: walletId, category, amount: Number(amount), expense_date: date, status: "ENGAGED", description: description.trim() || null, receipt_document_id: null } } }), onSuccess: () => { toast.success("Dépense ajoutée. Validez-la pour créer le mouvement financier."); onSuccess(); }, onError: notificationError });
  return <div className="space-y-4"><div className="space-y-2"><Label>Wallet</Label><WalletSelect value={walletId} onValueChange={setWalletId} /></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Catégorie"><Select value={category} onValueChange={(value) => setCategory(value as (typeof COURSE_EXPENSE_CATEGORIES)[number])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{COURSE_EXPENSE_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{COURSE_EXPENSE_CATEGORY_LABELS[item]}</SelectItem>)}</SelectContent></Select></Field><Field label="Montant (FCFA)"><Input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="Date"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field></div><Field label="Description"><Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Button className="w-full" disabled={!walletId || Number(amount) <= 0 || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Ajout…" : "Ajouter la dépense"}</Button></div>;
}

function InvoiceForm({ missionId, defaultAmount, onSuccess }: { missionId: string; defaultAmount: number; onSuccess: () => void }) {
  const [amount, setAmount] = useState(String(defaultAmount)); const [rate, setRate] = useState(""); const [dueDate, setDueDate] = useState(""); const [notes, setNotes] = useState("");
  const mutation = useMutation({ mutationFn: () => createCourseInvoice({ data: { missionId, invoice: { subtotal_amount: amount ? Number(amount) : null, tax_rate: rate ? Number(rate) : null, due_date: dueDate || null, notes: notes.trim() || null } } }), onSuccess: () => { toast.success("Facture créée en brouillon."); onSuccess(); }, onError: notificationError });
  return <div className="space-y-4"><p className="text-sm text-muted-foreground">La TVA est proposée uniquement si elle est activée dans les paramètres de l’entreprise. Une facture créée reste en brouillon jusqu’à son émission.</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Montant HT (FCFA)"><Input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="TVA (%)"><Input type="number" min="0" max="100" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="Paramètre par défaut" /></Field><Field label="Échéance"><Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field></div><Field label="Notes"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field><Button className="w-full" disabled={Number(amount) < 0 || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Création…" : "Créer la facture"}</Button></div>;
}

function PaymentForm({ invoiceId, due, onSuccess }: { invoiceId: string; due: number; onSuccess: () => void }) {
  const [walletId, setWalletId] = useState(""); const [amount, setAmount] = useState(String(due)); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [kind, setKind] = useState<(typeof COURSE_PAYMENT_KINDS)[number]>("PAYMENT"); const [reference, setReference] = useState("");
  const mutation = useMutation({ mutationFn: () => createCoursePayment({ data: { invoiceId, payment: { wallet_id: walletId, amount: Number(amount), payment_date: date, payment_kind: kind, reference: reference.trim() || null, notes: null } } }), onSuccess: () => { toast.success("Paiement enregistré. Confirmez-le pour créditer le wallet."); onSuccess(); }, onError: notificationError });
  return <div className="space-y-4"><p className="rounded-lg bg-muted p-3 text-sm">Reste à encaisser : <strong>{formatAmount(due)}</strong>. Le surpaiement est bloqué côté serveur.</p><div className="space-y-2"><Label>Wallet</Label><WalletSelect value={walletId} onValueChange={setWalletId} /></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Montant (FCFA)"><Input type="number" min="1" max={due} value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="Date"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Type"><Select value={kind} onValueChange={(value) => setKind(value as (typeof COURSE_PAYMENT_KINDS)[number])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ADVANCE">Acompte</SelectItem><SelectItem value="PAYMENT">Paiement partiel</SelectItem><SelectItem value="SETTLEMENT">Règlement</SelectItem></SelectContent></Select></Field><Field label="Référence"><Input value={reference} onChange={(event) => setReference(event.target.value)} /></Field></div><Button className="w-full" disabled={!walletId || Number(amount) <= 0 || Number(amount) > due || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Enregistrement…" : "Enregistrer le paiement"}</Button></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
