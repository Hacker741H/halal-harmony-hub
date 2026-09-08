import { useMemo, useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WalletSelect } from "@/components/selects/entity-selects";
import { formatXOF } from "@/lib/format";
import {
  convertWalletToParent,
  getWallets,
  previewWalletParentConversion,
  type Wallet,
  type WalletConversionPlan,
} from "@/lib/wallet.functions";
import { notifyMutationError } from "@/lib/notify-mutation-error";

type Row = {
  key: string;
  mode: "existing" | "new";
  existingWalletId: string;
  newWalletName: string;
  newWalletType: string;
  amount: string;
};

const WALLET_TYPE_OPTIONS = [
  { value: "CASH", label: "Espèces" },
  { value: "WAVE", label: "Wave" },
  { value: "ORANGE_MONEY", label: "Orange Money" },
  { value: "MTN_MOMO", label: "MTN MoMo" },
  { value: "BANK", label: "Banque" },
  { value: "SAVINGS", label: "Épargne" },
  { value: "ASSET", label: "Actif" },
];

function newRow(): Row {
  return { key: crypto.randomUUID(), mode: "new", existingWalletId: "", newWalletName: "", newWalletType: "CASH", amount: "" };
}

type Props = {
  wallet: Wallet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

/**
 * Explicit, controlled conversion of an existing funded wallet (e.g.
 * "Marasse") into a parent: the user allocates its current balance across
 * existing and/or brand-new sub-wallets, sees the exact before/after plan
 * (including any JEKO mapping impact), and only then confirms. Every
 * allocation lands as a real, auditable TRANSFER -- never a silent balance
 * edit. Never triggered automatically.
 */
export function WalletParentConversionDialog({ wallet, open, onOpenChange, onSuccess }: Props) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [plan, setPlan] = useState<WalletConversionPlan | null>(null);
  const [jekoTargets, setJekoTargets] = useState<Record<string, string>>({});
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const { data: wallets = [] } = useQuery({ queryKey: ["wallets"], queryFn: () => getWallets(), staleTime: 15_000 });
  const eligibleExisting = wallets.filter(
    (candidate) => candidate.id !== wallet.id && !candidate.parent_wallet_id && !wallets.some((w) => w.parent_wallet_id === candidate.id),
  );

  const total = useMemo(() => rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0), [rows]);
  const targetBalance = Number(wallet.balance ?? 0);
  const sumMatches = rows.length > 0 && rows.every((row) => Number(row.amount) > 0) && total === targetBalance;

  function reset() {
    setRows([newRow()]);
    setPlan(null);
    setJekoTargets({});
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function buildAllocations() {
    return rows.map((row) =>
      row.mode === "existing"
        ? { existingWalletId: row.existingWalletId, amount: Number(row.amount) }
        : { newWalletName: row.newWalletName.trim(), newWalletType: row.newWalletType, amount: Number(row.amount) },
    );
  }

  async function runPreview() {
    if (rows.some((row) => row.mode === "existing" && !row.existingWalletId)) {
      toast.error("Choisissez un sous-wallet existant pour chaque ligne concernée.");
      return;
    }
    if (rows.some((row) => row.mode === "new" && !row.newWalletName.trim())) {
      toast.error("Donnez un nom à chaque nouveau sous-wallet.");
      return;
    }
    try {
      setPreviewing(true);
      const result = await previewWalletParentConversion({ data: { walletId: wallet.id, allocations: buildAllocations() } });
      setPlan(result);
    } catch (error) {
      console.error(error);
      notifyMutationError(error, "Impossible de calculer la prévisualisation.");
    } finally {
      setPreviewing(false);
    }
  }

  async function confirm() {
    if (!plan) return;
    const jekoStoreIds = [...new Set([...plan.jekoMappings.map((mapping) => mapping.providerStoreId), ...plan.jekoPendingRequests.map((request) => request.providerStoreId)])];
    if (jekoStoreIds.some((storeId) => !jekoTargets[storeId])) {
      toast.error("Choisissez le sous-wallet de remplacement pour chaque magasin Jèko concerné.");
      return;
    }
    try {
      setConfirming(true);
      await convertWalletToParent({
        data: {
          walletId: wallet.id,
          allocations: buildAllocations(),
          jekoRemap:
            jekoStoreIds.length > 0
              ? jekoStoreIds.map((storeId) => ({ providerStoreId: storeId, newWalletId: jekoTargets[storeId] }))
              : undefined,
        },
      });
      toast.success(`"${wallet.name}" est maintenant un wallet parent. Solde consolidé inchangé : ${formatXOF(targetBalance)}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["wallets"] }),
        queryClient.invalidateQueries({ queryKey: ["wallet-stats"] }),
        queryClient.invalidateQueries({ queryKey: ["wallet", wallet.id] }),
        queryClient.invalidateQueries({ queryKey: ["wallet-children", wallet.id] }),
        queryClient.invalidateQueries({ queryKey: ["wallet-operations", wallet.id] }),
      ]);
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error(error);
      notifyMutationError(error, "La conversion a échoué.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Convertir "{wallet.name}" en wallet parent</DialogTitle>
          <DialogDescription>
            Ce wallet a un solde direct de {formatXOF(targetBalance)}. Répartissez-le sur un ou plusieurs sous-wallets avant de continuer — la somme doit
            correspondre exactement. Chaque ligne devient un transfert réel et traçable ; rien n'est déplacé silencieusement.
          </DialogDescription>
        </DialogHeader>

        {!plan ? (
          <div className="space-y-4">
            <div className="space-y-3">
              {rows.map((row) => (
                <Card key={row.key} variant="section" className="p-3">
                  <div className="grid gap-2 sm:grid-cols-[auto_1fr_140px_auto] sm:items-start">
                    <RadioGroup
                      value={row.mode}
                      onValueChange={(value) => updateRow(row.key, { mode: value as Row["mode"] })}
                      className="flex gap-3 pt-2 sm:flex-col sm:gap-1.5"
                    >
                      <label className="flex items-center gap-1.5 text-xs">
                        <RadioGroupItem value="new" /> Nouveau
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <RadioGroupItem value="existing" /> Existant
                      </label>
                    </RadioGroup>

                    {row.mode === "new" ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          placeholder="Nom (ex. Wave)"
                          value={row.newWalletName}
                          onChange={(event) => updateRow(row.key, { newWalletName: event.target.value })}
                        />
                        <Select value={row.newWalletType} onValueChange={(value) => updateRow(row.key, { newWalletType: value })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {WALLET_TYPE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <Select value={row.existingWalletId} onValueChange={(value) => updateRow(row.key, { existingWalletId: value })}>
                        <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                        <SelectContent>
                          {eligibleExisting.map((candidate) => (
                            <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    <Input
                      type="number"
                      placeholder="Montant"
                      value={row.amount}
                      onChange={(event) => updateRow(row.key, { amount: event.target.value })}
                    />

                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={rows.length === 1}
                      onClick={() => setRows((current) => current.filter((candidate) => candidate.key !== row.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>

            <Button variant="outline" size="sm" onClick={() => setRows((current) => [...current, newRow()])}>
              <Plus className="h-4 w-4" />
              Ajouter une ligne
            </Button>

            <div className={`flex items-center justify-between rounded-lg border p-3 text-sm ${sumMatches ? "border-success/40 bg-success/10" : "border-warning/40 bg-warning/10"}`}>
              <span>Total réparti</span>
              <span className="font-semibold tabular-nums">
                {formatXOF(total)} / {formatXOF(targetBalance)}
              </span>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
              <Button disabled={!sumMatches || previewing} onClick={runPreview} loading={previewing}>
                Prévisualiser
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border p-3 text-sm">
              <div className="flex justify-between"><span>{plan.walletName} — solde avant</span><span className="font-semibold tabular-nums">{formatXOF(plan.balanceBefore)}</span></div>
              <div className="flex justify-between"><span>{plan.walletName} — solde après (direct)</span><span className="font-semibold tabular-nums">{formatXOF(plan.balanceAfter)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Solde consolidé (parent + sous-wallets)</span><span className="tabular-nums">{formatXOF(plan.balanceBefore)}</span></div>
            </div>

            <div className="space-y-2">
              {plan.targets.map((target, index) => (
                <div key={index} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {target.isNew ? `${target.newWalletName} (nouveau)` : target.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatXOF(target.balanceBefore)} → {formatXOF(target.balanceAfter)}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums text-success">+{formatXOF(target.amount)}</span>
                </div>
              ))}
            </div>

            {(() => {
              const jekoStoreIds = [...new Set([...plan.jekoMappings.map((mapping) => mapping.providerStoreId), ...plan.jekoPendingRequests.map((request) => request.providerStoreId)])];
              if (jekoStoreIds.length === 0) {
                return <Badge variant="outline" className="w-fit">Aucun paiement Jèko lié à ce wallet.</Badge>;
              }
              const pendingCount = plan.jekoPendingRequests.length;
              return (
                <Card variant="section" className="border-warning/40 bg-warning/10 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <div className="w-full space-y-3">
                      <p className="text-sm font-medium">
                        Jèko est lié à ce wallet pour {jekoStoreIds.length} magasin{jekoStoreIds.length > 1 ? "s" : ""}
                        {pendingCount > 0 ? ` (dont ${pendingCount} demande${pendingCount > 1 ? "s" : ""} de paiement en attente)` : ""}. Il ne pourra plus
                        recevoir de paiements une fois converti : choisissez le sous-wallet de remplacement pour chacun.
                      </p>
                      {jekoStoreIds.map((storeId) => (
                        <div key={storeId} className="grid gap-1.5">
                          <Label className="text-xs">
                            Magasin Jèko {storeId}
                            {plan.jekoPendingRequests.some((request) => request.providerStoreId === storeId) ? " · paiement en attente" : ""}
                          </Label>
                          <WalletSelect
                            value={jekoTargets[storeId] ?? ""}
                            onValueChange={(value) => setJekoTargets((current) => ({ ...current, [storeId]: value }))}
                            excludeWalletId={wallet.id}
                            placeholder="Sélectionner le nouveau wallet cible…"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              );
            })()}

            <DialogFooter>
              <Button variant="outline" onClick={() => setPlan(null)}>Modifier la répartition</Button>
              <Button onClick={confirm} loading={confirming} disabled={confirming}>
                Confirmer la conversion
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
