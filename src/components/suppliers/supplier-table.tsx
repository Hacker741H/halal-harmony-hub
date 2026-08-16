import { Link } from "@tanstack/react-router";
import { Archive, MoreHorizontal, Pencil, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Supplier } from "@/lib/suppliers.functions";

type Props = {
  suppliers: Supplier[];
  loading: boolean;
  error: boolean;
  canUpdate: boolean;
  canArchive: boolean;
  onEdit: (supplier: Supplier) => void;
  onArchive: (supplier: Supplier) => void;
  onRestore: (supplier: Supplier) => void;
};

function statusLabel(status: string) {
  return status === "ARCHIVED" ? "Archivé" : "Actif";
}

export function SupplierTable({ suppliers, loading, error, canUpdate, canArchive, onEdit, onArchive, onRestore }: Props) {
  const columnCount = 5;
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader><TableRow><TableHead>Fournisseur</TableHead><TableHead>Coordonnées</TableHead><TableHead>Pays</TableHead><TableHead>Statut</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
        <TableBody>
          {loading ? <TableRow><TableCell colSpan={columnCount} className="py-12 text-center text-muted-foreground">Chargement des fournisseurs…</TableCell></TableRow> : null}
          {!loading && error ? <TableRow><TableCell colSpan={columnCount} className="py-12 text-center text-destructive">Impossible de charger les fournisseurs. Réessayez dans un instant.</TableCell></TableRow> : null}
          {!loading && !error && suppliers.length === 0 ? <TableRow><TableCell colSpan={columnCount} className="py-12 text-center text-muted-foreground">Aucun fournisseur ne correspond aux critères actuels.</TableCell></TableRow> : null}
          {!loading && !error ? suppliers.map((supplier) => (
            <TableRow key={supplier.id}>
              <TableCell><Link to="/suppliers/$supplierId" params={{ supplierId: supplier.id }} className="font-medium hover:underline">{supplier.display_name}</Link><p className="text-xs text-muted-foreground">{supplier.supplier_number}{supplier.legal_name ? ` · ${supplier.legal_name}` : ""}</p></TableCell>
              <TableCell>{supplier.telephone ?? supplier.email ?? "—"}</TableCell>
              <TableCell>{supplier.country_code === "CI" ? "Côte d’Ivoire" : supplier.country_code === "SN" ? "Sénégal" : supplier.country_code}</TableCell>
              <TableCell><Badge variant={supplier.status === "ACTIVE" ? "success" : "outline"}>{statusLabel(supplier.status)}</Badge></TableCell>
              <TableCell>
                {canUpdate || canArchive ? <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Actions pour ${supplier.display_name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><Link to="/suppliers/$supplierId" params={{ supplierId: supplier.id }}>Voir la fiche</Link></DropdownMenuItem>{canUpdate && supplier.status === "ACTIVE" ? <DropdownMenuItem onClick={() => onEdit(supplier)}><Pencil className="mr-2 h-4 w-4" />Modifier</DropdownMenuItem> : null}{canArchive && supplier.status === "ACTIVE" ? <DropdownMenuItem onClick={() => onArchive(supplier)}><Archive className="mr-2 h-4 w-4" />Archiver</DropdownMenuItem> : null}{canArchive && supplier.status === "ARCHIVED" ? <DropdownMenuItem onClick={() => onRestore(supplier)}><RotateCcw className="mr-2 h-4 w-4" />Restaurer</DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu> : null}
              </TableCell>
            </TableRow>
          )) : null}
        </TableBody>
      </Table>
    </div>
  );
}
