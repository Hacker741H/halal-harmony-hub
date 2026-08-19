import { useMemo, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { ClientForm } from "@/components/clients/client-form";
import { ClientTable } from "@/components/clients/client-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/hooks/use-confirm";
import { usePermissions } from "@/hooks/use-permissions";
import {
  archiveClient,
  getClients,
  getCommercialClientFinancialMetricsBulk,
  restoreClient,
  type Client,
  type CommercialClientFinancialMetricsBulkEntry,
} from "@/lib/clients.functions";

export const Route = createFileRoute("/_authenticated/clients/")({
  component: ClientsPage,
});

function ClientsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"ALL" | "ACTIVE" | "ARCHIVED">("ACTIVE");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const { confirm, dialog } = useConfirm();
  const pageSize = 20;

  const clientsQuery = useQuery({
    queryKey: ["clients", { page, search, status }],
    queryFn: () => getClients({ data: { page, pageSize, search, status: status === "ALL" ? null : status } }),
  });
  const archiveMutation = useMutation({
    mutationFn: archiveClient,
    onSuccess: () => {
      toast.success("Client archivé.");
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Impossible d’archiver ce client."),
  });
  const restoreMutation = useMutation({
    mutationFn: restoreClient,
    onSuccess: () => {
      toast.success("Client restauré.");
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Impossible de restaurer ce client."),
  });

  const total = clientsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clients = clientsQuery.data?.clients ?? [];
  const canReadCommercialFinance = can("sales.finance.read");
  const clientIds = useMemo(() => clients.map((client) => client.id), [clients]);
  const commercialMetricsQuery = useQuery({
    queryKey: ["clients-commercial-metrics", clientIds],
    queryFn: () => getCommercialClientFinancialMetricsBulk({ data: clientIds }),
    enabled: canReadCommercialFinance && clientIds.length > 0,
  });
  const commercialMetricsByClientId = useMemo(() => {
    const map = new Map<string, CommercialClientFinancialMetricsBulkEntry>();
    for (const entry of commercialMetricsQuery.data ?? []) map.set(entry.client_id, entry);
    return map;
  }, [commercialMetricsQuery.data]);

  function refresh() {
    setDialogOpen(false);
    setEditingClient(null);
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clients"
        description="Un référentiel commercial unique pour relier les futurs échanges, courses et documents sans dupliquer les coordonnées."
        actions={
          can("clients.create") ? (
            <Button
              onClick={() => {
                setEditingClient(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Nouveau client
            </Button>
          ) : null
        }
      />

      <Card variant="section" className="overflow-hidden">
        <CardHeader className="border-b border-border/70">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Répertoire clients</p>
              <CardTitle className="mt-1 text-xl">Relations commerciales</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">{total} résultat{total > 1 ? "s" : ""} selon les filtres actifs</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Rechercher par nom, société, téléphone ou e-mail…"
              aria-label="Rechercher un client"
            />
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value === "ACTIVE" || value === "ARCHIVED" ? value : "ALL");
                setPage(1);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Actifs</SelectItem>
                <SelectItem value="ARCHIVED">Archivés</SelectItem>
                <SelectItem value="ALL">Tous les statuts</SelectItem>
              </SelectContent>
            </Select>
            <p className="self-center text-sm text-muted-foreground">Page {page} / {totalPages}</p>
          </div>

          <ClientTable
            clients={clients}
            loading={clientsQuery.isPending}
            error={clientsQuery.isError}
            canUpdate={can("clients.update")}
            canArchive={can("clients.archive")}
            canReadFinancial={canReadCommercialFinance}
            commercialMetricsByClientId={commercialMetricsByClientId}
            commercialMetricsLoading={commercialMetricsQuery.isPending}
            onEdit={(client) => {
              setEditingClient(client);
              setDialogOpen(true);
            }}
            onArchive={(client) => {
              confirm({
                title: "Archiver ce client",
                description: `Archiver ${client.display_name} ?`,
                variant: "destructive",
                confirmLabel: "Archiver",
                onConfirm: async () => { await archiveMutation.mutateAsync({ data: { id: client.id } }); },
              });
            }}
            onRestore={(client) => restoreMutation.mutate({ data: { id: client.id } })}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
            <p className="text-sm text-muted-foreground">Pagination du référentiel</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Précédent</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Suivant</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          setDialogOpen(nextOpen);
          if (!nextOpen) setEditingClient(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingClient ? "Modifier le client" : "Nouveau client"}</DialogTitle>
          </DialogHeader>
          <ClientForm client={editingClient} onSuccess={refresh} />
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}
