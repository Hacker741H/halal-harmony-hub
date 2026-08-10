import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  PackageCheck,
  Route as RouteIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { getDocumentsForRelation } from "@/lib/documents.functions";
import {
  assignCourse,
  confirmCourseDelivery,
  confirmCourseDeparture,
  correctCourseDelivery,
  COURSE_DELIVERY_STATUS_LABELS,
  COURSE_DELIVERY_STATUSES,
  COURSE_STATUS_LABELS,
  getCourseDepartureReadiness,
  getCourses,
  type Course,
  type CourseListItem,
} from "@/lib/courses.functions";
import { usePermissions } from "@/hooks/use-permissions";
import { DriverSelect, VehicleSelect } from "@/components/selects/entity-selects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

export type OperationalWorkspaceKind = "planning" | "assignments" | "departures" | "deliveries";

type WorkspaceConfig = {
  title: string;
  description: string;
  eyebrow: string;
  icon: LucideIcon;
  readPermission: string;
};

const WORKSPACE_CONFIG: Record<OperationalWorkspaceKind, WorkspaceConfig> = {
  planning: {
    title: "Planning",
    description: "Visualisez les Courses prévues, leurs itinéraires et leurs affectations sur la période sélectionnée.",
    eyebrow: "Exploitation · Planification",
    icon: CalendarDays,
    readPermission: "planning.read",
  },
  assignments: {
    title: "Affectations",
    description: "Affectez un véhicule et un chauffeur aux Courses planifiées, avec contrôle des conflits de créneau.",
    eyebrow: "Exploitation · Affectations",
    icon: ClipboardCheck,
    readPermission: "assignments.read",
  },
  departures: {
    title: "Départs",
    description: "Contrôlez les prérequis opérationnels avant d’autoriser une Course à partir.",
    eyebrow: "Exploitation · Départs",
    icon: RouteIcon,
    readPermission: "departures.read",
  },
  deliveries: {
    title: "Livraisons",
    description: "Confirmez l’arrivée, la preuve de livraison et les réserves sans dupliquer les données de la Course.",
    eyebrow: "Exploitation · Livraisons",
    icon: PackageCheck,
    readPermission: "deliveries.read",
  },
};

function formatDateTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "Non renseignée";
}

function toDateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function statusVariant(status: string): "outline" | "info" | "warning" | "success" | "danger" {
  if (["COMPLETED", "CLOSED"].includes(status)) return "success";
  if (status === "IN_PROGRESS") return "info";
  if (status === "PLANNED") return "warning";
  if (status === "CANCELLED") return "outline";
  return "outline";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Une erreur inattendue est survenue.";
}

export function OperationalCourseWorkspace({ kind }: { kind: OperationalWorkspaceKind }) {
  const config = WORKSPACE_CONFIG[kind];
  const Icon = config.icon;
  const { can } = usePermissions();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [status, setStatus] = useState("ALL");
  const [planningView, setPlanningView] = useState<"day" | "week" | "list">("week");

  const coursesQuery = useQuery({
    queryKey: ["transport-operations", kind, { from, to, vehicleId, driverId }],
    queryFn: () => getCourses({
      data: {
        page: 1,
        pageSize: 100,
        search: "",
        status: kind === "assignments" || kind === "departures" ? "PLANNED" : null,
        clientId: null,
        driverId: driverId || null,
        vehicleId: vehicleId || null,
        from: from || null,
        to: to || null,
        operationScope: kind,
      },
    }),
    enabled: can(config.readPermission),
  });

  const courses = useMemo(() => {
    const rows = coursesQuery.data?.courses ?? [];
    const workspaceRows = kind === "deliveries"
      ? rows.filter((course) => ["IN_PROGRESS", "COMPLETED"].includes(course.status))
      : rows;
    return status === "ALL" ? workspaceRows : workspaceRows.filter((course) => course.status === status);
  }, [coursesQuery.data?.courses, kind, status]);

  if (!can(config.readPermission)) {
    return <div className="mx-auto max-w-(--ds-content-max-width) p-4 sm:p-6 xl:p-8"><Card variant="information"><CardContent className="p-6 text-sm text-muted-foreground">Vous n’avez pas la permission de consulter cet espace opérationnel.</CardContent></Card></div>;
  }

  return <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
    <section className="relative isolate overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-surface-elevated to-surface px-5 py-6 shadow-md sm:px-7 sm:py-7">
      <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-primary/15 blur-3xl" aria-hidden="true" />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-overline text-primary">{config.eyebrow}</p>
          <h1 className="mt-2 flex items-center gap-3 text-h1"><Icon className="size-7 text-primary" aria-hidden="true" />{config.title}</h1>
          <p className="mt-3 text-body-sm leading-6 text-muted-foreground sm:text-base">{config.description}</p>
        </div>
        <div className="rounded-xl border border-border/70 bg-surface/80 px-4 py-3 text-sm shadow-xs">
          <p className="text-caption text-muted-foreground">Courses visibles</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{coursesQuery.isPending ? "—" : courses.length}</p>
        </div>
      </div>
    </section>

    <Card variant="section">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-1"><Label className="text-caption">Du</Label><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
          <div className="space-y-1"><Label className="text-caption">Au</Label><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
          <div className="space-y-1"><Label className="text-caption">Véhicule</Label><VehicleSelect value={vehicleId} onValueChange={setVehicleId} placeholder="Tous les véhicules" /></div>
          <div className="space-y-1"><Label className="text-caption">Chauffeur</Label><DriverSelect value={driverId} onValueChange={setDriverId} placeholder="Tous les chauffeurs" /></div>
          <div className="space-y-1"><Label className="text-caption">Statut</Label><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Tous les statuts</SelectItem><SelectItem value="PLANNED">Planifiées</SelectItem><SelectItem value="IN_PROGRESS">En cours</SelectItem><SelectItem value="COMPLETED">Terminées</SelectItem></SelectContent></Select></div>
        </div>
        {kind === "planning" ? <div className="flex flex-wrap gap-2"><Button size="sm" variant={planningView === "day" ? "default" : "outline"} onClick={() => setPlanningView("day")}>Jour</Button><Button size="sm" variant={planningView === "week" ? "default" : "outline"} onClick={() => setPlanningView("week")}>Semaine</Button><Button size="sm" variant={planningView === "list" ? "default" : "outline"} onClick={() => setPlanningView("list")}>Liste chronologique</Button></div> : null}
      </CardContent>
    </Card>

    {coursesQuery.isPending ? <CourseWorkspaceSkeleton /> : coursesQuery.isError ? <Card variant="information"><CardContent className="flex flex-col gap-3 p-6 text-sm"><p className="text-destructive">Impossible de charger les Courses opérationnelles.</p><Button className="w-fit" variant="outline" onClick={() => void coursesQuery.refetch()}>Réessayer</Button></CardContent></Card> : courses.length === 0 ? <Card className="border-dashed"><CardContent className="p-8 text-center text-sm text-muted-foreground">Aucune Course ne correspond aux filtres sélectionnés.</CardContent></Card> : kind === "planning" ? <PlanningBoard courses={courses} view={planningView} selectedDay={from || new Date().toISOString().slice(0, 10)} /> : <div className="grid gap-4 xl:grid-cols-2">{courses.map((course) => <OperationalCourseCard key={course.id} course={course} kind={kind} />)}</div>}
  </div>;
}

function PlanningBoard({ courses, view, selectedDay }: { courses: CourseListItem[]; view: "day" | "week" | "list"; selectedDay: string }) {
  const orderedCourses = [...courses].sort((left, right) => (left.planned_departure_at ?? "").localeCompare(right.planned_departure_at ?? ""));
  if (view === "list") return <div className="space-y-3">{orderedCourses.map((course) => <PlanningCourseCard key={course.id} course={course} />)}</div>;

  if (view === "day") {
    const dayCourses = orderedCourses.filter((course) => toDateInput(course.planned_departure_at) === selectedDay);
    return <Card variant="section"><CardHeader><CardTitle>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "full" }).format(new Date(`${selectedDay}T12:00:00`))}</CardTitle></CardHeader><CardContent className="space-y-3">{dayCourses.length ? dayCourses.map((course) => <PlanningCourseCard key={course.id} course={course} />) : <p className="text-sm text-muted-foreground">Aucune Course planifiée ce jour.</p>}</CardContent></Card>;
  }

  const start = new Date(`${selectedDay}T12:00:00`);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
  return <div className="grid gap-3 md:grid-cols-7">{days.map((day) => {
    const key = day.toISOString().slice(0, 10);
    const entries = orderedCourses.filter((course) => toDateInput(course.planned_departure_at) === key);
    return <Card key={key} variant="compact" className="min-h-44"><CardHeader className="p-3"><CardTitle className="text-sm">{new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric" }).format(day)}</CardTitle></CardHeader><CardContent className="space-y-2 p-3 pt-0">{entries.length ? entries.map((course) => <Link key={course.id} to="/courses/$courseId" params={{ courseId: course.id }} className="block rounded-lg border border-border/70 bg-surface px-2.5 py-2 text-xs transition-ui hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><p className="font-semibold">{course.mission_number}</p><p className="mt-1 truncate text-muted-foreground">{course.clientName ?? "Client"}</p><p className="mt-1 truncate text-muted-foreground">{[course.departure_location, course.destination_location].filter(Boolean).join(" → ") || "Itinéraire à préciser"}</p></Link>) : <p className="pt-2 text-xs text-muted-foreground">Libre</p>}</CardContent></Card>;
  })}</div>;
}

function PlanningCourseCard({ course }: { course: CourseListItem }) {
  return <Link to="/courses/$courseId" params={{ courseId: course.id }} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Card variant="section" className="transition-ui hover:border-primary/35 hover:shadow-sm"><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{course.mission_number}</p><Badge variant={statusVariant(course.status)} appearance="soft">{COURSE_STATUS_LABELS[course.status as keyof typeof COURSE_STATUS_LABELS]}</Badge>{course.overlap_exception_reason ? <Badge variant="warning" appearance="soft" title={course.overlap_exception_reason}>Dérogation planning</Badge> : null}</div><p className="mt-1 text-sm text-muted-foreground">{course.clientName ?? "Client non renseigné"} · {[course.departure_location, course.destination_location].filter(Boolean).join(" → ") || "Itinéraire à préciser"}</p></div><div className="grid gap-1 text-sm text-muted-foreground sm:text-right"><span>{formatDateTime(course.planned_departure_at)}</span><span>{course.vehicleLabel ?? "Véhicule non affecté"} · {course.driverName ?? "Chauffeur non affecté"}</span></div></CardContent></Card></Link>;
}

function OperationalCourseCard({ course, kind }: { course: CourseListItem; kind: Exclude<OperationalWorkspaceKind, "planning"> }) {
  const { can } = usePermissions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const actionLabel = kind === "assignments" ? "Affecter" : kind === "departures" ? "Autoriser le départ" : "Confirmer la livraison";
  const canAct = kind === "assignments"
    ? can("assignments.manage")
    : kind === "departures"
      ? can("departures.confirm")
      : can("deliveries.confirm") && course.status === "IN_PROGRESS";

  return <Card variant="section" className="overflow-hidden"><CardContent className="space-y-4 p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link to="/courses/$courseId" params={{ courseId: course.id }} className="font-semibold hover:underline">{course.mission_number}</Link><Badge variant={statusVariant(course.status)} appearance="soft">{COURSE_STATUS_LABELS[course.status as keyof typeof COURSE_STATUS_LABELS]}</Badge>{course.delivery_status ? <Badge variant={course.delivery_status === "INCIDENT" ? "danger" : "success"} appearance="soft">{COURSE_DELIVERY_STATUS_LABELS[course.delivery_status as keyof typeof COURSE_DELIVERY_STATUS_LABELS]}</Badge> : null}{course.overlap_exception_reason ? <Badge variant="warning" appearance="soft" title={course.overlap_exception_reason}>Dérogation planning</Badge> : null}</div><p className="mt-1 text-sm text-muted-foreground">{course.clientName ?? "Client non renseigné"}</p></div><p className="shrink-0 text-caption text-muted-foreground">{formatDateTime(course.planned_departure_at)}</p></div><div className="grid gap-2 rounded-xl border border-border/70 bg-surface-elevated/45 p-3 text-sm sm:grid-cols-2"><Info label="Itinéraire" value={[course.departure_location, course.destination_location].filter(Boolean).join(" → ") || "À préciser"} /><Info label="Véhicule" value={course.vehicleLabel ?? "Non affecté"} /><Info label="Chauffeur" value={course.driverName ?? "Non affecté"} /><Info label="État opérationnel" value={`${course.vehicleStatus ?? "Véhicule inconnu"} · ${course.driverStatus ?? "Chauffeur inconnu"}`} /></div><div className="flex flex-wrap justify-end gap-2"><Button asChild size="sm" variant="outline"><Link to="/courses/$courseId" params={{ courseId: course.id }}>Ouvrir la Course</Link></Button>{canAct ? <Button size="sm" onClick={() => setDialogOpen(true)}>{actionLabel}</Button> : null}{kind === "deliveries" && course.delivery_status && can("deliveries.correct") ? <Button size="sm" variant="outline" onClick={() => setCorrectionOpen(true)}>Annuler la confirmation</Button> : null}</div></CardContent><OperationDialog course={course} kind={kind} open={dialogOpen} onOpenChange={setDialogOpen} /><DeliveryCorrectionDialog course={course} open={correctionOpen} onOpenChange={setCorrectionOpen} /></Card>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-caption text-muted-foreground">{label}</p><p className="mt-1 truncate font-medium" title={value}>{value}</p></div>;
}

function OperationDialog({ course, kind, open, onOpenChange }: { course: CourseListItem; kind: Exclude<OperationalWorkspaceKind, "planning">; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (kind === "assignments") return <AssignmentDialog course={course} open={open} onOpenChange={onOpenChange} />;
  if (kind === "departures") return <CourseDepartureDialog course={course} open={open} onOpenChange={onOpenChange} />;
  return <CourseDeliveryDialog course={course} open={open} onOpenChange={onOpenChange} />;
}

function AssignmentDialog({ course, open, onOpenChange }: { course: CourseListItem; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [vehicleId, setVehicleId] = useState(course.vehicle_id ?? "");
  const [driverId, setDriverId] = useState(course.driver_id ?? "");
  const [overrideReason, setOverrideReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => assignCourse({ data: { missionId: course.id, assignment: { vehicle_id: vehicleId, driver_id: driverId, override_reason: overrideReason.trim() || null } } }),
    onSuccess: () => { toast.success("Affectation enregistrée."); void queryClient.invalidateQueries({ queryKey: ["transport-operations"] }); void queryClient.invalidateQueries({ queryKey: ["course", course.id] }); onOpenChange(false); },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Affecter la Course {course.mission_number}</DialogTitle><DialogDescription>Les conflits de véhicule et de chauffeur sont contrôlés par la base lors de l’enregistrement.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><div className="space-y-2"><Label>Véhicule</Label><VehicleSelect value={vehicleId} onValueChange={setVehicleId} placeholder="Sélectionner un véhicule" /></div><div className="space-y-2"><Label>Chauffeur</Label><DriverSelect value={driverId} onValueChange={setDriverId} placeholder="Sélectionner un chauffeur" /></div>{can("missions.override") ? <div className="space-y-2"><Label>Justification de dérogation <span className="font-normal text-muted-foreground">(uniquement en cas de conflit)</span></Label><Textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Justifiez une dérogation administrateur…" /></div> : null}</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button><Button disabled={!vehicleId || !driverId || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Enregistrement…" : "Enregistrer l’affectation"}</Button></DialogFooter></DialogContent></Dialog>;
}

type CourseOperationTarget = Pick<Course, "id" | "mission_number" | "start_odometer">;

export function CourseDepartureDialog({ course, open, onOpenChange }: { course: CourseOperationTarget; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [startedAt, setStartedAt] = useState(toDateTimeLocal(new Date().toISOString()));
  const [startOdometer, setStartOdometer] = useState("");
  const readinessQuery = useQuery({ queryKey: ["course-departure-readiness", course.id], queryFn: () => getCourseDepartureReadiness({ data: course.id }), enabled: open });
  const mutation = useMutation({
    mutationFn: () => confirmCourseDeparture({ data: { missionId: course.id, departure: { actual_departure_at: startedAt ? new Date(startedAt).toISOString() : null, start_odometer: Number(startOdometer) } } }),
    onSuccess: () => { toast.success("Départ confirmé. La Course est en cours."); void queryClient.invalidateQueries({ queryKey: ["transport-operations"] }); void queryClient.invalidateQueries({ queryKey: ["course", course.id] }); onOpenChange(false); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const blockingIssue = readinessQuery.data?.find((item) => item.is_blocking && !item.is_ready) ?? null;

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Autoriser le départ · {course.mission_number}</DialogTitle><DialogDescription>La base effectue un dernier contrôle transactionnel au moment de la confirmation.</DialogDescription></DialogHeader><div className="space-y-4 py-2"><DepartureChecklist loading={readinessQuery.isPending} checks={readinessQuery.data ?? []} /><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Date et heure réelles</Label><Input type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></div><div className="space-y-2"><Label>Kilométrage de départ</Label><Input type="number" min="0" value={startOdometer} onChange={(event) => setStartOdometer(event.target.value)} placeholder="Ex. 125000" /></div></div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button><Button disabled={readinessQuery.isPending || Boolean(blockingIssue) || !startOdometer || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Confirmation…" : "Confirmer le départ"}</Button></DialogFooter>{blockingIssue ? <p className="text-sm text-destructive">{blockingIssue.detail}</p> : null}</DialogContent></Dialog>;
}

function DepartureChecklist({ loading, checks }: { loading: boolean; checks: Array<{ check_code: string; label: string; is_ready: boolean; is_blocking: boolean; detail: string }> }) {
  if (loading) return <div className="space-y-2">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)}</div>;
  return <div className="rounded-xl border border-border/70 p-3"><p className="mb-2 text-label">Checklist de départ</p><div className="space-y-2">{checks.map((check) => <div key={check.check_code} className="flex items-start gap-2 text-sm"><span className={check.is_ready ? "text-success" : check.is_blocking ? "text-destructive" : "text-warning-foreground"}>{check.is_ready ? <CheckCircle2 className="mt-0.5 size-4" aria-label="Prérequis validé" /> : <AlertTriangle className="mt-0.5 size-4" aria-label={check.is_blocking ? "Prérequis bloquant" : "Information"} />}</span><div><p className="font-medium">{check.label}</p><p className="text-caption text-muted-foreground">{check.detail}</p></div></div>)}</div></div>;
}

export function CourseDeliveryDialog({ course, open, onOpenChange }: { course: CourseOperationTarget; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [deliveryStatus, setDeliveryStatus] = useState<(typeof COURSE_DELIVERY_STATUSES)[number]>("DELIVERED");
  const [arrivedAt, setArrivedAt] = useState(toDateTimeLocal(new Date().toISOString()));
  const [endOdometer, setEndOdometer] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [notes, setNotes] = useState("");
  const [reservations, setReservations] = useState("");
  const [documentId, setDocumentId] = useState("NONE");
  const documentsQuery = useQuery({ queryKey: ["entity-documents", "mission", course.id], queryFn: () => getDocumentsForRelation({ data: { entity_id: course.id, relation: "mission" } }), enabled: open });
  const mutation = useMutation({
    mutationFn: () => confirmCourseDelivery({ data: { missionId: course.id, delivery: { delivery_status: deliveryStatus, actual_arrival_at: deliveryStatus === "INCIDENT" ? null : arrivedAt ? new Date(arrivedAt).toISOString() : null, end_odometer: deliveryStatus === "INCIDENT" || !endOdometer ? null : Number(endOdometer), recipient_name: recipientName.trim() || null, notes: notes.trim() || null, reservations: reservations.trim() || null, delivery_document_id: documentId === "NONE" ? null : documentId } } }),
    onSuccess: () => { toast.success(deliveryStatus === "INCIDENT" ? "Incident enregistré." : "Livraison confirmée."); void queryClient.invalidateQueries({ queryKey: ["transport-operations"] }); void queryClient.invalidateQueries({ queryKey: ["course", course.id] }); onOpenChange(false); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const requiresArrival = deliveryStatus !== "INCIDENT";

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto"><DialogHeader><DialogTitle>Confirmer la livraison · {course.mission_number}</DialogTitle><DialogDescription>La Course terminée devient disponible pour la facturation et la finalisation existantes.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><div className="space-y-2"><Label>Statut de livraison</Label><Select value={deliveryStatus} onValueChange={(value) => setDeliveryStatus(value as (typeof COURSE_DELIVERY_STATUSES)[number])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{COURSE_DELIVERY_STATUSES.map((status) => <SelectItem key={status} value={status}>{COURSE_DELIVERY_STATUS_LABELS[status]}</SelectItem>)}</SelectContent></Select></div>{requiresArrival ? <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Date et heure réelles d’arrivée</Label><Input type="datetime-local" value={arrivedAt} onChange={(event) => setArrivedAt(event.target.value)} /></div><div className="space-y-2"><Label>Kilométrage d’arrivée</Label><Input type="number" min={course.start_odometer ?? 0} value={endOdometer} onChange={(event) => setEndOdometer(event.target.value)} placeholder="Ex. 125450" /></div></div> : null}<div className="space-y-2"><Label>Réceptionnaire</Label><Input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="Nom de la personne ayant réceptionné" /></div><div className="space-y-2"><Label>Preuve de livraison <span className="font-normal text-muted-foreground">(optionnelle)</span></Label><Select value={documentId} onValueChange={setDocumentId}><SelectTrigger><SelectValue placeholder="Choisir un document lié" /></SelectTrigger><SelectContent><SelectItem value="NONE">Aucune preuve liée</SelectItem>{(documentsQuery.data ?? []).map((document) => <SelectItem key={document.id} value={document.id}>{document.nom}</SelectItem>)}</SelectContent></Select><p className="text-caption text-muted-foreground">Ajoutez d’abord le document dans l’onglet Documents de la Course ; les documents privés existants sont réutilisés.</p></div><div className="space-y-2"><Label>Observations</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Informations utiles sur la livraison…" /></div><div className="space-y-2"><Label>Réserves éventuelles</Label><Textarea value={reservations} onChange={(event) => setReservations(event.target.value)} placeholder="Réserves émises à la réception…" /></div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button><Button disabled={(requiresArrival && (!arrivedAt || !endOdometer)) || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Confirmation…" : deliveryStatus === "INCIDENT" ? "Enregistrer l’incident" : "Confirmer la livraison"}</Button></DialogFooter></DialogContent></Dialog>;
}

function DeliveryCorrectionDialog({ course, open, onOpenChange }: { course: CourseListItem; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => correctCourseDelivery({ data: { missionId: course.id, reason } }),
    onSuccess: () => { toast.success("Confirmation de livraison annulée et historisée."); void queryClient.invalidateQueries({ queryKey: ["transport-operations"] }); void queryClient.invalidateQueries({ queryKey: ["course", course.id] }); onOpenChange(false); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Annuler la confirmation</DialogTitle><DialogDescription>La Course reviendra en cours. L’action et sa justification resteront visibles dans l’historique.</DialogDescription></DialogHeader><div className="space-y-2 py-2"><Label>Justification</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Expliquez la correction…" /></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Retour</Button><Button variant="destructive" disabled={reason.trim().length < 3 || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Correction…" : "Annuler la confirmation"}</Button></DialogFooter></DialogContent></Dialog>;
}

function CourseWorkspaceSkeleton() {
  return <div className="grid gap-4 xl:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <Card key={index}><CardContent className="space-y-4 p-5"><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="ml-auto h-9 w-32" /></CardContent></Card>)}</div>;
}
