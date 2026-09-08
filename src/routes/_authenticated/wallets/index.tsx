import { useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Bike, Car, Landmark, MoreHorizontal, Plus, Sprout, Store, Truck, Wallet, WalletCards } from "lucide-react";
import { toast } from "sonner";

import { WalletForm } from "@/components/wallet-form";
import { WalletTable } from "@/components/wallet-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MetricCard } from "@/components/ui/metric-card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { formatXOF } from "@/lib/format";
import { useConfirm } from "@/hooks/use-confirm";
import {
  archiveWallet,
  deleteWallet,
  getWalletModuleDetail,
  getWalletModulesSummary,
  getWallets,
  getWalletStats,
  WALLET_MODULE_LABELS,
  type Wallet as WalletType,
  type WalletModule,
} from "@/lib/wallet.functions";
import { notifyMutationError } from "@/lib/notify-mutation-error";

export const Route = createFileRoute("/_authenticated/wallets/")({
  component: WalletsPage,
});

const MODULE_ICONS: Record<WalletModule, typeof Bike> = {
  MOTOS: Bike,
  VEHICULES: Car,
  AGRICULTURE: Sprout,
  COMMERCE: Store,
  TRANSPORT: Truck,
};

function WalletsPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<WalletType | null>(null);
  const [selectedModule, setSelectedModule] = useState<WalletModule | null>(null);

  const { data: wallets = [], isLoading, isError } = useQuery({ queryKey: ["wallets"], queryFn: () => getWallets() });
  const { data: stats } = useQuery({ queryKey: ["wallet-stats"], queryFn: () => getWalletStats() });
  const { data: moduleSummaries = [] } = useQuery({
    queryKey: ["wallet-modules-summary"],
    queryFn: () => getWalletModulesSummary(),
  });
  const { data: moduleDetail = [], isLoading: moduleDetailLoading } = useQuery({
    queryKey: ["wallet-module-detail", selectedModule],
    queryFn: () => getWalletModuleDetail({ data: selectedModule! }),
    enabled: selectedModule !== null,
  });

  const treasuryWallets = wallets.filter((wallet) => !wallet.module);
  const totalBalance = Number(stats?.totalBalance ?? 0);

  const refresh = () => {
    setOpen(false);
    setSelectedWallet(null);
    void queryClient.invalidateQueries({ queryKey: ["wallets"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet-stats"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet-modules-summary"] });
  };

  const toggleArchive = (row: { walletId: string; name: string; isArchived: boolean; isGeneral: boolean }) => {
    confirm({
      title: row.isArchived ? "Réactiver ce wallet ?" : "Archiver ce wallet ?",
      description: row.isArchived
        ? `« ${row.name} » pourra de nouveau recevoir des opérations.`
        : `« ${row.name} » n'apparaîtra plus pour de nouvelles opérations. Son historique reste consultable.`,
      variant: row.isArchived ? "default" : "destructive",
      confirmLabel: row.isArchived ? "Réactiver" : "Archiver",
      onConfirm: async () => {
        try {
          await archiveWallet({ data: { id: row.walletId, archived: !row.isArchived } });
          await queryClient.invalidateQueries({ queryKey: ["wallet-module-detail", selectedModule] });
          toast.success(row.isArchived ? "Wallet réactivé." : "Wallet archivé.");
        } catch (error) {
          notifyMutationError(error, "Action impossible.");
          throw error;
        }
      },
    });
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
          notifyMutationError(error, "Impossible de supprimer ce wallet.");
          throw error;
        }
      },
    });
  };

  return (
    <div className="space-y-7">
      <OperationalHero
        variant="deep"
        icon={WalletCards}
        eyebrow="Finance"
        title="Wallets et trésorerie"
        description="Solde consolidé en temps réel, tous modules confondus."
        primaryStat={{ label: "Trésorerie consolidée", value: formatXOF(totalBalance), tone: totalBalance < 0 ? "danger" : "neutral" }}
        secondaryStats={[{ label: "Comptes actifs", value: stats?.totalWallets ?? 0 }]}
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
          value={formatXOF(totalBalance)}
          description={totalBalance < 0 ? "Solde à régulariser" : "Solde disponible, tous wallets confondus"}
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

      {moduleSummaries.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Par module</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {moduleSummaries.map((summary) => (
              <MetricCard
                key={summary.module}
                label={WALLET_MODULE_LABELS[summary.module]}
                value={formatXOF(summary.consolidatedBalance)}
                description={`${summary.subWalletCount} sous-wallet(s) — entrées ${formatXOF(summary.incomingTotal)}, sorties ${formatXOF(summary.expenseTotal)}`}
                icon={MODULE_ICONS[summary.module]}
                tone={summary.consolidatedBalance < 0 ? "danger" : summary.module === selectedModule ? "primary" : "neutral"}
                onClick={() => setSelectedModule(summary.module === selectedModule ? null : summary.module)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {selectedModule ? (
        <Card variant="section" className="overflow-hidden">
          <CardHeader className="border-b border-border/70">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{WALLET_MODULE_LABELS[selectedModule]}</p>
                <CardTitle className="mt-1 text-xl">Sous-wallets</CardTitle>
              </div>
              <p className="text-sm text-muted-foreground">
                {moduleDetailLoading ? "Chargement…" : "Ouvrez un sous-wallet pour son historique propre."}
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-5 sm:p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-left text-caption text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Nom</th>
                    <th className="pb-2 pr-4 font-medium">Solde</th>
                    <th className="pb-2 pr-4 font-medium">Entrées</th>
                    <th className="pb-2 pr-4 font-medium">Sorties</th>
                    <th className="pb-2 pr-0 font-medium text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {moduleDetail.map((row) => (
                    <tr key={row.walletId} className="border-b border-border/40 last:border-0">
                      <td className="py-2.5 pr-4">
                        <Link
                          to="/wallets/$walletId"
                          params={{ walletId: row.walletId }}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {row.name}
                        </Link>
                        {row.isGeneral ? (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Général</span>
                        ) : null}
                        {row.isArchived ? (
                          <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] text-destructive">Archivé</span>
                        ) : null}
                      </td>
                      <td className={`py-2.5 pr-4 font-medium tabular-nums ${row.balance < 0 ? "text-destructive" : ""}`}>
                        {formatXOF(row.balance)}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">{formatXOF(row.incomingTotal)}</td>
                      <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">{formatXOF(row.expenseTotal)}</td>
                      <td className="py-2.5 pr-0 text-right">
                        {!row.isGeneral ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => toggleArchive(row)}>
                                {row.isArchived ? (
                                  <ArchiveRestore className="h-4 w-4" />
                                ) : (
                                  <Archive className="h-4 w-4" />
                                )}
                                {row.isArchived ? "Réactiver" : "Archiver"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card variant="section" className="overflow-hidden">
        <CardHeader className="border-b border-border/70">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Trésorerie</p>
              <CardTitle className="mt-1 text-xl">Comptes hors module</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">{isLoading ? "Chargement des wallets…" : "Comptes de trésorerie et de règlement, non affectés à un module."}</p>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          <WalletTable
            wallets={treasuryWallets}
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
