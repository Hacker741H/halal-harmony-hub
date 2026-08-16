import { Link } from "@tanstack/react-router";
import { Archive, MoreHorizontal, Pencil, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Client, CommercialClientFinancialMetricsBulkEntry } from "@/lib/clients.functions";

type Props = {
  clients: Client[];
  loading: boolean;
  error: boolean;
  canUpdate: boolean;
  canArchive: boolean;
  canReadFinancial: boolean;
  commercialMetricsByClientId: Map<string, CommercialClientFinancialMetricsBulkEntry>;
  commercialMetricsLoading: boolean;
  onEdit: (client: Client) => void;
  onArchive: (client: Client) => void;
  onRestore: (client: Client) => void;
};

function statusLabel(status: string) {
  return status === "ARCHIVED" ? "Archivé" : "Actif";
}

function formatAmountDue(value: number) {
  return `${value.toLocaleString("fr-FR")} FCFA`;
}

export function ClientTable({ clients, loading, error, canUpdate, canArchive, canReadFinancial, commercialMetricsByClientId, commercialMetricsLoading, onEdit, onArchive, onRestore }: Props) {
  const columnCount = canReadFinancial ? 7 : 6;
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Contact principal</TableHead><TableHead>Coordonnées</TableHead><TableHead>Missions</TableHead>{canReadFinancial ? <TableHead>Montant dû</TableHead> : null}<TableHead>Statut</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
        <TableBody>
          {loading ? <TableRow><TableCell colSpan={columnCount} className="py-12 text-center text-muted-foreground">Chargement des clients…</TableCell></TableRow> : null}
          {!loading && error ? <TableRow><TableCell colSpan={columnCount} className="py-12 text-center text-destructive">Impossible de charger les clients. Réessayez dans un instant.</TableCell></TableRow> : null}
          {!loading && !error && clients.length === 0 ? <TableRow><TableCell colSpan={columnCount} className="py-12 text-center text-muted-foreground">Aucun client ne correspond aux critères actuels.</TableCell></TableRow> : null}
          {!loading && !error ? clients.map((client) => (
            <TableRow key={client.id}>
              <TableCell><Link to="/clients/$clientId" params={{ clientId: client.id }} className="font-medium hover:underline">{client.display_name}</Link><p className="text-xs text-muted-foreground">{client.client_number}{client.legal_name ? ` · ${client.legal_name}` : ""}</p></TableCell>
              <TableCell>{client.contact_name ?? "—"}<p className="text-xs text-muted-foreground">{client.contact_phone ?? client.contact_email ?? "Aucun contact renseigné"}</p></TableCell>
              <TableCell>{client.telephone ?? client.email ?? "—"}</TableCell>
              <TableCell><span title="Les missions seront disponibles avec le module Missions.">Indisponible</span></TableCell>
              {canReadFinancial ? <TableCell>{commercialMetricsLoading ? <span className="text-muted-foreground">…</span> : (() => {
                const metrics = commercialMetricsByClientId.get(client.id);
                if (!metrics || metrics.sale_count === 0) return <span className="text-muted-foreground" title="Aucune vente commerciale enregistrée pour ce client.">—</span>;
                return metrics.amount_due > 0
                  ? <span className="font-medium text-warning-foreground">{formatAmountDue(metrics.amount_due)}</span>
                  : <span className="text-muted-foreground">{formatAmountDue(0)}</span>;
              })()}</TableCell> : null}
              <TableCell><Badge variant={client.status === "ACTIVE" ? "success" : "outline"}>{statusLabel(client.status)}</Badge></TableCell>
              <TableCell>
                {canUpdate || canArchive ? <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Actions pour ${client.display_name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><Link to="/clients/$clientId" params={{ clientId: client.id }}>Voir la fiche</Link></DropdownMenuItem>{canUpdate && client.status === "ACTIVE" ? <DropdownMenuItem onClick={() => onEdit(client)}><Pencil className="mr-2 h-4 w-4" />Modifier</DropdownMenuItem> : null}{canArchive && client.status === "ACTIVE" ? <DropdownMenuItem onClick={() => onArchive(client)}><Archive className="mr-2 h-4 w-4" />Archiver</DropdownMenuItem> : null}{canArchive && client.status === "ARCHIVED" && !client.merged_into_client_id ? <DropdownMenuItem onClick={() => onRestore(client)}><RotateCcw className="mr-2 h-4 w-4" />Restaurer</DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu> : null}
              </TableCell>
            </TableRow>
          )) : null}
        </TableBody>
      </Table>
    </div>
  );
}
