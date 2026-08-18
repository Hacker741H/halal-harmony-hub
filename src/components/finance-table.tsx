import { useMemo, useState } from "react";

import {
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronRight,
  Landmark,
  MoreHorizontal,
  Repeat,
  ReceiptText,
} from "lucide-react";

import {
  FINANCE_MODULE_LABELS,
  FINANCE_OPERATION_STATUS_LABELS,
  FINANCE_OPERATION_TYPE_LABELS,
  type FinanceOperation,
  type FinanceOperationWithWallets,
} from "@/lib/finance.functions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Props = {
  operations: FinanceOperationWithWallets[];
  loading: boolean;
  error?: boolean;
  onEdit?: (operation: FinanceOperation) => void;
  onDelete?: (operation: FinanceOperation) => void;
};

type DisplayRow =
  | { kind: "operation"; operation: FinanceOperationWithWallets }
  | { kind: "group"; reference: string; operations: FinanceOperationWithWallets[] };

const typeLabels: Record<string, string> = FINANCE_OPERATION_TYPE_LABELS;
const moduleLabels: Record<string, string> = FINANCE_MODULE_LABELS;
const statusLabels: Record<string, string> = FINANCE_OPERATION_STATUS_LABELS;

function badgeVariant(type: string) {
  switch (type) {
    case "REVENUE":
      return "default" as const;
    case "EXPENSE":
      return "destructive" as const;
    case "DEPOSIT":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function typeIcon(type: string) {
  switch (type) {
    case "REVENUE":
      return <ArrowUpCircle className="h-4 w-4 text-green-600" />;
    case "EXPENSE":
      return <ArrowDownCircle className="h-4 w-4 text-red-600" />;
    case "TRANSFER":
      return <Repeat className="h-4 w-4" />;
    default:
      return <Landmark className="h-4 w-4" />;
  }
}

export function FinanceTable({
  operations,
  loading,
  error,
  onEdit,
  onDelete,
}: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [walletFilter, setWalletFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [expandedReferences, setExpandedReferences] = useState<Set<string>>(() => new Set());

  const filterOptions = useMemo(() => {
    const types = new Set<string>();
    const wallets = new Map<string, string>();
    const statuses = new Set<string>();
    const modules = new Set<string>();

    for (const operation of operations) {
      types.add(operation.type);
      if (operation.wallet) wallets.set(operation.wallet.id, operation.wallet.name);
      if (operation.status) statuses.add(operation.status);
      if (operation.module) modules.add(operation.module);
    }

    return {
      modules: [...modules].sort(),
      statuses: [...statuses].sort(),
      types: [...types].sort(),
      wallets: [...wallets.entries()].sort(([, left], [, right]) =>
        left.localeCompare(right, "fr"),
      ),
    };
  }, [operations]);

  const filteredOperations = useMemo(() => {
    const value = search.toLowerCase();
    const minimum = amountMin ? Number(amountMin) : null;
    const maximum = amountMax ? Number(amountMax) : null;

    return operations.filter((operation) => {
      const searchable = [
        operation.category,
        operation.description,
        operation.reference,
        operation.wallet?.name,
        operation.destination_wallet?.name,
        operation.module,
        operation.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return (
        (!value || searchable.includes(value)) &&
        (!typeFilter || operation.type === typeFilter) &&
        (!walletFilter || operation.wallet_id === walletFilter) &&
        (!statusFilter || operation.status === statusFilter) &&
        (!moduleFilter || operation.module === moduleFilter) &&
        (!dateFrom || operation.operation_date >= dateFrom) &&
        (!dateTo || operation.operation_date <= dateTo) &&
        (minimum === null || Number(operation.amount) >= minimum) &&
        (maximum === null || Number(operation.amount) <= maximum)
      );
    });
  }, [
    amountMax,
    amountMin,
    dateFrom,
    dateTo,
    moduleFilter,
    operations,
    search,
    statusFilter,
    typeFilter,
    walletFilter,
  ]);

  const displayRows = useMemo<DisplayRow[]>(() => {
    const byReference = new Map<string, FinanceOperationWithWallets[]>();
    for (const operation of filteredOperations) {
      const reference = operation.reference?.trim();
      if (reference) byReference.set(reference, [...(byReference.get(reference) ?? []), operation]);
    }

    const emittedReferences = new Set<string>();
    return filteredOperations.flatMap<DisplayRow>((operation): DisplayRow[] => {
      const reference = operation.reference?.trim();
      const linkedOperations = reference ? byReference.get(reference) : undefined;
      if (!reference || !linkedOperations || linkedOperations.length < 2) {
        return [{ kind: "operation", operation }];
      }
      if (emittedReferences.has(reference)) return [];
      emittedReferences.add(reference);
      return [{ kind: "group", reference, operations: linkedOperations }];
    });
  }, [filteredOperations]);

  const toggleReference = (reference: string) => {
    setExpandedReferences((current) => {
      const next = new Set(current);
      if (next.has(reference)) next.delete(reference);
      else next.add(reference);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Input
          placeholder="Rechercher une opération..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select value={typeFilter || "ALL"} onValueChange={(value) => setTypeFilter(value === "ALL" ? "" : value)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tous les types</SelectItem>
            {filterOptions.types.map((type) => (
              <SelectItem key={type} value={type}>
                {typeLabels[type] ?? type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={walletFilter || "ALL"} onValueChange={(value) => setWalletFilter(value === "ALL" ? "" : value)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tous les wallets</SelectItem>
            {filterOptions.wallets.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter || "ALL"} onValueChange={(value) => setStatusFilter(value === "ALL" ? "" : value)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tous les statuts</SelectItem>
            {filterOptions.statuses.map((status) => (
              <SelectItem key={status} value={status}>
                {statusLabels[status] ?? status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={moduleFilter || "ALL"} onValueChange={(value) => setModuleFilter(value === "ALL" ? "" : value)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tous les modules</SelectItem>
            {filterOptions.modules.map((module) => (
              <SelectItem key={module} value={module}>
                {moduleLabels[module] ?? module}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            min="0"
            placeholder="Montant min."
            value={amountMin}
            onChange={(event) => setAmountMin(event.target.value)}
          />
          <Input
            type="number"
            min="0"
            placeholder="Montant max."
            value={amountMax}
            onChange={(event) => setAmountMax(event.target.value)}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead>Catégorie</TableHead>
              <TableHead>Montant</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading &&
              Array.from({ length: 4 }, (_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}

            {!loading && error && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <p className="font-medium text-destructive">Impossible de charger les opérations.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
                </TableCell>
              </TableRow>
            )}

            {!loading && !error && displayRows.flatMap((row) => {
              if (row.kind === "operation") return [<OperationRow key={row.operation.id} operation={row.operation} onEdit={onEdit} onDelete={onDelete} />];
              const expanded = expandedReferences.has(row.reference);
              const total = row.operations.reduce((sum, operation) => sum + Number(operation.amount), 0);
              const types = [...new Set(row.operations.map((operation) => typeLabels[operation.type] ?? operation.type))];
              return [
                <TableRow key={`group-${row.reference}`} className="bg-muted/40 hover:bg-muted/50">
                  <TableCell colSpan={6} className="p-0">
                    <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => toggleReference(row.reference)}>
                      <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
                      <ReceiptText className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1"><span className="block font-semibold">Facture / dossier : {row.reference}</span><span className="block text-xs text-muted-foreground">{row.operations.length} opérations · {types.join(", ")}</span></span>
                      <span className="shrink-0 font-semibold">{total.toLocaleString("fr-FR")} FCFA</span>
                    </button>
                  </TableCell>
                </TableRow>,
                ...(expanded ? row.operations.map((operation) => <OperationRow key={operation.id} operation={operation} onEdit={onEdit} onDelete={onDelete} nested />) : []),
              ];
            })}

            {!loading && !error && displayRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Aucune opération trouvée.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function OperationRow({ operation, onEdit, onDelete, nested = false }: { operation: FinanceOperationWithWallets; onEdit?: (operation: FinanceOperation) => void; onDelete?: (operation: FinanceOperation) => void; nested?: boolean }) {
  return <TableRow key={operation.id} className={nested ? "bg-muted/10" : undefined}>
    <TableCell className={nested ? "pl-12" : undefined}><div className="flex items-center gap-2">{typeIcon(operation.type)}<Badge variant={badgeVariant(operation.type)}>{typeLabels[operation.type] ?? operation.type}</Badge></div></TableCell>
    <TableCell>{operation.wallet?.name ?? "-"}</TableCell>
    <TableCell>{operation.category ?? operation.description ?? "-"}</TableCell>
    <TableCell className="font-semibold">{Number(operation.amount).toLocaleString("fr-FR")} FCFA</TableCell>
    <TableCell>{operation.operation_date}</TableCell>
    <TableCell><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Actions de l'opération"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => onEdit?.(operation)}>Modifier</DropdownMenuItem><DropdownMenuItem className="text-red-600" onClick={() => onDelete?.(operation)}>Supprimer</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
  </TableRow>;
}
