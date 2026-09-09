import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeDollarSign,
  Car,
  CircleDollarSign,
  Clock3,
  Fuel,
  Landmark,
  Package,
  Plus,
  ReceiptText,
  Route as RouteIcon,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { EntityDocumentsTab } from "@/components/documents/entity-documents-tab";
import { AssignmentDialog, CourseDeliveryDialog, CourseDepartureDialog } from "@/components/courses/operational-course-workspace";
import { JekoCourseCheckoutDialog } from "@/components/payments/jeko-course-checkout-dialog";
import { WalletSelect } from "@/components/selects/entity-selects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
  COURSE_PRICING_MODES,
  COURSE_PRICING_MODE_LABELS,
  COURSE_STATUS_LABELS,
  COURSE_STATUSES,
  createCourseExpense,
  createCourseInvoice,
  createCoursePayment,
  deleteCourse,
  getCourse,
  getCourseHistory,
  issueCourseInvoice,
  setCourseStatus,
  updateCourse,
  updateCourseActuals,
  type Course,
  type CourseExpenseWithWallet,
  type CourseFinancialSummary,
  type CourseHistoryEntry,
  type CourseInvoice,
  type CoursePayment,
} from "@/lib/courses.functions";
import { isSessionExpiredError } from "@/lib/error-classification";
import { formatXOF as formatAmount } from "@/lib/format";
import { triggerSessionRecovery } from "@/lib/notify-mutation-error";

export const Route = createFileRoute("/_authenticated/courses/$courseId")({ component: CourseDetailsPage });

type CourseStatus = (typeof COURSE_STATUSES)[number];

// formatDate reste locale : s'adapte pour afficher aussi l'heure quand la
// valeur en contient une (dateStyle+timeStyle conditionnels) -- un
// comportement différent des formateurs partagés, propre à cet écran.
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [planningOpen, setPlanningOpen] = useState(false);
  const [plannedDeparture, setPlannedDeparture] = useState("");
  const [plannedArrival, setPlannedArrival] = useState("");
  const [departureOpen, setDepartureOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [actualsOpen, setActualsOpen] = useState(false);
  const [cancellationTarget, setCancellationTarget] = useState<{ kind: "expense" | "payment"; id: string } | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");

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
    onSuccess: (updatedCourse) => {
      if (updatedCourse.status === "CANCELLED") {
        toast.success("Course annulée et archivée. Son historique reste conservé.");
      } else if (updatedCourse.status === "CLOSED") {
        toast.success("Course clôturée.");
      } else {
        toast.success("Statut de la Course mis à jour.");
      }
      refresh();
    },
    onError: notificationError,
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteCourse({ data: { id: courseId } }),
    onSuccess: () => {
      toast.success("Course supprimée.");
      void queryClient.invalidateQueries({ queryKey: ["courses"] });
      void navigate({ to: "/courses" });
    },
    onError: notificationError,
  });
  const planningMutation = useMutation({
    mutationFn: async ({ departure, arrival }: { departure: string; arrival: string }) => {
      const plannedDepartureAt = toIsoDateTime(departure);
      const plannedArrivalAt = toIsoDateTime(arrival);

      if (plannedArrivalAt <= plannedDepartureAt) {
        throw new Error("L’arrivée prévue doit être postérieure au départ prévu.");
      }

      const updatedCourse = await updateCourse({
        data: {
          id: courseId,
          values: {
            planned_departure_at: plannedDepartureAt,
            planned_arrival_at: plannedArrivalAt,
          },
        },
      });

      if (courseQuery.data?.course.status === "DRAFT") {
        return setCourseStatus({ data: { id: courseId, status: "PLANNED", reason: null } });
      }

      return updatedCourse;
    },
    onSuccess: () => {
      toast.success(courseQuery.data?.course.status === "DRAFT" ? "Course planifiée." : "Planification mise à jour.");
      setPlanningOpen(false);
      refresh();
    },
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

  if (courseQuery.isPending) return <CourseDetailsSkeleton />;
  if (courseQuery.isError || !courseQuery.data) {
    return <div className="space-y-4 p-6"><p className="text-destructive">Course introuvable ou non autorisée.</p><Button asChild variant="outline"><Link to="/courses"><ArrowLeft className="mr-2 size-4" />Retour aux Courses</Link></Button></div>;
  }

  const detail = courseQuery.data;
  const { course, financial } = detail;
  const canFinance = can("missions.finance.read");
  const paymentInvoice = detail.invoices.find((invoice) => invoice.id === paymentInvoiceId) ?? null;
  const hasActiveInvoice = detail.invoices.some((invoice) => invoice.status !== "CANCELLED");

  const openPlanning = () => {
    setPlannedDeparture(toDateTimeLocal(course.planned_departure_at));
    setPlannedArrival(toDateTimeLocal(course.planned_arrival_at));
    setPlanningOpen(true);
  };

  const invoiceSummary = !detail.invoices.length
    ? "Aucune facture"
    : `${detail.invoices.length} facture${detail.invoices.length > 1 ? "s" : ""} · ${detail.invoices.filter((invoice) => invoice.status === "PAID").length} réglée${detail.invoices.filter((invoice) => invoice.status === "PAID").length > 1 ? "s" : ""}`;

  return <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
    <section className="relative isolate overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-surface-elevated to-surface px-5 py-6 shadow-md sm:px-7 sm:py-7 lg:px-8">
      <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-primary/15 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-28 left-1/3 size-64 rounded-full bg-info/10 blur-3xl" aria-hidden="true" />
      <div className="relative">
    <header className="flex flex-col gap-5 border-b border-primary/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <Button asChild variant="ghost" className="px-0"><Link to="/courses"><ArrowLeft className="mr-2 size-4" />Courses</Link></Button>
        <div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="text-h1">{course.mission_number}</h1><Badge variant={statusVariant(course.status)} appearance="soft">{COURSE_STATUS_LABELS[course.status as CourseStatus]}</Badge></div>
        <p className="mt-2 text-body-sm text-muted-foreground">{detail.clientName ?? "Client non accessible"} · {[course.departure_location, course.destination_location].filter(Boolean).join(" → ") || "Itinéraire à préciser"}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {["DRAFT", "PLANNED"].includes(course.status) && can("assignments.manage") ? <Button variant="outline" onClick={() => setAssignmentOpen(true)}>Affecter</Button> : null}
        {course.status === "DRAFT" && can("missions.dispatch") ? <Button onClick={openPlanning}>Planifier</Button> : null}
        {course.status === "PLANNED" && can("missions.dispatch") ? <Button variant="outline" onClick={openPlanning}>Replanifier</Button> : null}
        {course.status === "PLANNED" && can("departures.confirm") ? <Button onClick={() => setDepartureOpen(true)}>Démarrer</Button> : null}
        {course.status !== "CLOSED" && course.status !== "CANCELLED" && can("missions.expenses.manage") ? <Button variant="outline" onClick={() => setExpenseOpen(true)}>Ajouter une dépense</Button> : null}
        {course.status === "IN_PROGRESS" && can("deliveries.confirm") ? <Button onClick={() => setDeliveryOpen(true)}>Finaliser / livrer</Button> : null}
        {/* AUDIT TOTAL (symptôme 2) : la visibilité du bouton doit refléter
            exactement la règle de la RPC (update_transport_mission_actuals,
            20260813143000), pas une approximation -- sur une Course
            COMPLETED/CLOSED elle exige deliveries.correct seul (missions.update
            seul ne suffit plus, contrairement à avant finalisation) ; sinon
            missions.update OU deliveries.confirm. Avant ce correctif, un
            gestionnaire/operations (missions.update sans deliveries.correct)
            voyait le bouton sur une Course finalisée puis recevait 42501. */}
        {course.status !== "CANCELLED" && ((course.status === "COMPLETED" || course.status === "CLOSED") ? can("deliveries.correct") : (can("missions.update") || can("deliveries.confirm"))) ? <Button variant="outline" onClick={() => setActualsOpen(true)}>Corriger les données</Button> : null}
        {course.status === "COMPLETED" && can("missions.close") ? <Button onClick={() => setCloseOpen(true)} disabled={statusMutation.isPending}>Clôturer</Button> : null}
        {["DRAFT", "PLANNED"].includes(course.status) && can("missions.delete") ? <Button variant="outline" onClick={() => setDeleteOpen(true)}><Trash2 className="mr-2 size-4" />Supprimer</Button> : null}
        {course.status !== "CLOSED" && course.status !== "CANCELLED" && can("missions.cancel") ? <Button variant="outline" onClick={() => setArchiveOpen(true)}>Annuler / archiver</Button> : null}
      </div>
    </header>

    <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <CockpitStat icon={BadgeDollarSign} label="Transport réel" value={formatAmount(course.actual_transport_amount)} detail="Montant confirmé ou calculé" tone="info" />
      <CockpitStat icon={Fuel} label="Dépenses réelles" value={canFinance ? formatAmount(financial?.actual_expenses) : "Accès limité"} detail={canFinance ? "Dépenses validées" : "Accès financier requis"} tone="warning" />
      <CockpitStat icon={financial?.gross_result !== null && financial?.gross_result !== undefined && financial.gross_result < 0 ? TrendingDown : TrendingUp} label="Résultat Course" value={canFinance ? (financial?.gross_result === null || financial?.gross_result === undefined ? "Non disponible" : formatAmount(financial.gross_result)) : "Accès limité"} detail={canFinance ? "Transport réel moins dépenses réelles" : "Accès financier requis"} tone={financial?.gross_result !== null && financial?.gross_result !== undefined && financial.gross_result < 0 ? "danger" : "success"} />
      <CockpitStat icon={WalletCards} label="Reste à encaisser" value={canFinance ? formatAmount(financial?.amount_due) : "Accès limité"} detail={canFinance ? "Solde client actuel" : "Accès financier requis"} tone="warning" />
    </div>
    <p className="mt-4 text-caption text-muted-foreground">Les montants proviennent du résumé financier calculé de cette Course.</p>
    <div className="mt-5 grid gap-3 border-t border-primary/10 pt-5 sm:grid-cols-2 xl:grid-cols-4">
      <CockpitIdentity icon={Package} label="Marchandise" value={course.cargo_description ?? "À préciser"} />
      <CockpitIdentity icon={Car} label="Véhicule" value={detail.vehicle ? `${detail.vehicle.registration}${detail.vehicle.brand ? ` · ${detail.vehicle.brand}` : ""}` : "Non affecté"} />
      <CockpitIdentity icon={UserRound} label="Chauffeur" value={detail.driver?.name ?? "Non affecté"} />
      <CockpitIdentity icon={Clock3} label="Départ prévu" value={formatDate(course.planned_departure_at)} />
    </div>

      </div>
    </section>

    <Tabs defaultValue="overview" className="space-y-5">
      <TabsList className="h-auto max-w-full justify-start gap-1 overflow-x-auto rounded-xl border border-border/80 bg-surface-elevated/80 p-1.5">
        <TabsTrigger value="overview">Fiche Course</TabsTrigger><TabsTrigger value="transport">Transport réel</TabsTrigger>
        {canFinance ? <><TabsTrigger value="expenses">Dépenses réelles</TabsTrigger><TabsTrigger value="finance">Finance</TabsTrigger></> : null}
        <TabsTrigger value="documents">Documents</TabsTrigger><TabsTrigger value="history">Historique</TabsTrigger>
      </TabsList>

      <TabsContent value="overview"><div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <Card variant="section"><CardHeader><CardTitle>Situation de la Course</CardTitle></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2">
          <Info label="Client" value={detail.clientName ?? "Non accessible"} /><Info label="Marchandise" value={course.cargo_description ?? "À renseigner"} />
          <Info label="Départ prévu" value={formatDate(course.planned_departure_at)} /><Info label="Arrivée prévue" value={formatDate(course.planned_arrival_at)} />
          <Info label="Véhicule" value={detail.vehicle?.registration ?? "À affecter"} /><Info label="Chauffeur" value={detail.driver?.name ?? "À affecter"} />
          <Info label="Factures" value={invoiceSummary} /><Info label="Solde client" value={canFinance ? formatAmount(financial?.amount_due) : "Accès limité"} />
        </CardContent></Card>
        <Card variant="information"><CardHeader><CardTitle>Règle de clôture</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p>Une Course est clôturée lorsque toutes ses dépenses sont validées ou annulées, toutes ses factures actives sont réglées et le solde client est nul.</p><p>Les dérogations administrateur sont justifiées et conservées dans l’historique.</p></CardContent></Card>
      </div></TabsContent>

      <TabsContent value="transport"><Card><CardHeader><CardTitle>Informations de transport</CardTitle></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Info label="Chargement" value={course.departure_location ?? "Non renseigné"} /><Info label="Destination" value={course.destination_location ?? "Non renseignée"} /><Info label="Marchandise" value={course.cargo_description ?? "Non renseignée"} />
        <Info label="Poids réel" value={course.cargo_weight_kg === null ? "Non renseigné" : `${course.cargo_weight_kg.toLocaleString("fr-FR")} kg`} /><Info label="Tarification" value={course.pricing_mode ? COURSE_PRICING_MODE_LABELS[course.pricing_mode as keyof typeof COURSE_PRICING_MODE_LABELS] ?? course.pricing_mode : "Non renseignée"} /><Info label="Tarif" value={course.unit_rate === null ? "Non renseigné" : `${course.unit_rate.toLocaleString("fr-FR")} FCFA${course.pricing_mode === "PER_KG" ? "/kg" : course.pricing_mode === "PER_TONNE" ? "/tonne" : ""}`} />
        <Info label="Transport réel" value={formatAmount(course.actual_transport_amount)} />
        <Info label="Départ réel" value={formatDate(course.actual_departure_at)} /><Info label="Arrivée réelle" value={formatDate(course.actual_arrival_at)} /><Info label="Kilométrage départ" value={course.start_odometer === null ? "Non renseigné" : `${course.start_odometer.toLocaleString("fr-FR")} km`} />
        <Info label="Kilométrage arrivée" value={course.end_odometer === null ? "Non renseigné" : `${course.end_odometer.toLocaleString("fr-FR")} km`} /><Info label="Distance réelle" value={course.start_odometer !== null && course.end_odometer !== null ? `${(course.end_odometer - course.start_odometer).toLocaleString("fr-FR")} km` : "Non calculable"} />
      </CardContent></Card></TabsContent>

      {canFinance ? <TabsContent value="expenses"><div className="space-y-4"><div className="flex justify-end">{can("missions.expenses.manage") && course.status !== "CLOSED" && course.status !== "CANCELLED" ? <Button onClick={() => setExpenseOpen(true)}><Plus className="mr-2 size-4" />Ajouter une dépense</Button> : null}</div><ExpensesPanel expenses={detail.expenses} canConfirm={can("missions.expenses.confirm")} confirmPending={confirmExpense.isPending} cancelPending={cancelExpense.isPending} onConfirm={(id) => confirmExpense.mutate(id)} onCancel={(id) => setCancellationTarget({ kind: "expense", id })} /></div></TabsContent> : null}

      {canFinance ? <TabsContent value="finance" className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={BadgeDollarSign} label="Transport réel" value={formatAmount(financial?.quoted_amount)} /><Metric icon={Fuel} label="Dépenses réelles" value={formatAmount(financial?.actual_expenses)} /><Metric icon={Landmark} label="Résultat Course" value={financial?.gross_result === null || financial?.gross_result === undefined ? "Non disponible" : formatAmount(financial.gross_result)} /><Metric icon={ReceiptText} label="Facturé" value={formatAmount(financial?.invoiced_amount)} /><Metric icon={WalletCards} label="Encaissé" value={formatAmount(financial?.received_amount)} /><Metric icon={Landmark} label="Reste à encaisser" value={formatAmount(financial?.amount_due)} /><Metric icon={WalletCards} label="Résultat de trésorerie" value={formatAmount(financial?.cash_result)} /><Metric icon={RouteIcon} label="Coût / km" value={financial?.cost_per_km === null || financial?.cost_per_km === undefined ? "Non calculable" : formatAmount(financial.cost_per_km)} /></div><div className="flex justify-end">{can("missions.invoice") && !hasActiveInvoice && course.actual_transport_amount !== null && course.status !== "CLOSED" && course.status !== "CANCELLED" ? <Button onClick={() => setInvoiceOpen(true)}><Plus className="mr-2 size-4" />Créer la facture</Button> : null}</div><InvoicePanel invoices={detail.invoices} payments={detail.payments} course={course} clientName={detail.clientName} canIssue={can("missions.invoice")} canReceivePayments={can("missions.payments")} issuing={issueInvoice.isPending} onIssue={(id) => issueInvoice.mutate(id)} onRecordPayment={setPaymentInvoiceId} /><PaymentSummary invoices={detail.invoices} payments={detail.payments} financial={financial} /><PaymentsPanel invoices={detail.invoices} payments={detail.payments} canConfirm={can("missions.payments")} confirmPending={confirmPayment.isPending} cancelPending={cancelPayment.isPending} onConfirm={(id) => confirmPayment.mutate(id)} onCancel={(id) => setCancellationTarget({ kind: "payment", id })} /></TabsContent> : null}

      <TabsContent value="documents" className="space-y-4"><Card variant="information" className="border-primary/15"><CardContent className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-label text-primary">Documents de transport</p><p className="mt-1 text-sm text-muted-foreground">Facture, bons de mission, de sortie ou de livraison et reçus restent liés à cette Course.</p></div><ReceiptText className="size-5 text-primary" aria-hidden="true" /></CardContent></Card><EntityDocumentsTab entityId={courseId} relation="mission" /></TabsContent>
      <TabsContent value="history"><Card variant="section"><CardHeader><CardTitle>Historique audité</CardTitle><p className="text-sm text-muted-foreground">Chaque action importante reste consultable avec sa date et son contexte.</p></CardHeader><CardContent>{historyQuery.isPending ? <HistoryTimelineSkeleton /> : historyQuery.isError ? <p className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">Impossible de charger l’historique.</p> : historyQuery.data?.length ? <ol className="relative space-y-5 border-l border-primary/20 pl-5">{historyQuery.data.map((entry) => <li key={entry.id} className="relative"><span className="absolute -left-[1.65rem] top-1.5 grid size-3 place-items-center rounded-full border-2 border-surface-elevated bg-primary" aria-hidden="true" /><div className="rounded-xl border border-border/80 bg-surface/60 p-4"><p className="font-medium text-foreground">{historyLabel(entry.source_type, entry.action)}</p><p className="mt-1 text-caption">{formatDate(entry.created_at)} · {entry.performed_by ? `Utilisateur ${entry.performed_by.slice(0, 8)}` : "Utilisateur système"}</p><HistorySnapshot label="Avant" value={entry.before_value} /><HistorySnapshot label="Après" value={entry.after_value} /></div></li>)}</ol> : <Empty message="Aucun événement visible pour cette Course." />}</CardContent></Card></TabsContent>
    </Tabs>

    <Dialog open={planningOpen} onOpenChange={setPlanningOpen}><DialogContent><DialogHeader><DialogTitle>{course.status === "DRAFT" ? "Planifier la Course" : "Replanifier la Course"}</DialogTitle></DialogHeader><div className="space-y-4"><p className="text-sm text-muted-foreground">Ces informations sont des prévisions. Elles restent modifiables tant que le départ réel n’a pas été confirmé. Le véhicule et le chauffeur restent disponibles seulement si ce créneau ne chevauche aucune autre Course active.</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Départ prévu"><Input type="datetime-local" value={plannedDeparture} onChange={(event) => setPlannedDeparture(event.target.value)} /></Field><Field label="Arrivée prévue"><Input type="datetime-local" value={plannedArrival} onChange={(event) => setPlannedArrival(event.target.value)} /></Field></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPlanningOpen(false)}>Annuler</Button><Button disabled={!plannedDeparture || !plannedArrival || planningMutation.isPending} onClick={() => planningMutation.mutate({ departure: plannedDeparture, arrival: plannedArrival })}>{planningMutation.isPending ? "Enregistrement…" : course.status === "DRAFT" ? "Enregistrer et planifier" : "Enregistrer la nouvelle prévision"}</Button></div></div></DialogContent></Dialog>
    <CourseDepartureDialog course={course} open={departureOpen} onOpenChange={setDepartureOpen} />
    <CourseDeliveryDialog course={course} open={deliveryOpen} onOpenChange={setDeliveryOpen} />
    <AssignmentDialog course={course} open={assignmentOpen} onOpenChange={setAssignmentOpen} />
    <CourseActualsDialog course={course} open={actualsOpen} onOpenChange={setActualsOpen} onSuccess={refresh} />
    <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}><DialogContent><DialogHeader><DialogTitle>Ajouter une dépense</DialogTitle></DialogHeader><ExpenseForm missionId={courseId} onSuccess={() => { setExpenseOpen(false); refresh(); }} /></DialogContent></Dialog>
    <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}><DialogContent><DialogHeader><DialogTitle>Créer une facture</DialogTitle></DialogHeader><InvoiceForm missionId={courseId} defaultAmount={course.actual_transport_amount} onSuccess={() => { setInvoiceOpen(false); refresh(); }} /></DialogContent></Dialog>
    <Dialog open={paymentInvoiceId !== null} onOpenChange={(open) => { if (!open) setPaymentInvoiceId(null); }}><DialogContent><DialogHeader><DialogTitle>Enregistrer un paiement</DialogTitle></DialogHeader>{paymentInvoice ? <PaymentForm invoiceId={paymentInvoice.id} due={invoiceDue(paymentInvoice, detail.payments)} onSuccess={() => { setPaymentInvoiceId(null); refresh(); }} /> : null}</DialogContent></Dialog>
    <Dialog open={closeOpen} onOpenChange={(open) => { setCloseOpen(open); if (!open) setCloseReason(""); }}><DialogContent><DialogHeader><DialogTitle>Clôturer la Course</DialogTitle></DialogHeader><div className="space-y-4"><p className="text-sm text-muted-foreground">La Course sera marquée comme clôturée. Laissez la justification vide si les règles habituelles sont satisfaites ; renseignez-la uniquement pour une dérogation.</p><Field label="Justification de dérogation (optionnelle)"><Textarea value={closeReason} onChange={(event) => setCloseReason(event.target.value)} placeholder="Expliquez la dérogation, si applicable" /></Field><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setCloseOpen(false)}>Retour</Button><Button disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ status: "CLOSED", reason: closeReason.trim() || null }, { onSuccess: () => { setCloseOpen(false); setCloseReason(""); } })}>{statusMutation.isPending ? "Clôture…" : "Confirmer la clôture"}</Button></div></div></DialogContent></Dialog>
    <Dialog open={archiveOpen} onOpenChange={(open) => { setArchiveOpen(open); if (!open) setArchiveReason(""); }}><DialogContent><DialogHeader><DialogTitle>Annuler et archiver la Course</DialogTitle></DialogHeader><div className="space-y-4"><p className="text-sm text-muted-foreground">La Course ne sera plus active. L’annulation ne crée ni recette ni mouvement de wallet.</p><p className="text-sm text-muted-foreground">Les dépenses ou paiements déjà confirmés ne sont jamais effacés : annulez-les depuis leurs onglets afin de créer la contre-écriture nécessaire.</p><Field label="Justification"><Textarea value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} placeholder="Expliquez la raison de l’annulation" /></Field><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setArchiveOpen(false)}>Retour</Button><Button variant="destructive" disabled={archiveReason.trim().length < 3 || statusMutation.isPending} onClick={() => statusMutation.mutate({ status: "CANCELLED", reason: archiveReason.trim() }, { onSuccess: () => { setArchiveOpen(false); setArchiveReason(""); } })}>{statusMutation.isPending ? "Annulation…" : "Confirmer l’annulation"}</Button></div></div></DialogContent></Dialog>
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent><DialogHeader><DialogTitle>Supprimer la Course</DialogTitle></DialogHeader><div className="space-y-4"><p className="text-sm text-muted-foreground">Cette action est réservée aux brouillons et aux Courses planifiées sans dépense, facture, paiement ou document lié. Les autres Courses doivent être archivées.</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDeleteOpen(false)}>Annuler</Button><Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>{deleteMutation.isPending ? "Suppression…" : "Supprimer définitivement"}</Button></div></div></DialogContent></Dialog>
    <Dialog open={cancellationTarget !== null} onOpenChange={(open) => { if (!open) { setCancellationTarget(null); setCancellationReason(""); } }}><DialogContent><DialogHeader><DialogTitle>{cancellationTarget?.kind === "expense" ? "Annuler la dépense" : "Annuler le paiement"}</DialogTitle></DialogHeader><div className="space-y-4"><p className="text-sm text-muted-foreground">{cancellationTarget?.kind === "expense" ? "Une dépense validée est conservée et compensée par une contre-écriture dans le journal financier." : "Un paiement confirmé est conservé et compensé par une contre-écriture dans le journal financier."}</p><Field label="Justification"><Textarea value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} placeholder="Expliquez la correction" /></Field><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setCancellationTarget(null); setCancellationReason(""); }}>Retour</Button><Button variant="destructive" disabled={cancellationReason.trim().length < 3 || cancelExpense.isPending || cancelPayment.isPending} onClick={() => { if (!cancellationTarget) return; const onSuccess = () => { setCancellationTarget(null); setCancellationReason(""); }; if (cancellationTarget.kind === "expense") cancelExpense.mutate({ id: cancellationTarget.id, reason: cancellationReason.trim() }, { onSuccess }); else cancelPayment.mutate({ id: cancellationTarget.id, reason: cancellationReason.trim() }, { onSuccess }); }}>{cancelExpense.isPending || cancelPayment.isPending ? "Annulation…" : "Confirmer l’annulation"}</Button></div></div></DialogContent></Dialog>
  </div>;
}

function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("La date et l’heure indiquées ne sont pas valides.");
  return date.toISOString();
}

function notificationError(error: unknown) {
  // STABILISATION TRANSVERSALE (1/3) : une session morte ne doit plus
  // jamais afficher son message brut ("Unauthorized: Invalid token") via
  // findCourseActionError -- triggerSessionRecovery montre le seul message
  // correct (id sonner partagé avec __root.tsx) et lance la reprise.
  if (isSessionExpiredError(error)) {
    triggerSessionRecovery();
    return;
  }
  console.error("Course action failed", error);
  toast.error(findCourseActionError(error) ?? "L’action n’a pas pu être effectuée. Réessayez ou vérifiez vos autorisations.");
}

function findCourseActionError(error: unknown, depth = 0): string | null {
  if (depth > 2 || !error) return null;

  if (error instanceof Error && error.message.trim() && error.message !== "Failed to fetch") {
    return error.message;
  }

  if (typeof error !== "object") return null;

  for (const key of ["message", "details", "hint"] as const) {
    const value = Reflect.get(error, key);
    if (typeof value === "string" && value.trim() && value !== "Failed to fetch") return value;
  }

  for (const key of ["cause", "data", "error"] as const) {
    const nested = findCourseActionError(Reflect.get(error, key), depth + 1);
    if (nested) return nested;
  }

  return null;
}
function CourseDetailsSkeleton() { return <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8" aria-label="Chargement de la Course"><div className="h-7 w-32 animate-pulse rounded bg-muted" /><div className="h-10 w-72 animate-pulse rounded bg-muted" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">{Array.from({ length: 9 }, (_, index) => <div key={index} className="h-32 animate-pulse rounded-xl border bg-card" />)}</div><div className="h-96 animate-pulse rounded-xl border bg-card" /></div>; }

function CockpitStat({ icon: Icon, label, value, detail, tone }: { icon: LucideIcon; label: string; value: string; detail: string; tone: "info" | "success" | "warning" | "danger" }) {
  const tones = { info: "bg-info/10 text-info", success: "bg-success/10 text-success", warning: "bg-warning/15 text-warning-foreground", danger: "bg-destructive/10 text-destructive" };
  return <Card variant="glass" className="border-border/70 bg-surface/75 p-4 transition-[border-color,box-shadow,transform] transition-ui hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-sm motion-reduce:transform-none motion-reduce:transition-none"><div className="flex items-start justify-between gap-3"><p className="text-label text-muted-foreground">{label}</p><div className={`grid size-9 place-items-center rounded-xl ${tones[tone]}`}><Icon className="size-4" aria-hidden="true" /></div></div><p className="mt-5 truncate text-[clamp(1.25rem,1.8vw,1.8rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums text-foreground" title={value}>{value}</p><p className="mt-3 truncate text-caption" title={detail}>{detail}</p></Card>;
}

function CockpitIdentity({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return <div className="flex min-w-0 items-center gap-2.5"><div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-3.5" aria-hidden="true" /></div><div className="min-w-0"><p className="text-caption">{label}</p><p className="truncate text-body-sm font-medium text-foreground" title={value}>{value}</p></div></div>;
}

function Metric({ icon: Icon, label, value, tone = "primary" }: { icon: LucideIcon; label: string; value: string; tone?: "primary" | "info" | "success" | "warning" | "danger" | "neutral" }) {
  const tones = { primary: "bg-primary/10 text-primary", info: "bg-info/10 text-info", success: "bg-success/10 text-success", warning: "bg-warning/15 text-warning-foreground", danger: "bg-destructive/10 text-destructive", neutral: "bg-muted text-muted-foreground" };
  return <Card variant="kpi" className="relative overflow-hidden border-border/80 p-4 transition-[border-color,box-shadow,transform] transition-ui hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-sm motion-reduce:transform-none motion-reduce:transition-none"><div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-primary/60 via-primary/15 to-transparent" aria-hidden="true" /><div className="flex items-start justify-between gap-3"><p className="pt-1 text-label text-muted-foreground">{label}</p><div className={`grid size-9 place-items-center rounded-xl ${tones[tone]}`}><Icon className="size-4" aria-hidden="true" /></div></div><p className="mt-5 truncate text-h3 tabular-nums text-foreground" title={value}>{value}</p></Card>;
}

function PaymentSummary({ invoices, payments, financial }: { invoices: CourseInvoice[]; payments: CoursePayment[]; financial: CourseFinancialSummary | null }) {
  const invoiced = Number(financial?.invoiced_amount ?? 0);
  const received = Number(financial?.received_amount ?? 0);
  const percentage = invoiced > 0 ? Math.min(100, Math.max(0, (received / invoiced) * 100)) : 0;
  const confirmedPayments = payments.filter((payment) => payment.status === "CONFIRMED").length;
  return <Card variant="information" className="border-primary/15"><CardContent className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)] sm:items-center"><div><div className="flex items-center gap-2"><CircleDollarSign className="size-4 text-primary" aria-hidden="true" /><p className="text-label text-primary">Situation des paiements</p></div><p className="mt-2 text-body-sm text-muted-foreground">{confirmedPayments} paiement{confirmedPayments > 1 ? "s" : ""} confirmé{confirmedPayments > 1 ? "s" : ""} · {invoices.length} facture{invoices.length > 1 ? "s" : ""} liée{invoices.length > 1 ? "s" : ""}</p></div><div><div className="flex items-baseline justify-between gap-4"><p className="text-caption">Encaissement</p><p className="text-body-sm font-semibold tabular-nums text-foreground">{formatAmount(received)} / {formatAmount(invoiced)}</p></div><Progress className="mt-2 h-2.5 bg-primary/15" value={percentage} aria-label={`${Math.round(percentage)} % facturé encaissé`} /><p className="mt-2 text-caption">Reste à encaisser : <span className="font-medium text-foreground">{formatAmount(Number(financial?.amount_due ?? 0))}</span></p></div></CardContent></Card>;
}

function CourseActualsDialog({ course, open, onOpenChange, onSuccess }: { course: Course; open: boolean; onOpenChange: (open: boolean) => void; onSuccess: () => void }) {
  const [destination, setDestination] = useState(course.destination_location ?? "");
  const [cargo, setCargo] = useState(course.cargo_description ?? "");
  const [weight, setWeight] = useState(course.cargo_weight_kg === null ? "" : String(course.cargo_weight_kg));
  const [pricingMode, setPricingMode] = useState<(typeof COURSE_PRICING_MODES)[number] | "">((course.pricing_mode as (typeof COURSE_PRICING_MODES)[number] | null) ?? "");
  const [rate, setRate] = useState(course.unit_rate === null ? "" : String(course.unit_rate));
  const [flatAmount, setFlatAmount] = useState(course.pricing_mode === "FLAT" && course.actual_transport_amount !== null ? String(course.actual_transport_amount) : "");
  const [startOdometer, setStartOdometer] = useState(course.start_odometer === null ? "" : String(course.start_odometer));
  const [endOdometer, setEndOdometer] = useState(course.end_odometer === null ? "" : String(course.end_odometer));
  const [reason, setReason] = useState("");
  const isFinal = course.status === "COMPLETED" || course.status === "CLOSED";

  useEffect(() => {
    if (!open) return;
    setDestination(course.destination_location ?? ""); setCargo(course.cargo_description ?? "");
    setWeight(course.cargo_weight_kg === null ? "" : String(course.cargo_weight_kg));
    setPricingMode((course.pricing_mode as (typeof COURSE_PRICING_MODES)[number] | null) ?? "");
    setRate(course.unit_rate === null ? "" : String(course.unit_rate));
    setFlatAmount(course.pricing_mode === "FLAT" && course.actual_transport_amount !== null ? String(course.actual_transport_amount) : "");
    setStartOdometer(course.start_odometer === null ? "" : String(course.start_odometer));
    setEndOdometer(course.end_odometer === null ? "" : String(course.end_odometer)); setReason("");
  }, [course, open]);

  const actualAmount = pricingMode === "FLAT"
    ? (flatAmount === "" ? null : Number(flatAmount))
    : weight !== "" && rate !== ""
      ? pricingMode === "PER_KG" ? Number(weight) * Number(rate) : pricingMode === "PER_TONNE" ? Number(weight) / 1000 * Number(rate) : null
      : null;
  const invalidOdometers = startOdometer !== "" && endOdometer !== "" && Number(endOdometer) < Number(startOdometer);
  const mutation = useMutation({
    mutationFn: () => updateCourseActuals({ data: { missionId: course.id, actuals: {
      destination_location: destination.trim() || null, cargo_description: cargo.trim() || null,
      cargo_weight_kg: weight === "" ? null : Number(weight), pricing_mode: pricingMode || null,
      unit_rate: pricingMode === "FLAT" || rate === "" ? null : Number(rate),
      actual_transport_amount: pricingMode === "FLAT" && flatAmount !== "" ? Number(flatAmount) : null,
      start_odometer: startOdometer === "" ? null : Number(startOdometer), end_odometer: endOdometer === "" ? null : Number(endOdometer),
      reason: reason.trim() || null,
    } } }),
    onSuccess: () => { toast.success(isFinal ? "Correction enregistrée et auditée." : "Données réelles enregistrées."); onOpenChange(false); onSuccess(); },
    onError: notificationError,
  });

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{isFinal ? "Corriger les données réelles" : "Renseigner le transport réel"}</DialogTitle></DialogHeader><div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Destination"><Input value={destination} onChange={(event) => setDestination(event.target.value)} /></Field><Field label="Marchandise"><Input value={cargo} onChange={(event) => setCargo(event.target.value)} /></Field><Field label="Poids réel (kg)"><Input type="number" min="0" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="Inconnu accepté" /></Field><Field label="Tarification"><Select value={pricingMode || "NONE"} onValueChange={(value) => setPricingMode(value === "NONE" ? "" : value as (typeof COURSE_PRICING_MODES)[number])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NONE">Non renseignée</SelectItem>{COURSE_PRICING_MODES.map((mode) => <SelectItem key={mode} value={mode}>{COURSE_PRICING_MODE_LABELS[mode]}</SelectItem>)}</SelectContent></Select></Field>{pricingMode === "FLAT" ? <Field label="Forfait réel (FCFA)"><Input type="number" min="0" value={flatAmount} onChange={(event) => setFlatAmount(event.target.value)} /></Field> : pricingMode ? <Field label={pricingMode === "PER_KG" ? "Tarif par kg (FCFA)" : "Tarif par tonne (FCFA)"}><Input type="number" min="0" value={rate} onChange={(event) => setRate(event.target.value)} /></Field> : null}<Field label="Montant de transport réel"><Input readOnly value={actualAmount === null || !Number.isFinite(actualAmount) ? "Non calculable" : formatAmount(actualAmount)} /></Field><Field label="Kilométrage départ"><Input type="number" min="0" value={startOdometer} onChange={(event) => setStartOdometer(event.target.value)} /></Field><Field label="Kilométrage arrivée"><Input type="number" min="0" value={endOdometer} onChange={(event) => setEndOdometer(event.target.value)} /></Field></div>
    {isFinal ? <Field label="Justification obligatoire"><Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motif de la correction après finalisation" /></Field> : null}
    <p className="text-caption">Une donnée inconnue reste vide. Si une facture active existe, son historique financier n’est jamais modifié silencieusement.</p>
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button><Button disabled={invalidOdometers || (isFinal && reason.trim().length < 3) || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Enregistrement…" : "Enregistrer"}</Button></div>
  </div></DialogContent></Dialog>;
}

function HistoryTimelineSkeleton() { return <div className="space-y-4" aria-label="Chargement de l’historique">{Array.from({ length: 4 }, (_, index) => <div key={index} className="flex gap-3"><div className="mt-1 size-3 rounded-full bg-primary/15" /><div className="flex-1 space-y-2 rounded-xl border p-4"><div className="h-4 w-2/5 animate-pulse rounded bg-muted" /><div className="h-3 w-3/5 animate-pulse rounded bg-muted" /></div></div>)}</div>; }
function Info({ label, value }: { label: string; value: string }) { return <div><p className="text-sm font-medium">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{value}</p></div>; }
function Empty({ message }: { message: string }) { return <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">{message}</p>; }
function historyLabel(source: string, action: string) { const names: Record<string, string> = { COURSE: "Course", COURSE_EXPENSE: "Dépense", COURSE_INVOICE: "Facture", COURSE_PAYMENT: "Paiement" }; const actions: Record<string, string> = { CREATE: "créé", UPDATE: "mis à jour", CLOSE: "clôturé", CANCEL: source === "COURSE" ? "archivé" : "annulé", DELIVERY: "livraison confirmée", CORRECT: "livraison remise en cours", DELIVERY_CORRECTION: "livraison remise en cours", DELETE: "supprimé", ARCHIVE: "archivé", RESTORE: "restauré", REPLACE: "remplacé" }; return `${names[source] ?? source} ${actions[action] ?? action}`; }
function HistorySnapshot({ label, value }: { label: string; value: CourseHistoryEntry["before_value"] }) { const summary = historyValueSummary(value); return summary ? <p className="mt-2 text-sm text-muted-foreground"><span className="font-medium text-foreground">{label} :</span> {summary}</p> : null; }
function historyValueSummary(value: CourseHistoryEntry["before_value"]): string | null { if (!value || typeof value !== "object" || Array.isArray(value)) return null; const labels: Record<string, string> = { status: "Statut", amount: "Montant", total_amount: "Total", mission_number: "Course", invoice_number: "Facture", category: "Catégorie" }; const details = Object.entries(value).flatMap(([key, raw]) => { if (!(key in labels) || (typeof raw !== "string" && typeof raw !== "number")) return []; return [`${labels[key]} : ${typeof raw === "number" ? formatAmount(raw) : raw}`]; }); return details.length ? details.join(" · ") : "Modification enregistrée dans l’audit"; }

function ExpensesPanel({ expenses, canConfirm, confirmPending, cancelPending, onConfirm, onCancel }: { expenses: CourseExpenseWithWallet[]; canConfirm: boolean; confirmPending: boolean; cancelPending: boolean; onConfirm: (id: string) => void; onCancel: (id: string) => void }) {
  if (!expenses.length) return <Empty message="Aucune dépense n’est enregistrée. Une dépense n’impacte le wallet qu’après validation." />;
  // CORRECTIF COURSES (wallet) : nom réel (getCourse le joint désormais en
  // base, un seul lookup batch) -- l'identifiant tronqué ne reste qu'un
  // repli pour le cas résiduel où le wallet aurait été supprimé depuis.
  return <div className="grid gap-3">{expenses.map((expense) => <Card key={expense.id} variant="compact" className="border-border/80 p-4 transition-[border-color,box-shadow] transition-ui hover:border-primary/25 hover:shadow-sm"><CardContent className="flex flex-col gap-4 p-0 lg:flex-row lg:items-center lg:justify-between"><div className="flex min-w-0 items-start gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-warning/15 text-warning-foreground"><Fuel className="size-4" aria-hidden="true" /></div><div className="min-w-0"><p className="font-semibold text-foreground">{COURSE_EXPENSE_CATEGORY_LABELS[expense.category as keyof typeof COURSE_EXPENSE_CATEGORY_LABELS] ?? expense.category}</p><p className="mt-1 text-caption">{formatDate(expense.expense_date)} · {expense.walletName ?? `Wallet ${expense.wallet_id.slice(0, 8)}`} · {expense.description ?? "Sans description"}</p></div></div><div className="flex flex-wrap items-center gap-2 lg:justify-end"><p className="mr-auto text-body-sm font-semibold tabular-nums text-foreground lg:mr-2">{formatAmount(expense.amount)}</p><Badge variant={statusVariant(expense.status)} appearance="soft">{expense.status === "PAID" ? "Validée" : expense.status === "ENGAGED" ? "Engagée" : expense.status === "CANCELLED" ? "Annulée" : "Prévue"}</Badge>{canConfirm && expense.status !== "PAID" && expense.status !== "CANCELLED" ? <Button size="sm" onClick={() => onConfirm(expense.id)} disabled={confirmPending}>Valider</Button> : null}{canConfirm && expense.status !== "CANCELLED" ? <Button size="sm" variant="outline" onClick={() => onCancel(expense.id)} disabled={cancelPending}>Annuler</Button> : null}</div></CardContent></Card>)}</div>;
}

function InvoicePanel({ invoices, payments, course, clientName, canIssue, canReceivePayments, issuing, onIssue, onRecordPayment }: { invoices: CourseInvoice[]; payments: CoursePayment[]; course: Pick<Course, "mission_number" | "departure_location" | "destination_location">; clientName: string | null; canIssue: boolean; canReceivePayments: boolean; issuing: boolean; onIssue: (id: string) => void; onRecordPayment: (id: string) => void }) {
  const { can } = usePermissions();
  const [jekoInvoiceId, setJekoInvoiceId] = useState<string | null>(null);
  const jekoInvoice = invoices.find((invoice) => invoice.id === jekoInvoiceId) ?? null;

  if (!invoices.length) return <Empty message="Aucune facture n’est créée. Une Course possède une facture active ; une facture annulée reste consultable dans son historique." />;

  return <>
    <div className="space-y-4">
      {invoices.map((invoice) => {
        const amountDue = invoiceDue(invoice, payments);
        const canRequestJekoPayment = canReceivePayments
          && ["ISSUED", "PARTIALLY_PAID"].includes(invoice.status)
          && amountDue > 0;

        return <Card key={invoice.id}>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>{invoice.invoice_number}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{invoiceLabel(invoice.status)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canIssue && invoice.status === "DRAFT" ? <Button onClick={() => onIssue(invoice.id)} disabled={issuing}>Émettre</Button> : null}
              {canRequestJekoPayment ? <Button variant="outline" onClick={() => setJekoInvoiceId(invoice.id)}>Payer avec Jèko</Button> : null}
              {canRequestJekoPayment ? <Button variant="outline" onClick={() => onRecordPayment(invoice.id)}>Paiement manuel</Button> : null}
            </div>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-overline text-primary">Prévisualisation</p>
              <p className="mt-3 font-semibold">Facture {invoice.invoice_number}</p>
              <p className="mt-1 text-sm text-muted-foreground">Client : {clientName ?? "Non accessible"}</p>
              <p className="text-sm text-muted-foreground">Course : {course.mission_number}</p>
              <p className="text-sm text-muted-foreground">{[course.departure_location, course.destination_location].filter(Boolean).join(" → ")}</p>
            </div>
            <dl className="space-y-3 text-sm">
              <Summary label="Montant HT" value={formatAmount(invoice.subtotal_amount)} />
              <Summary label="TVA" value={`${invoice.tax_rate.toLocaleString("fr-FR")} % · ${formatAmount(invoice.tax_amount)}`} />
              <Summary label="Total" value={formatAmount(invoice.total_amount)} />
              <Summary label="Reste à encaisser" value={formatAmount(amountDue)} />
              <Summary label="Émission" value={formatDate(invoice.issue_date)} />
            </dl>
          </CardContent>
        </Card>;
      })}
    </div>
    <JekoCourseCheckoutDialog
      invoice={jekoInvoice ? { id: jekoInvoice.id, invoice_number: jekoInvoice.invoice_number } : null}
      dueAmount={jekoInvoice ? invoiceDue(jekoInvoice, payments) : 0}
      open={jekoInvoiceId !== null}
      onOpenChange={(open) => { if (!open) setJekoInvoiceId(null); }}
      canManageSettings={can("settings.manage")}
    />
  </>;
}

function PaymentsPanel({ invoices, payments, canConfirm, confirmPending, cancelPending, onConfirm, onCancel }: { invoices: CourseInvoice[]; payments: CoursePayment[]; canConfirm: boolean; confirmPending: boolean; cancelPending: boolean; onConfirm: (id: string) => void; onCancel: (id: string) => void }) {
  const invoiceNumbers = new Map(invoices.map((invoice) => [invoice.id, invoice.invoice_number]));
  if (!payments.length) return <Empty message="Aucun paiement n’est reçu. Un paiement confirmé crédite le wallet sélectionné." />;
  return <Card variant="section"><CardContent className="p-5"><ol className="relative space-y-5 border-l border-primary/20 pl-5">{payments.map((payment) => <li key={payment.id} className="relative"><span className="absolute -left-[1.65rem] top-2 grid size-3 place-items-center rounded-full border-2 border-surface-elevated bg-primary" aria-hidden="true" /><div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface/60 p-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="font-semibold text-foreground">{formatAmount(payment.amount)} · {payment.payment_kind === "ADVANCE" ? "Acompte" : payment.payment_kind === "SETTLEMENT" ? "Règlement" : "Paiement"}</p><p className="mt-1 text-caption">{invoiceNumbers.get(payment.invoice_id) ?? "Facture non accessible"} · {formatDate(payment.payment_date)} · {payment.reference ?? "Sans référence"}</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant={statusVariant(payment.status)} appearance="soft">{payment.status === "CONFIRMED" ? "Confirmé" : payment.status === "RECEIVED" ? "Reçu" : payment.status === "CANCELLED" ? "Annulé" : "Prévu"}</Badge>{canConfirm && payment.status !== "CONFIRMED" && payment.status !== "CANCELLED" ? <Button size="sm" disabled={confirmPending} onClick={() => onConfirm(payment.id)}>Confirmer</Button> : null}{canConfirm && payment.status !== "CANCELLED" ? <Button size="sm" variant="outline" disabled={cancelPending} onClick={() => onCancel(payment.id)}>Annuler</Button> : null}</div></div></li>)}</ol></CardContent></Card>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="flex items-baseline justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>; }

function ExpenseForm({ missionId, onSuccess }: { missionId: string; onSuccess: () => void }) {
  const [walletId, setWalletId] = useState(""); const [category, setCategory] = useState<(typeof COURSE_EXPENSE_CATEGORIES)[number]>("FUEL"); const [amount, setAmount] = useState(""); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [description, setDescription] = useState("");
  const mutation = useMutation({ mutationFn: () => createCourseExpense({ data: { missionId, expense: { wallet_id: walletId, category, amount: Number(amount), expense_date: date, status: "ENGAGED", description: description.trim() || null, receipt_document_id: null } } }), onSuccess: () => { toast.success("Dépense ajoutée. Validez-la pour créer le mouvement financier."); onSuccess(); }, onError: notificationError });
  return <div className="space-y-4"><div className="space-y-2"><Label>Wallet</Label><WalletSelect value={walletId} onValueChange={setWalletId} /></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Catégorie"><Select value={category} onValueChange={(value) => setCategory(value as (typeof COURSE_EXPENSE_CATEGORIES)[number])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{COURSE_EXPENSE_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{COURSE_EXPENSE_CATEGORY_LABELS[item]}</SelectItem>)}</SelectContent></Select></Field><Field label="Montant (FCFA)"><Input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="Date"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field></div><Field label="Description"><Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Button className="w-full" disabled={!walletId || Number(amount) <= 0 || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Ajout…" : "Ajouter la dépense"}</Button></div>;
}

function InvoiceForm({ missionId, defaultAmount, onSuccess }: { missionId: string; defaultAmount: number | null; onSuccess: () => void }) {
  const [amount, setAmount] = useState(defaultAmount === null ? "" : String(defaultAmount)); const [rate, setRate] = useState(""); const [dueDate, setDueDate] = useState(""); const [notes, setNotes] = useState("");
  const mutation = useMutation({ mutationFn: () => createCourseInvoice({ data: { missionId, invoice: { subtotal_amount: amount ? Number(amount) : null, tax_rate: rate ? Number(rate) : null, due_date: dueDate || null, notes: notes.trim() || null } } }), onSuccess: () => { toast.success("Facture créée en brouillon."); onSuccess(); }, onError: notificationError });
  return <div className="space-y-4"><p className="text-sm text-muted-foreground">La facture reprend le montant de transport réel confirmé. La TVA est appliquée uniquement si elle est activée dans les paramètres de l’entreprise.</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Montant HT (FCFA)"><Input type="number" min="0" value={amount} readOnly /></Field><Field label="TVA (%)"><Input type="number" min="0" max="100" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="Paramètre par défaut" /></Field><Field label="Échéance"><Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field></div><Field label="Notes"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field><Button className="w-full" disabled={amount === "" || Number(amount) < 0 || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Création…" : "Créer la facture"}</Button></div>;
}

function PaymentForm({ invoiceId, due, onSuccess }: { invoiceId: string; due: number; onSuccess: () => void }) {
  const [walletId, setWalletId] = useState(""); const [amount, setAmount] = useState(String(due)); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [kind, setKind] = useState<(typeof COURSE_PAYMENT_KINDS)[number]>("PAYMENT"); const [reference, setReference] = useState("");
  const mutation = useMutation({ mutationFn: () => createCoursePayment({ data: { invoiceId, payment: { wallet_id: walletId, amount: Number(amount), payment_date: date, payment_kind: kind, reference: reference.trim() || null, notes: null } } }), onSuccess: () => { toast.success("Paiement enregistré. Confirmez-le pour créditer le wallet."); onSuccess(); }, onError: notificationError });
  return <div className="space-y-4"><p className="rounded-lg bg-muted p-3 text-sm">Reste à encaisser : <strong>{formatAmount(due)}</strong>. Le surpaiement est bloqué côté serveur.</p><div className="space-y-2"><Label>Wallet</Label><WalletSelect value={walletId} onValueChange={setWalletId} /></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Montant (FCFA)"><Input type="number" min="1" max={due} value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="Date"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Type"><Select value={kind} onValueChange={(value) => setKind(value as (typeof COURSE_PAYMENT_KINDS)[number])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ADVANCE">Acompte</SelectItem><SelectItem value="PAYMENT">Paiement partiel</SelectItem><SelectItem value="SETTLEMENT">Règlement</SelectItem></SelectContent></Select></Field><Field label="Référence"><Input value={reference} onChange={(event) => setReference(event.target.value)} /></Field></div><Button className="w-full" disabled={!walletId || Number(amount) <= 0 || Number(amount) > due || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Enregistrement…" : "Enregistrer le paiement"}</Button></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block space-y-2"><span className="text-sm font-medium leading-none">{label}</span>{children}</label>; }
