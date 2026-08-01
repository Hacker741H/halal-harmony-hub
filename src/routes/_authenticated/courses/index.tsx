import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CircleDollarSign, Clock3, Plus, Route as RouteIcon, TrendingUp, WalletCards } from "lucide-react";
import { useState } from "react";

import { CourseTable } from "@/components/courses/course-table";
import { CourseWizard } from "@/components/courses/course-wizard";
import { ClientSelect, DriverSelect, VehicleSelect } from "@/components/selects/entity-selects";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/use-permissions";
import { COURSE_STATUS_LABELS, COURSE_STATUSES, getCourses, type CourseListItem } from "@/lib/courses.functions";

export const Route = createFileRoute("/_authenticated/courses/")({ component: CoursesPage });

function formatAmount(value: number) {
  return `${value.toLocaleString("fr-FR")} FCFA`;
}

function isCompletedToday(course: CourseListItem) {
  if (!course.actual_arrival_at || !["COMPLETED", "CLOSED"].includes(course.status)) return false;
  const arrival = new Date(course.actual_arrival_at);
  const today = new Date();
  return arrival.getFullYear() === today.getFullYear()
    && arrival.getMonth() === today.getMonth()
    && arrival.getDate() === today.getDate();
}

function CoursesPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [clientId, setClientId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [wizardOpen, setWizardOpen] = useState(false);
  const pageSize = 20;
  const canReadFinance = can("missions.finance.read");

  const coursesQuery = useQuery({
    queryKey: ["courses", { page, search, status, clientId, driverId, vehicleId, from, to }],
    queryFn: () => getCourses({
      data: {
        page,
        pageSize,
        search,
        status: status === "ALL" ? null : status as (typeof COURSE_STATUSES)[number],
        clientId: clientId || null,
        driverId: driverId || null,
        vehicleId: vehicleId || null,
        from: from || null,
        to: to || null,
      },
    }),
  });

  const courses = coursesQuery.data?.courses ?? [];
  const total = coursesQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const overview = {
    active: courses.filter((course) => ["PLANNED", "IN_PROGRESS"].includes(course.status)).length,
    completedToday: courses.filter(isCompletedToday).length,
    receivable: courses.reduce((sum, course) => sum + (course.amountDue ?? 0), 0),
    result: courses.reduce((sum, course) => sum + (course.grossResult ?? 0), 0),
  };

  function resetFilters() {
    setSearch("");
    setStatus("ALL");
    setClientId("");
    setDriverId("");
    setVehicleId("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  const summaryUnavailable = coursesQuery.isPending || coursesQuery.isError;

  return (
    <div className="mx-auto max-w-(--ds-content-max-width) space-y-6 p-4 sm:p-6 xl:p-8">
      <section className="relative isolate overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-surface-elevated to-surface px-5 py-6 shadow-md sm:px-7 sm:py-7 lg:px-8">
        <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-primary/15 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 size-64 rounded-full bg-info/10 blur-3xl" aria-hidden="true" />
        <div className="relative">
          <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-overline text-primary">Exploitation · Transport</p>
              <h1 className="mt-2 flex items-center gap-3 text-h1"><RouteIcon className="size-7 text-primary" aria-hidden="true" />Courses</h1>
              <p className="mt-3 text-body-sm leading-6 text-muted-foreground sm:text-base">Un espace de pilotage pour voir le transport, les coûts et les encaissements sans quitter votre flux opérationnel.</p>
            </div>
            {can("missions.create") ? <Button className="shrink-0 shadow-sm" onClick={() => setWizardOpen(true)}><Plus className="mr-2 size-4" />Nouvelle Course</Button> : null}
          </header>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <HeroKpi icon={Clock3} label="Courses actives" value={summaryUnavailable ? null : String(overview.active)} detail="Planifiées ou en cours" tone="info" />
            <HeroKpi icon={CalendarDays} label="Terminées aujourd’hui" value={summaryUnavailable ? null : String(overview.completedToday)} detail="Parmi les Courses affichées" tone="success" />
            <HeroKpi icon={WalletCards} label="Reste à encaisser" value={summaryUnavailable || !canReadFinance ? null : formatAmount(overview.receivable)} detail={canReadFinance ? "Sur les Courses affichées" : "Accès financier requis"} tone="warning" />
            <HeroKpi icon={CircleDollarSign} label="Résultat visible" value={summaryUnavailable || !canReadFinance ? null : formatAmount(overview.result)} detail={canReadFinance ? "Résultat brut des Courses affichées" : "Accès financier requis"} tone={overview.result < 0 ? "danger" : "success"} />
          </div>
          <p className="mt-4 text-caption text-muted-foreground"><TrendingUp className="mr-1 inline size-3.5 text-primary" aria-hidden="true" />Les indicateurs reflètent uniquement les Courses de la page courante et les filtres actifs.</p>
        </div>
      </section>

      <Card variant="section" className="border-border/80">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 border-b border-border/70 pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-label text-foreground">Trouver et filtrer</p>
              <p className="mt-1 text-caption">Les filtres existants sont appliqués à la liste ci-dessous.</p>
            </div>
            <p className="text-caption tabular-nums text-muted-foreground">{total} Course{total > 1 ? "s" : ""} trouvée{total > 1 ? "s" : ""}</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_180px_170px_170px]">
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Rechercher un numéro, itinéraire, marchandise ou référence…" aria-label="Rechercher une Course" />
            <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger><SelectValue placeholder="Tous les statuts" /></SelectTrigger><SelectContent><SelectItem value="ALL">Tous les statuts</SelectItem>{COURSE_STATUSES.map((item) => <SelectItem key={item} value={item}>{COURSE_STATUS_LABELS[item]}</SelectItem>)}</SelectContent></Select>
            <div className="space-y-1"><Label className="text-caption">Du</Label><Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></div>
            <div className="space-y-1"><Label className="text-caption">Au</Label><Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></div>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <ClientSelect value={clientId} onValueChange={(value) => { setClientId(value); setPage(1); }} placeholder="Filtrer par client" />
            <DriverSelect value={driverId} onValueChange={(value) => { setDriverId(value); setPage(1); }} placeholder="Filtrer par chauffeur" />
            <VehicleSelect value={vehicleId} onValueChange={(value) => { setVehicleId(value); setPage(1); }} placeholder="Filtrer par véhicule" />
            <Button variant="ghost" onClick={resetFilters}>Réinitialiser</Button>
          </div>
        </CardContent>
      </Card>

      <CourseTable courses={courses} loading={coursesQuery.isPending} error={coursesQuery.isError} canReadFinance={canReadFinance} />

      <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-caption text-muted-foreground">Page {page} sur {totalPages}</p>
        <div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Précédent</Button><Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Suivant</Button></div>
      </div>

      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>Nouvelle Course</DialogTitle></DialogHeader><CourseWizard onSuccess={(courseId) => { setWizardOpen(false); void navigate({ to: "/courses/$courseId", params: { courseId } }); }} /></DialogContent>
      </Dialog>
    </div>
  );
}

function HeroKpi({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Clock3;
  label: string;
  value: string | null;
  detail: string;
  tone: "info" | "success" | "warning" | "danger";
}) {
  const tones = {
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
    warning: "bg-warning/15 text-warning-foreground",
    danger: "bg-destructive/10 text-destructive",
  };

  return (
    <Card variant="glass" className="border-border/70 bg-surface/75 p-4 transition-[border-color,box-shadow,transform] transition-ui hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-sm motion-reduce:transform-none motion-reduce:transition-none">
      <div className="flex items-start justify-between gap-3"><p className="text-label text-muted-foreground">{label}</p><div className={`grid size-9 place-items-center rounded-xl ${tones[tone]}`}><Icon className="size-4" aria-hidden="true" /></div></div>
      {value === null ? <Skeleton className="mt-5 h-7 w-3/4" /> : <p className="mt-5 truncate text-[clamp(1.25rem,1.8vw,1.8rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums text-foreground" title={value}>{value}</p>}
      <p className="mt-3 truncate text-caption" title={detail}>{detail}</p>
    </Card>
  );
}
