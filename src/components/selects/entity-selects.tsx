import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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

export function SearchableEntitySelect({
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

// Maps a "moyen de paiement" value (as collected by e.g. RevenueForm) to the
// wallet `type` values a matching sub-wallet would carry -- two separate,
// independently-evolved vocabularies (payment_method is French/informal,
// wallet.type is the DB enum-like set from wallet-form.tsx), never unified
// automatically. Suggestion only: never overrides a value the user already
// picked, only pre-selects when the field is still empty.
const PAYMENT_METHOD_TO_WALLET_TYPE: Record<string, string> = {
  ESPECES: "CASH",
  WAVE: "WAVE",
  ORANGE_MONEY: "ORANGE_MONEY",
  MTN_MONEY: "MTN_MOMO",
  BANQUE: "BANK",
};

/**
 * Hierarchy-aware wallet picker. A wallet with no sub-wallets behaves
 * exactly as a flat pick, unchanged. A wallet that HAS sub-wallets is never
 * itself selectable (a parent must stay non-transactional once it has
 * children) -- its sub-wallets appear instead, grouped under its name.
 * `paymentMethodHint` (optional): when the field is still empty and one of
 * the currently-selectable wallets' `type` matches the hint, pre-selects it
 * once -- the user can always change it afterward.
 * `excludeWalletId` (optional): drops one wallet from the list regardless
 * of its hierarchy status -- for a transfer's destination picker excluding
 * whatever the source picker currently holds, and vice versa (a wallet
 * still can't transfer to itself, on top of never targeting a parent).
 */
/**
 * Chantier de stabilisation, section 7/15 : un wallet parent consolidateur
 * ne doit jamais être proposé comme option transactionnelle -- c'est
 * exactement la règle dont deux vraies failles (remise de caisse, wallets
 * terrain) ont été trouvées et corrigées côté SQL cette même session parce
 * qu'elles réimplémentaient cette exclusion à la main, sans elle. Extrait
 * en fonction pure et exportée pour que ce calcul soit testable
 * (scripts/test-wallet-hierarchy.ts) sans dépendre de React ni d'une base
 * -- comportement inchangé, WalletSelect appelle simplement cette fonction
 * maintenant au lieu de la même logique en ligne.
 */
export function partitionWalletsByHierarchy<T extends { id: string; parent_wallet_id: string | null }>(
  data: T[],
  excludeWalletId?: string,
): { flatOptions: T[]; groups: Array<{ parent: T; children: T[] }> } {
  const childrenByParent = new Map<string, T[]>();
  for (const wallet of data) {
    if (!wallet.parent_wallet_id) continue;
    const list = childrenByParent.get(wallet.parent_wallet_id) ?? [];
    list.push(wallet);
    childrenByParent.set(wallet.parent_wallet_id, list);
  }
  const selectable = data.filter((wallet) => !childrenByParent.has(wallet.id) && wallet.id !== excludeWalletId);
  const standalone = selectable.filter((wallet) => !wallet.parent_wallet_id);
  const groupedParents = data.filter((wallet) => childrenByParent.has(wallet.id));
  return {
    flatOptions: standalone,
    groups: groupedParents
      .map((parent) => ({ parent, children: (childrenByParent.get(parent.id) ?? []).filter((child) => child.id !== excludeWalletId) }))
      .filter((group) => group.children.length > 0),
  };
}

export function WalletSelect(props: EntitySelectProps & { paymentMethodHint?: string; excludeWalletId?: string }) {
  const { paymentMethodHint, excludeWalletId, ...selectProps } = props;
  const { data = [] } = useQuery({ queryKey: ["wallets"], queryFn: () => getWallets(), staleTime: 15_000 });

  const { flatOptions, groups } = useMemo(
    () => partitionWalletsByHierarchy(data, excludeWalletId),
    [data, excludeWalletId],
  );

  const lastAppliedHint = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!paymentMethodHint || selectProps.value || lastAppliedHint.current === paymentMethodHint) return;
    const wantedType = PAYMENT_METHOD_TO_WALLET_TYPE[paymentMethodHint];
    if (!wantedType) return;
    const allSelectable = [...flatOptions, ...groups.flatMap((group) => group.children)];
    const match = allSelectable.find((wallet) => wallet.type === wantedType);
    if (match) {
      lastAppliedHint.current = paymentMethodHint;
      selectProps.onValueChange(match.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMethodHint, flatOptions, groups]);

  const balanceLabel = (wallet: (typeof data)[number]) => `${(wallet.balance ?? 0).toLocaleString("fr-FR")} FCFA`;

  return (
    <Select value={selectProps.value} onValueChange={selectProps.onValueChange} disabled={selectProps.disabled}>
      <SelectTrigger id={selectProps.id}><SelectValue placeholder={selectProps.placeholder ?? "Sélectionner…"} /></SelectTrigger>
      <SelectContent>
        {flatOptions.map((wallet) => (
          <SelectItem key={wallet.id} value={wallet.id}>{wallet.name} · {balanceLabel(wallet)}</SelectItem>
        ))}
        {groups.map(({ parent, children }) => (
          <SelectGroup key={parent.id}>
            <SelectLabel>{parent.name}</SelectLabel>
            {children.map((child) => (
              <SelectItem key={child.id} value={child.id}>{child.name} · {balanceLabel(child)}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Searchable picker over an already-loaded Commerce catalogue (the caller
 * already fetches it via getCommerceInventoryCatalogue for its own
 * business_location -- this never re-fetches, just presents it). Used by
 * both the receipt ("Réapprovisionner") and write-off ("Retirer un
 * produit") dialogs so an item can be found by typing instead of scanning
 * an unsearchable dropdown.
 */
export function InventoryLocationItemSelect(
  props: EntitySelectProps & { items: { id: string; name: string; sku: string | null; locationQuantity: number; unit: string | null }[] },
) {
  const { items, ...selectProps } = props;
  return (
    <SearchableEntitySelect
      {...selectProps}
      options={items.map((item) => ({
        id: item.id,
        label: item.name,
        detail: [item.sku, `en rayon : ${item.locationQuantity}${item.unit ? ` ${item.unit}` : ""}`].filter(Boolean).join(" · "),
      }))}
    />
  );
}

export function EntitySelectLabel({ children }: { children: string }) {
  return <Label>{children}</Label>;
}
