import { useMemo, useState } from "react";

import {
  ArrowDownCircle,
  ArrowUpCircle,
  Landmark,
  MoreHorizontal,
  Repeat,
} from "lucide-react";

import type {
  FinanceOperation,
  FinanceOperationWithWallets,
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
  onEdit?: (operation: FinanceOperation) => void;
  onDelete?: (operation: FinanceOperation) => void;
};

const typeLabels: Record<string, string> = {
  REVENUE: "Recette",
  EXPENSE: "Dépense",
  DEPOSIT: "Versement",
  TRANSFER: "Transfert",
};

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

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Input
          placeholder="Rechercher une opération..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="rounded-md border bg-background px-3 py-2"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="">Tous les types</option>
          {filterOptions.types.map((type) => (
            <option key={type} value={type}>
              {typeLabels[type] ?? type}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border bg-background px-3 py-2"
          value={walletFilter}
          onChange={(event) => setWalletFilter(event.target.value)}
        >
          <option value="">Tous les wallets</option>
          {filterOptions.wallets.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border bg-background px-3 py-2"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="">Tous les statuts</option>
          {filterOptions.statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border bg-background px-3 py-2"
          value={moduleFilter}
          onChange={(event) => setModuleFilter(event.target.value)}
        >
          <option value="">Tous les modules</option>
          {filterOptions.modules.map((module) => (
            <option key={module} value={module}>
              {module}
            </option>
          ))}
        </select>
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
            {loading && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  Chargement...
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              filteredOperations.map((operation) => (
                <TableRow key={operation.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {typeIcon(operation.type)}
                      <Badge variant={badgeVariant(operation.type)}>
                        {typeLabels[operation.type] ?? operation.type}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>{operation.wallet?.name ?? "-"}</TableCell>
                  <TableCell>{operation.category ?? "-"}</TableCell>
                  <TableCell className="font-semibold">
                    {Number(operation.amount).toLocaleString("fr-FR")} FCFA
                  </TableCell>
                  <TableCell>{operation.operation_date}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit?.(operation)}>
                          Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => onDelete?.(operation)}
                        >
                          Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}

            {!loading && filteredOperations.length === 0 && (
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
