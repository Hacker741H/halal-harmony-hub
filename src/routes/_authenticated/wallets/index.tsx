import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Landmark, Plus, WalletCards } from "lucide-react";
import { WalletForm } from "@/components/wallet-form";
import { WalletTable } from "@/components/wallet-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  deleteWallet,
  getWallets,
  getWalletStats,
  type Wallet as WalletType,
} from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/wallets/")({ component: WalletsPage });
const formatAmount = (value: number) => `${value.toLocaleString("fr-FR")} FCFA`;

function WalletsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<WalletType | null>(null);
  const { data: wallets = [], isLoading } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => getWallets(),
  });
  const { data: stats } = useQuery({ queryKey: ["wallet-stats"], queryFn: () => getWalletStats() });
  const totalBalance = Number(stats?.totalBalance ?? 0);
  const refresh = () => {
    setOpen(false);
    setSelectedWallet(null);
    void queryClient.invalidateQueries({ queryKey: ["wallets"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet-stats"] });
  };
  const remove = async (wallet: WalletType) => {
    if (!confirm(`Supprimer le wallet « ${wallet.name} » ?`)) return;
    try {
      await deleteWallet({ data: { id: wallet.id } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["wallets"] }),
        queryClient.invalidateQueries({ queryKey: ["wallet-stats"] }),
      ]);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Impossible de supprimer ce wallet.");
    }
  };
  return (
    <>
      <main className="min-h-full space-y-8 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.13),_transparent_32rem)] p-6 lg:p-8">
        <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-700 p-6 text-white shadow-xl lg:p-8">
          <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200">
                <WalletCards className="h-4 w-4" />
                Finance centrale
              </p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight">Wallets</h1>
              <p className="mt-2 max-w-xl text-emerald-100">
                Chaque franc a une direction. À vous de la décider.
              </p>
            </div>
            <Button
              onClick={() => {
                setSelectedWallet(null);
                setOpen(true);
              }}
              className="bg-white text-emerald-950 shadow-lg hover:bg-emerald-50"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nouveau wallet
            </Button>
          </div>
        </section>
        <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div className="rounded-3xl bg-emerald-950 p-6 text-white shadow-lg">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-emerald-200">Trésorerie consolidée</p>
                <p className="mt-3 text-3xl font-bold tracking-tight">
                  {formatAmount(totalBalance)}
                </p>
              </div>
              <Landmark className="h-6 w-6 text-emerald-300" />
            </div>
            <p className="mt-6 flex items-center gap-1 text-sm text-emerald-200">
              {totalBalance < 0 ? (
                <ArrowDownRight className="h-4 w-4 text-rose-300" />
              ) : (
                <ArrowUpRight className="h-4 w-4 text-emerald-300" />
              )}
              {totalBalance < 0 ? "Solde à régulariser" : "Trésorerie positive"}
            </p>
          </div>
          <Metric
            label="Comptes actifs"
            value={stats?.totalWallets ?? 0}
            detail="Wallets configurés"
          />
          <Metric
            label="Wallet principal"
            value={wallets.find((wallet) => wallet.is_default)?.name ?? "—"}
            detail="Compte de référence"
          />
        </section>
        <WalletTable
          wallets={wallets}
          loading={isLoading}
          onEdit={(wallet) => {
            setSelectedWallet(wallet);
            setOpen(true);
          }}
          onDelete={remove}
        />
      </main>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setSelectedWallet(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedWallet ? "Modifier le wallet" : "Nouveau wallet"}</DialogTitle>
          </DialogHeader>
          <WalletForm wallet={selectedWallet} onSuccess={refresh} />
        </DialogContent>
      </Dialog>
    </>
  );
}
function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-3xl border bg-white p-6 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 truncate text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-5 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
