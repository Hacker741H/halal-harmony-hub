import { Link } from "@tanstack/react-router";
import { ArrowRight, Building2, CalendarDays, ReceiptText, Sprout } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { CommercialSaleListItem } from "@/lib/commercial-sales.functions";
import { formatXOF } from "@/lib/format";

function formatAmount(value: number | null) {
  return value === null ? "Accès limité" : formatXOF(value);
}

function saleStatus(status: string) {
  const labels: Record<string, string> = {
    DRAFT: "Brouillon",
    CONFIRMED: "Confirmée",
    CANCELLED: "Annulée",
    ARCHIVED: "Archivée",
  };
  return labels[status] ?? status;
}

function invoiceStatus(status: string | null) {
  const labels: Record<string, string> = {
    DRAFT: "Facture brouillon",
    ISSUED: "Facture émise",
    PARTIALLY_PAID: "Partiellement encaissée",
    PAID: "Soldée",
    CANCELLED: "Facture annulée",
  };
  return status ? labels[status] ?? status : "Sans facture";
}

function saleVariant(status: string): "outline" | "info" | "success" | "danger" | "neutral" {
  if (status === "CONFIRMED") return "success";
  if (status === "CANCELLED") return "danger";
  if (status === "ARCHIVED") return "neutral";
  return "outline";
}

function invoiceVariant(status: string | null): "outline" | "info" | "success" | "warning" | "neutral" {
  if (status === "PAID") return "success";
  if (status === "PARTIALLY_PAID") return "warning";
  if (status === "ISSUED") return "info";
  if (status === "DRAFT") return "outline";
  return "neutral";
}

export function CommercialSalesList({
  sales,
  loading,
  error,
  canReadFinance,
}: {
  sales: CommercialSaleListItem[];
  loading: boolean;
  error: boolean;
  canReadFinance: boolean;
}) {
  if (loading) {
    return <div className="grid gap-3" aria-label="Chargement des ventes">{Array.from({ length: 5 }, (_, index) => <Card key={index} variant="compact" className="p-5"><div className="grid gap-4 lg:grid-cols-[minmax(13rem,1fr)_minmax(14rem,1.2fr)_minmax(15rem,1fr)_auto]"><div className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div><div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div><div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div></div></Card>)}</div>;
  }

  if (error) {
    return <Card variant="information" role="alert" className="border-destructive/20 bg-destructive/5 p-8 text-center"><p className="font-medium text-destructive">Impossible de charger les ventes.</p><p className="mt-2 text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p></Card>;
  }

  if (!sales.length) {
    return <Card variant="compact" className="border-dashed p-10 text-center"><ReceiptText className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 font-medium text-foreground">Aucune vente à afficher</p><p className="mt-1 text-sm text-muted-foreground">Ajustez les filtres ou créez une première vente commerciale.</p></Card>;
  }

  return <div className="grid gap-3" role="list" aria-label="Liste des ventes">{sales.map((sale, index) => {
    const paymentProgress = sale.totalInvoiced && sale.totalInvoiced > 0 && sale.totalReceived !== null
      ? Math.min(100, Math.max(0, (sale.totalReceived / sale.totalInvoiced) * 100))
      : null;
    return <Card key={sale.id} role="listitem" variant="compact" className="group relative overflow-hidden border-border/80 p-0 transition-[border-color,box-shadow,transform] transition-ui hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none" style={{ animationDelay: `${Math.min(index, 6) * 35}ms` }}>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary/70 via-primary/20 to-transparent opacity-0 transition-opacity transition-ui group-hover:opacity-100" aria-hidden="true" />
      <CardContent className="p-4 sm:p-5"><div className="grid gap-5 xl:grid-cols-[minmax(12rem,0.9fr)_minmax(14rem,1.15fr)_minmax(21rem,1.35fr)_auto] xl:items-center">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link to="/sales/$saleId" params={{ saleId: sale.id }} className="font-semibold tracking-tight text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{sale.sale_number}</Link><Badge variant={saleVariant(sale.status)} appearance="soft">{saleStatus(sale.status)}</Badge></div><p className="mt-2 flex items-center gap-1.5 truncate text-caption"><CalendarDays className="size-3.5 shrink-0 text-primary" aria-hidden="true" />{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${sale.sale_date}T12:00:00`))}</p></div>
        <div className="min-w-0"><p className="flex items-center gap-1.5 truncate text-body-sm font-semibold text-foreground"><Building2 className="size-3.5 shrink-0 text-primary" aria-hidden="true" />{sale.clientName ?? "Client non accessible"}</p><p className="mt-1 truncate text-caption">{sale.reference ?? "Sans référence"}</p>{sale.farmName ? <p className="mt-1 flex items-center gap-1.5 truncate text-caption"><Sprout className="size-3.5 shrink-0 text-success" aria-hidden="true" />{sale.farmName}</p> : null}</div>
        {canReadFinance ? <div className="grid gap-3 border-t border-border/70 pt-4 sm:grid-cols-3 xl:border-l xl:pl-5 xl:pt-0"><FinanceValue label="Facturé" value={formatAmount(sale.totalInvoiced)} /><FinanceValue label="Encaissé" value={formatAmount(sale.totalReceived)} tone="success" /><FinanceValue label="Reste dû" value={formatAmount(sale.amountDue)} tone={sale.amountDue !== null && sale.amountDue > 0 ? "warning" : "success"} /><div className="sm:col-span-3"><div className="flex items-center justify-between gap-3 text-caption"><Badge variant={invoiceVariant(sale.invoiceStatus)} appearance="soft">{invoiceStatus(sale.invoiceStatus)}</Badge><span className="font-medium tabular-nums text-foreground">{paymentProgress === null ? "Pas encore d’encaissement" : `${Math.round(paymentProgress)} % encaissé`}</span></div>{paymentProgress === null ? <div className="mt-2 h-2 rounded-full bg-muted" /> : <Progress className="mt-2 h-2 bg-primary/10" value={paymentProgress} aria-label={`${Math.round(paymentProgress)} % de la facture est encaissé`} />}</div></div> : <p className="text-caption text-muted-foreground">Les montants restent réservés aux rôles financiers.</p>}
        <Button asChild variant="ghost" size="icon" className="shrink-0 self-start xl:self-center" aria-label={`Ouvrir la vente ${sale.sale_number}`}><Link to="/sales/$saleId" params={{ saleId: sale.id }}><ArrowRight className="size-4 transition-transform transition-ui-fast group-hover:translate-x-0.5 motion-reduce:transform-none" /></Link></Button>
      </div></CardContent>
    </Card>;
  })}</div>;
}

function FinanceValue({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "success" | "warning" }) {
  const tones = { neutral: "text-foreground", success: "text-success", warning: "text-warning-foreground" };
  return <div className="min-w-0"><p className="text-caption">{label}</p><p className={`mt-1 truncate text-body-sm font-semibold tabular-nums ${tones[tone]}`} title={value}>{value}</p></div>;
}
