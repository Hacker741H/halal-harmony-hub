import { Link } from "@tanstack/react-router";
import { ArrowRight, Car, MapPinned, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { COURSE_STATUS_LABELS, type CourseListItem } from "@/lib/courses.functions";
import { formatXOF } from "@/lib/format";

function formatAmount(value: number | null) {
  return value === null ? "Non renseigné" : formatXOF(value);
}

function statusVariant(status: CourseListItem["status"]): "outline" | "info" | "warning" | "success" | "danger" {
  if (status === "CLOSED") return "success";
  if (status === "CANCELLED") return "outline";
  if (status === "IN_PROGRESS") return "info";
  if (status === "PLANNED") return "warning";
  return "outline";
}

function displayStatus(course: CourseListItem) {
  if (course.invoiceStatus === "ISSUED" || course.invoiceStatus === "PARTIALLY_PAID") return "Facturée";
  return COURSE_STATUS_LABELS[course.status as keyof typeof COURSE_STATUS_LABELS];
}

function initials(name: string | null) {
  return name
    ?.split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "—";
}

function paymentProgress(course: CourseListItem) {
  if (course.amountDue === null || course.actual_transport_amount === null || course.invoiceStatus === null) return null;
  const actualAmount = Number(course.actual_transport_amount);
  if (actualAmount <= 0) return 0;
  return Math.min(100, Math.max(0, ((actualAmount - course.amountDue) / actualAmount) * 100));
}

export function CourseTable({
  courses,
  loading,
  error,
  canReadFinance,
}: {
  courses: CourseListItem[];
  loading: boolean;
  error: boolean;
  canReadFinance: boolean;
}) {
  if (loading) {
    return (
      <div className="grid gap-3" aria-label="Chargement des Courses">
        {Array.from({ length: 5 }, (_, index) => (
          <Card key={index} variant="compact" className="overflow-hidden p-4 sm:p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(13rem,1.1fr)_minmax(14rem,1.2fr)_minmax(13rem,1fr)_minmax(17rem,1.3fr)] lg:items-center">
              <div className="space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-20" /></div>
              <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-2/3" /></div>
              <div className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
              <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card variant="information" role="alert" className="border-destructive/20 bg-destructive/5 p-8 text-center">
        <p className="font-medium text-destructive">Impossible de charger les Courses.</p>
        <p className="mt-2 text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
      </Card>
    );
  }

  if (!courses.length) {
    return (
      <Card variant="compact" className="border-dashed p-10 text-center">
        <MapPinned className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 font-medium text-foreground">Aucune Course à afficher</p>
        <p className="mt-1 text-sm text-muted-foreground">Ajustez les filtres ou créez une nouvelle Course.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-3" role="list" aria-label="Liste des Courses">
      {courses.map((course, index) => {
        const progress = paymentProgress(course);
        const route = [course.departure_location, course.destination_location].filter(Boolean).join(" → ") || "Itinéraire à préciser";

        return (
          <Card
            key={course.id}
            variant="compact"
            role="listitem"
            className="group relative overflow-hidden border-border/80 p-0 transition-[border-color,box-shadow,transform] transition-ui hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none"
            style={{ animationDelay: `${Math.min(index, 6) * 35}ms` }}
          >
            <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary/70 via-primary/20 to-transparent opacity-0 transition-opacity transition-ui-fast group-hover:opacity-100" aria-hidden="true" />
            <CardContent className="p-4 sm:p-5">
              <div className="grid gap-5 xl:grid-cols-[minmax(12rem,0.9fr)_minmax(15rem,1.15fr)_minmax(13rem,0.95fr)_minmax(21rem,1.3fr)_auto] xl:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/courses/$courseId"
                      params={{ courseId: course.id }}
                      className="font-semibold tracking-tight text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {course.mission_number}
                    </Link>
                    <Badge variant={statusVariant(course.status)} appearance="soft">{displayStatus(course)}</Badge>
                  </div>
                  <p className="mt-2 truncate text-caption">{course.reference ?? "Sans référence"}</p>
                </div>

                <div className="min-w-0">
                  <p className="truncate text-body-sm font-semibold text-foreground">{course.clientName ?? "Client non accessible"}</p>
                  <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-caption">
                    <MapPinned className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                    {route}
                  </p>
                  <p className="mt-1 text-caption">
                    {course.planned_departure_at
                      ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(course.planned_departure_at))
                      : "Date à préciser"}
                  </p>
                </div>

                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="size-9 border border-border bg-primary/5">
                    <AvatarFallback className="bg-primary/10 text-caption font-semibold text-primary">{initials(course.driverName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-body-sm font-medium text-foreground"><UserRound className="size-3.5 text-muted-foreground" aria-hidden="true" />{course.driverName ?? "Chauffeur non affecté"}</p>
                    <p className="mt-1 flex items-center gap-1.5 truncate text-caption"><Car className="size-3.5 text-muted-foreground" aria-hidden="true" />{course.vehicleLabel ?? "Véhicule non affecté"}</p>
                  </div>
                </div>

                {canReadFinance ? (
                  <div className="grid gap-3 border-t border-border/70 pt-4 sm:grid-cols-3 xl:border-t-0 xl:border-l xl:pl-5 xl:pt-0">
                    <FinanceValue label="Transport réel" value={formatAmount(course.actual_transport_amount)} />
                    <FinanceValue label="Dépenses" value={formatAmount(course.actualExpenses)} tone={course.actualExpenses !== null && course.actualExpenses > 0 ? "warning" : "neutral"} />
                    <FinanceValue label="Résultat" value={course.grossResult === null ? "Non disponible" : formatAmount(course.grossResult)} tone={course.grossResult === null ? "neutral" : course.grossResult < 0 ? "danger" : "success"} />
                    <div className="sm:col-span-3 xl:col-span-3">
                      <div className="flex items-center justify-between gap-3 text-caption"><span>Encaissement</span><span className="font-medium tabular-nums text-foreground">Reste {formatAmount(course.amountDue)}</span></div>
                      {progress === null ? <div className="mt-2 h-2 rounded-full bg-muted" aria-label="Informations financières non accessibles" /> : <Progress className="mt-2 h-2 bg-primary/10" value={progress} aria-label={`${Math.round(progress)} % de la recette est encaissée`} />}
                    </div>
                  </div>
                ) : null}

                <Button asChild variant="ghost" size="icon" className="shrink-0 self-start xl:self-center" aria-label={`Ouvrir la Course ${course.mission_number}`}>
                  <Link to="/courses/$courseId" params={{ courseId: course.id }}><ArrowRight className="size-4 transition-transform transition-ui-fast group-hover:translate-x-0.5 motion-reduce:transform-none" /></Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function FinanceValue({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const tones = {
    neutral: "text-foreground",
    success: "text-success",
    warning: "text-warning-foreground",
    danger: "text-destructive",
  };

  return (
    <div className="min-w-0">
      <p className="text-caption">{label}</p>
      <p className={`mt-1 truncate text-body-sm font-semibold tabular-nums ${tones[tone]}`} title={value}>{value}</p>
    </div>
  );
}
