import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Plus, Wallet, WalletCards } from "lucide-react";
import { toast } from "sonner";

import { WalletForm } from "@/components/wallet-form";
import { WalletTable } from "@/components/wallet-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MetricCard } from "@/components/ui/metric-card";
import { ModuleHero } from "@/components/ui/module-hero";
import { useConfirm } from "@/hooks/use-confirm";
import { deleteWallet, getWallets, getWalletStats, type Wallet as WalletType } from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/wallets/")({
  component: WalletsPage,
});

const formatAmount = (value: number) => `${value.toLocaleString("fr-FR")} FCFA`;

function WalletsPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<WalletType | null>(null);
  const { data: wallets = [], isLoading, isError } = useQuery({ queryKey: ["wallets"], queryFn: () => getWallets() });
  const { data: stats } = useQuery({ queryKey: ["wallet-stats"], queryFn: () => getWalletStats() });
  const totalBalance = Number(stats?.totalBalance ?? 0);

  const refresh = () => {
    setOpen(false);
    setSelectedWallet(null);
    void queryClient.invalidateQueries({ queryKey: ["wallets"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet-stats"] });
  };

  const remove = (wallet: WalletType) => {
    confirm({
      title: "Supprimer ce wallet ?",
      description: `Le wallet « ${wallet.name} » sera définitivement supprimé.`,
      variant: "destructive",
      confirmLabel: "Supprimer",
      onConfirm: async () => {
        try {
          await deleteWallet({ data: { id: wallet.id } });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["wallets"] }),
            queryClient.invalidateQueries({ queryKey: ["wallet-stats"] }),
          ]);
          toast.success("Wallet supprimé.");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Impossible de supprimer ce wallet.");
          throw error;
        }
      },
    });
  };

  return (
    <div className="space-y-7">
      <ModuleHero
        icon={WalletCards}
        eyebrow="Finance centrale"
        title="Wallets et trésorerie"
        description="Chaque mouvement passe par un wallet. Gardez une lecture fiable des soldes disponibles et des comptes à piloter."
        actions={
          <Button
            onClick={() => {
              setSelectedWallet(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Nouveau wallet
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Trésorerie consolidée"
          value={formatAmount(totalBalance)}
          description={totalBalance < 0 ? "Solde à régulariser" : "Solde disponible consolidé"}
          icon={Landmark}
          tone={totalBalance < 0 ? "danger" : "success"}
        />
        <MetricCard
          label="Comptes actifs"
          value={stats?.totalWallets ?? 0}
          description="Wallets configurés"
          icon={WalletCards}
          tone="info"
        />
        <MetricCard
          label="Wallet principal"
          value={wallets.find((wallet) => wallet.is_default)?.name ?? "—"}
          description="Compte de référence"
          icon={Wallet}
        />
      </div>

      <Card variant="section" className="overflow-hidden">
        <CardHeader className="border-b border-border/70">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Comptes de trésorerie</p>
              <CardTitle className="mt-1 text-xl">Wallets suivis</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">{isLoading ? "Chargement des wallets…" : "Ouvrez un wallet pour consulter son historique détaillé."}</p>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          <WalletTable
            wallets={wallets}
            loading={isLoading}
            error={isError}
            onEdit={(wallet) => {
              setSelectedWallet(wallet);
              setOpen(true);
            }}
            onDelete={remove}
          />
        </CardContent>
      </Card>

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

      {dialog}
    </div>
  );
}
