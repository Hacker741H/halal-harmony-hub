import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UsersRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ClientForm } from "@/components/clients/client-form";
import { ClientTable } from "@/components/clients/client-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePermissions } from "@/hooks/use-permissions";
import { archiveClient, getClients, restoreClient, type Client } from "@/lib/clients.functions";

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
  const pageSize = 20;
  const clientsQuery = useQuery({
    queryKey: ["clients", { page, search, status }],
    queryFn: () => getClients({ data: { page, pageSize, search, status: status === "ALL" ? null : status } }),
  });
  const archiveMutation = useMutation({
    mutationFn: archiveClient,
    onSuccess: () => { toast.success("Client archivé."); void queryClient.invalidateQueries({ queryKey: ["clients"] }); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Impossible d’archiver ce client."),
  });
  const restoreMutation = useMutation({
    mutationFn: restoreClient,
    onSuccess: () => { toast.success("Client restauré."); void queryClient.invalidateQueries({ queryKey: ["clients"] }); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Impossible de restaurer ce client."),
  });

  const total = clientsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clients = clientsQuery.data?.clients ?? [];

  function refresh() {
    setDialogOpen(false);
    setEditingClient(null);
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><h1 className="flex items-center gap-3 text-3xl font-bold"><UsersRound className="h-7 w-7" />Clients</h1><p className="text-muted-foreground">Référentiel commercial unique pour les futures missions de transport.</p></div>{can("clients.create") ? <Button onClick={() => { setEditingClient(null); setDialogOpen(true); }}><Plus className="mr-2 h-4 w-4" />Nouveau client</Button> : null}</div>

      <Card><CardHeader><CardTitle>Répertoire Clients</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]"><Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Rechercher par nom, société, téléphone ou e-mail…" aria-label="Rechercher un client" /><Select value={status} onValueChange={(value) => { setStatus(value === "ACTIVE" || value === "ARCHIVED" ? value : "ALL"); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ACTIVE">Actifs</SelectItem><SelectItem value="ARCHIVED">Archivés</SelectItem><SelectItem value="ALL">Tous les statuts</SelectItem></SelectContent></Select><p className="self-center text-sm text-muted-foreground">{total} résultat{total > 1 ? "s" : ""}</p></div>
        <ClientTable clients={clients} loading={clientsQuery.isPending} error={clientsQuery.isError} canUpdate={can("clients.update")} canArchive={can("clients.archive")} canReadFinancial={can("clients.financial.read")} onEdit={(client) => { setEditingClient(client); setDialogOpen(true); }} onArchive={(client) => { if (window.confirm(`Archiver ${client.display_name} ?`)) archiveMutation.mutate({ data: { id: client.id } }); }} onRestore={(client) => restoreMutation.mutate({ data: { id: client.id } })} />
        <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">Page {page} sur {totalPages}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Précédent</Button><Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Suivant</Button></div></div>
      </CardContent></Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingClient(null); }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{editingClient ? "Modifier le client" : "Nouveau client"}</DialogTitle></DialogHeader><ClientForm client={editingClient} onSuccess={refresh} /></DialogContent></Dialog>
    </div>
  );
}
