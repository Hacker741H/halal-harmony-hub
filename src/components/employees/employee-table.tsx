import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  MoreHorizontal,
  Search,
  Phone,
  Briefcase,
  Mail,
} from "lucide-react";

import { formatXOF } from "@/lib/format";

import type { Employee } from "@/lib/employees.functions";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

type Props = {
  employees: Employee[];
  loading: boolean;
  error?: boolean;
  onEdit?: (employee: Employee) => void;
  onDelete?: (employee: Employee) => void;
};

export function EmployeeTable({
  employees,
  loading,
  error,
  onEdit,
  onDelete,
}: Props) {
  const [search, setSearch] = useState("");

  const filteredEmployees = useMemo(() => {
    if (!search.trim()) return employees;

    const value = search.toLowerCase();

    return employees.filter((employee) =>
      [
        employee.nom,
        employee.prenom,
        employee.telephone,
        employee.email,
        employee.poste,
        employee.matricule,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(value),
    );
  }, [employees, search]);

  function initials(employee: Employee) {
    return `${employee.nom?.charAt(0) ?? ""}${
      employee.prenom?.charAt(0) ?? ""
    }`.toUpperCase();
  }

  function badgeVariant(statut: string) {
    switch (statut) {
      case "actif":
        return "default";

      case "inactif":
        return "secondary";

      case "archive":
        return "destructive";

      default:
        return "outline";
    }
  }

  return (
    <div className="space-y-4">

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />

        <Input
          placeholder="Rechercher un employé..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="rounded-xl border overflow-hidden">

        <Table>

          <TableHeader>
            <TableRow>

              <TableHead>Employé</TableHead>

              <TableHead>Contact</TableHead>

              <TableHead>Poste</TableHead>

              <TableHead>Salaire</TableHead>

              <TableHead>Statut</TableHead>

              <TableHead className="w-[70px]" />

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
                  <p className="font-medium text-destructive">Impossible de charger les employés.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
                </TableCell>
              </TableRow>
            )}

            {!loading && !error &&
              filteredEmployees.map((employee) => (
                <TableRow key={employee.id}>

                  <TableCell>

                    <div className="flex items-center gap-3">

                      <Avatar>

                        <AvatarFallback>
                          {initials(employee)}
                        </AvatarFallback>

                      </Avatar>

                      <div>

                        <Link className="font-medium hover:underline" to="/employees/$employeeId" params={{ employeeId: employee.id }}>
                          {employee.nom} {employee.prenom}
                        </Link>

                        <div className="text-xs text-muted-foreground">
                          {employee.matricule || "Aucun matricule"}
                        </div>

                      </div>

                    </div>

                  </TableCell>

                  <TableCell>

                    <div className="space-y-1 text-sm">

                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5" />
                        {employee.telephone || "-"}
                      </div>

                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5" />
                        {employee.email || "-"}
                      </div>

                    </div>

                  </TableCell>

                  <TableCell>

                    <div className="flex items-center gap-2">

                      <Briefcase className="h-4 w-4 text-muted-foreground" />

                      {employee.poste || "-"}

                    </div>

                  </TableCell>

                  <TableCell>

                    {formatXOF(employee.salaire_base)}

                  </TableCell>

                  <TableCell>

                    <Badge
                      variant={badgeVariant(employee.statut)}
                    >
                      {employee.statut}
                    </Badge>

                  </TableCell>

                  <TableCell>

                    <DropdownMenu>

                      <DropdownMenuTrigger asChild>

                        <Button
                          size="icon"
                          variant="ghost"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>

                      </DropdownMenuTrigger>

                      <DropdownMenuContent align="end">

                        <DropdownMenuItem asChild>
                          <Link to="/employees/$employeeId" params={{ employeeId: employee.id }}>Voir la fiche</Link>
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          onClick={() => onEdit?.(employee)}
                        >
                          Modifier
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => onDelete?.(employee)}
                        >
                          Supprimer
                        </DropdownMenuItem>

                      </DropdownMenuContent>

                    </DropdownMenu>

                  </TableCell>

                </TableRow>
              ))}

            {!loading && !error &&
              filteredEmployees.length === 0 && (
                <TableRow>

                  <TableCell
                    colSpan={6}
                    className="text-center py-12 text-muted-foreground"
                  >
                    {search.trim() ? "Aucun employé ne correspond à la recherche." : "Aucun employé trouvé."}
                  </TableCell>

                </TableRow>
              )}

          </TableBody>

        </Table>

      </div>

    </div>
  );
}
