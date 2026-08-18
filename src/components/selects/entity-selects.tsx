import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getContracts } from "@/lib/contracts.functions";
import { getCourses } from "@/lib/courses.functions";
import { getClients } from "@/lib/clients.functions";
import { getDrivers } from "@/lib/drivers.functions";
import { getEmployees } from "@/lib/employees.functions";
import { getFarms } from "@/lib/farms.functions";
import { getMotorcycles } from "@/lib/motorcycles.functions";
import { getSuppliers } from "@/lib/suppliers.functions";
import { getVehicles } from "@/lib/vehicles.functions";
import { getWallets } from "@/lib/wallet.functions";

type EntitySelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
};

type SelectOption = { id: string; label: string; detail?: string };

function SearchableEntitySelect({
  value,
  onValueChange,
  placeholder = "Sélectionner…",
  disabled,
  id,
  options,
  onSearchChange,
}: EntitySelectProps & { options: SelectOption[]; onSearchChange?: (value: string) => void }) {
  const [search, setSearch] = useState("");
  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) => `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(term));
  }, [options, search]);

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <div className="p-1">
          <Input
            aria-label="Rechercher"
            placeholder="Rechercher…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              onSearchChange?.(event.target.value);
            }}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
        {filteredOptions.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}{option.detail ? ` · ${option.detail}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EmployeeSelect(props: EntitySelectProps) {
  const { data = [] } = useQuery({ queryKey: ["employees"], queryFn: () => getEmployees(), staleTime: 60_000 });
  return <SearchableEntitySelect {...props} options={data.map((employee) => ({ id: employee.id, label: [employee.nom, employee.prenom].filter(Boolean).join(" "), detail: [employee.telephone, employee.poste].filter(Boolean).join(" · ") }))} />;
}

export function ClientSelect(props: EntitySelectProps) {
  const [search, setSearch] = useState("");
  const { data } = useQuery({
    queryKey: ["clients", "select", search],
    queryFn: () => getClients({ data: { page: 1, pageSize: 100, search, status: "ACTIVE" } }),
    staleTime: 60_000,
  });
  return <SearchableEntitySelect {...props} options={(data?.clients ?? []).map((client) => ({
    id: client.id,
    label: client.display_name,
    detail: [client.telephone, client.status].filter(Boolean).join(" · "),
  }))} onSearchChange={setSearch} />;
}

export function SupplierSelect(props: EntitySelectProps) {
  const [search, setSearch] = useState("");
  const { data } = useQuery({
    queryKey: ["suppliers", "select", search],
    queryFn: () => getSuppliers({ data: { page: 1, pageSize: 100, search, status: "ACTIVE" } }),
    staleTime: 60_000,
  });
  return <SearchableEntitySelect {...props} options={(data?.suppliers ?? []).map((supplier) => ({
    id: supplier.id,
    label: supplier.display_name,
    detail: [supplier.telephone, supplier.city].filter(Boolean).join(" · "),
  }))} onSearchChange={setSearch} />;
}

export function CourseSelect(props: EntitySelectProps) {
  const [search, setSearch] = useState("");
  const { data } = useQuery({ queryKey: ["courses", "select", search], queryFn: () => getCourses({ data: { page: 1, pageSize: 100, search, status: null, clientId: null, driverId: null, vehicleId: null, from: null, to: null } }), staleTime: 60_000 });
  return <SearchableEntitySelect {...props} options={(data?.courses ?? []).map((course) => ({ id: course.id, label: course.mission_number, detail: [course.clientName, course.status].filter(Boolean).join(" · ") }))} onSearchChange={setSearch} />;
}

export function DriverSelect(props: EntitySelectProps) {
  const { data = [] } = useQuery({ queryKey: ["drivers"], queryFn: () => getDrivers(), staleTime: 60_000 });
  return <SearchableEntitySelect {...props} options={data.map((driver) => ({ id: driver.id, label: [driver.employees?.nom, driver.employees?.prenom].filter(Boolean).join(" ") || "Chauffeur sans employé", detail: [driver.employees?.telephone, driver.statut].filter(Boolean).join(" · ") }))} />;
}

export function VehicleSelect(props: EntitySelectProps) {
  const { data = [] } = useQuery({ queryKey: ["vehicles"], queryFn: () => getVehicles(), staleTime: 60_000 });
  return <SearchableEntitySelect {...props} options={data.map((vehicle) => ({ id: vehicle.id, label: vehicle.registration, detail: [vehicle.brand, vehicle.model, vehicle.status].filter(Boolean).join(" · ") }))} />;
}

export function MotorcycleSelect(props: EntitySelectProps) {
  const { data = [] } = useQuery({ queryKey: ["motorcycles"], queryFn: () => getMotorcycles(), staleTime: 60_000 });
  return <SearchableEntitySelect {...props} options={data.map((motorcycle) => ({ id: motorcycle.id, label: motorcycle.immatriculation, detail: [motorcycle.marque, motorcycle.modele, motorcycle.statut].filter(Boolean).join(" · ") }))} />;
}

export function FarmSelect(props: EntitySelectProps) {
  const { data = [] } = useQuery({ queryKey: ["farms"], queryFn: () => getFarms(), staleTime: 60_000 });
  return <SearchableEntitySelect {...props} options={data.map((farm) => ({ id: farm.id, label: farm.nom, detail: [farm.village, farm.type_culture, farm.statut].filter(Boolean).join(" · ") }))} />;
}

export function ContractSelect(props: EntitySelectProps) {
  const { data = [] } = useQuery({ queryKey: ["contracts"], queryFn: () => getContracts(), staleTime: 60_000 });
  return <SearchableEntitySelect {...props} options={data.map((contract) => ({ id: contract.id, label: contract.reference || contract.type || "Contrat sans référence", detail: [contract.partie, contract.statut].filter(Boolean).join(" · ") }))} />;
}

export function WalletSelect(props: EntitySelectProps) {
  const { data = [] } = useQuery({ queryKey: ["wallets"], queryFn: () => getWallets(), staleTime: 15_000 });
  return <SearchableEntitySelect {...props} options={data.map((wallet) => ({ id: wallet.id, label: wallet.name, detail: `${(wallet.balance ?? 0).toLocaleString("fr-FR")} FCFA` }))} />;
}

export function EntitySelectLabel({ children }: { children: string }) {
  return <Label>{children}</Label>;
}
