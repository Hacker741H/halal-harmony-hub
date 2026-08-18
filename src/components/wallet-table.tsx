import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Banknote,
  CircleDollarSign,
  Landmark,
  MoreHorizontal,
  PiggyBank,
  Radio,
  Search,
  Smartphone,
  WalletCards,
} from "lucide-react";

import type { Wallet as WalletType } from "@/lib/wallet.functions";
import { formatXOF } from "@/lib/format";
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

type Props = {
  wallets: WalletType[];
  loading: boolean;
  error?: boolean;
  onEdit?: (wallet: WalletType) => void;
  onDelete?: (wallet: WalletType) => void;
};

function formatMoney(amount: number | null) {
  return formatXOF(amount ?? 0);
}

function getWalletMeta(type: string) {
  const items: Record<string, { label: string; icon: typeof Landmark }> = {
    BANK: { label: "Banque", icon: Landmark },
    MOBILE_MONEY: { label: "Mobile money", icon: Smartphone },
    JEKO: { label: "Jèko", icon: CircleDollarSign },
    WAVE: { label: "Wave", icon: Smartphone },
    ORANGE_MONEY: { label: "Orange Money", icon: Smartphone },
    MTN_MOMO: { label: "MTN MoMo", icon: Smartphone },
    CASH: { label: "Espèces", icon: Banknote },
    SAVINGS: { label: "Épargne", icon: PiggyBank },
    ASSET: { label: "Actif", icon: WalletCards },
  };
  return items[type] ?? { label: type || "Wallet", icon: WalletCards };
}

export function WalletTable({ wallets, loading, error, onEdit, onDelete }: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const filteredWallets = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return wallets;
    return wallets.filter((wallet) =>
      `${wallet.name} ${wallet.type}`.toLowerCase().includes(value),
    );
  }, [search, wallets]);

  return (
    <section className="space-y-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-overline text-primary">
            Portefeuilles
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Vos comptes en temps réel</h2>
        </div>
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            className="h-11 rounded-xl border border-input bg-surface pl-9 shadow-xs"
            placeholder="Rechercher un wallet…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Chargement des wallets">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="rounded-2xl border border-border/75 bg-surface p-5">
              <Skeleton className="h-12 w-12 rounded-2xl" />
              <Skeleton className="mt-4 h-4 w-2/3" />
              <Skeleton className="mt-8 h-8 w-3/4" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-destructive/20 bg-destructive/5 p-12 text-center">
          <p className="font-medium text-destructive">Impossible de charger les wallets.</p>
          <p className="mt-2 text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
        </div>
      ) : filteredWallets.length === 0 ? (
        <div className="rounded-3xl border border-dashed p-12 text-center text-muted-foreground">
          {search.trim() ? "Aucun wallet ne correspond à la recherche." : "Aucun wallet trouvé."}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredWallets.map((wallet) => {
            const meta = getWalletMeta(wallet.type);
            const Icon = meta.icon;
            const balance = Number(wallet.balance ?? 0);
            const walletType = wallet.type?.toUpperCase();
            const isWave = walletType === "WAVE" || /wave/i.test(wallet.name);
            return (
              <article
                key={wallet.id}
                className="group relative cursor-pointer overflow-hidden rounded-2xl border border-border/75 bg-surface p-5 shadow-xs transition-[border-color,box-shadow,transform] transition-ui hover:-translate-y-0.5 hover:border-primary/25 hover:bg-surface-hover hover:shadow-md"
                onClick={() =>
                  navigate({ to: "/wallets/$walletId", params: { walletId: wallet.id } })
                }
              >
                <div
                  className={`absolute inset-x-0 top-0 h-1.5 ${isWave ? "bg-[#1cc7f4]" : ""}`}
                  style={isWave ? undefined : { backgroundColor: wallet.color || "#16a34a" }}
                />
                <div className="flex items-start justify-between gap-3 pt-2">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-sm ${isWave ? "bg-[#1cc7f4]" : ""}`}
                      style={isWave ? undefined : { backgroundColor: wallet.color || "#16a34a" }}
                    >
                      {isWave ? (
                        <img src="/wave-logo.svg" alt="Wave" className="h-10 w-10" />
                      ) : (
                        <Icon className="h-5 w-5" />
                      )}
                    </div>
                    <div>
                      <p className="font-semibold">{wallet.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {isWave ? "Wave Business" : meta.label}
                      </p>
                    </div>
                  </div>
                  <div onClick={(event) => event.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="rounded-full" aria-label={`Actions de ${wallet.name}`}>
                          <MoreHorizontal className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit?.(wallet)}>
                          Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => onDelete?.(wallet)}
                        >
                          Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <Link
                  to="/wallets/$walletId"
                  params={{ walletId: wallet.id }}
                  className="mt-8 block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Solde disponible
                  </p>
                  <p
                    className={`mt-2 text-3xl font-bold tracking-tight ${balance < 0 ? "text-destructive" : "text-foreground"}`}
                  >
                    {formatMoney(wallet.balance)}
                  </p>
                  <p className="mt-3 text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    Voir les opérations →
                  </p>
                </Link>
                {isWave && (
                  <div className="mt-5 flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800">
                    <Radio className="h-3.5 w-3.5" />
                    <span>Wave Business · connexion API en attente</span>
                  </div>
                )}
                <div className="mt-6 flex items-center justify-between border-t pt-4">
                  <Badge
                    variant="secondary"
                    className="rounded-full border-border/75 bg-muted px-3 py-1 text-muted-foreground"
                  >
                    {isWave ? "WAVE BUSINESS" : meta.label}
                  </Badge>
                  {wallet.is_default ? (
                    <Badge variant="success" appearance="soft" className="px-3 py-1">Principal</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {wallet.color || "Couleur standard"}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
