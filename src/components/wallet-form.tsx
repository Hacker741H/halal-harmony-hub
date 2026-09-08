import { useEffect, useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createWallet, getWallets, updateWallet, type Wallet } from "@/lib/wallet.functions";
import { notifyMutationError } from "@/lib/notify-mutation-error";
import { useQuery } from "@tanstack/react-query";

type Props = { onSuccess: () => void; wallet?: Wallet | null; defaultParentWalletId?: string | null };

type FormValues = {
  name: string;
  type: string;
  initial_balance: string;
  color: string;
  icon: string;
  is_default: boolean;
  parent_wallet_id: string;
};

const emptyForm: FormValues = {
  name: "",
  type: "CASH",
  initial_balance: "",
  color: "#16a34a",
  icon: "wallet",
  is_default: false,
  parent_wallet_id: "",
};

export function WalletForm({ onSuccess, wallet, defaultParentWalletId }: Props) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormValues>(emptyForm);

  // Only wallets that could legally become this wallet's parent: no parent
  // of their own (single level) and, when editing, not the wallet itself.
  const { data: wallets = [] } = useQuery({ queryKey: ["wallets"], queryFn: () => getWallets(), staleTime: 15_000 });
  const eligibleParents = wallets.filter((candidate) => !candidate.parent_wallet_id && candidate.id !== wallet?.id);

  const selectedParent = wallets.find((candidate) => candidate.id === form.parent_wallet_id) ?? null;
  const isNewParentLink = form.parent_wallet_id !== "" && form.parent_wallet_id !== (wallet?.parent_wallet_id ?? "");
  const selectedParentHasChildren = wallets.some(
    (candidate) => candidate.parent_wallet_id === form.parent_wallet_id && candidate.id !== wallet?.id,
  );
  // Only the very first sub-wallet of a still-funded parent needs the
  // dedicated conversion flow -- once a parent has any child, its own
  // balance is already 0 (see convert_wallet_to_parent), so later siblings
  // are ordinary wallet_create calls with parent_wallet_id set.
  const selectedParentNeedsConversion =
    isNewParentLink && !!selectedParent && Number(selectedParent.balance ?? 0) !== 0 && !selectedParentHasChildren;

  // Revue pré-merge : un wallet déjà converti en parent (a des sous-wallets)
  // a son solde propre ramené à 0 par compensation algébrique côté RPC
  // (convert_wallet_to_parent), jamais parce qu'initial_balance vaut 0.
  // Ce champ est toujours renvoyé par save() ci-dessous, même sur un
  // simple renommage -- le désactiver ici évite de jamais heurter le
  // garde-fou ajouté à wallet_update (20260905100000) dans le flux normal.
  const walletHasChildren = !!wallet && wallets.some((candidate) => candidate.parent_wallet_id === wallet.id);

  useEffect(() => {
    setForm(
      wallet
        ? {
            name: wallet.name ?? "",
            type: wallet.type ?? "CASH",
            initial_balance: wallet.initial_balance?.toString() ?? "",
            color: wallet.color ?? "#16a34a",
            icon: wallet.icon ?? "wallet",
            is_default: wallet.is_default ?? false,
            parent_wallet_id: wallet.parent_wallet_id ?? "",
          }
        : { ...emptyForm, parent_wallet_id: defaultParentWalletId ?? "" },
    );
  }, [wallet, defaultParentWalletId]);

  async function save() {
    if (!form.name.trim()) {
      toast.error("Le nom du wallet est obligatoire.");
      return;
    }
    const initialBalance = Number(form.initial_balance || 0);
    if (!Number.isFinite(initialBalance)) {
      toast.error("Le solde d'ouverture doit être un nombre valide.");
      return;
    }
    if (selectedParentNeedsConversion) {
      toast.error("Ce wallet parent a encore un solde direct : utilisez « Convertir en wallet parent » depuis sa fiche avant de lui créer un premier sous-wallet.");
      return;
    }

    try {
      setLoading(true);
      const values = {
        name: form.name.trim(),
        type: form.type,
        initial_balance: initialBalance,
        color: form.color,
        icon: form.icon,
        is_default: form.is_default,
        parent_wallet_id: form.parent_wallet_id || null,
      };
      if (wallet) await updateWallet({ data: { id: wallet.id, values } });
      else await createWallet({ data: values });
      toast.success(wallet ? "Wallet mis à jour." : "Wallet créé.");
      setForm(emptyForm);
      onSuccess();
    } catch (error) {
      console.error(error);
      notifyMutationError(error, "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="wallet-name">Nom du wallet *</Label>
          <Input
            id="wallet-name"
            placeholder="Wave Business"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="wallet-type">Type</Label>
          <Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value })}>
            <SelectTrigger id="wallet-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="CASH">Espèces</SelectItem>
              <SelectItem value="JEKO">Jèko</SelectItem>
              <SelectItem value="WAVE">Wave</SelectItem>
              <SelectItem value="ORANGE_MONEY">Orange Money</SelectItem>
              <SelectItem value="MTN_MOMO">MTN MoMo</SelectItem>
              <SelectItem value="BANK">Banque</SelectItem>
              <SelectItem value="SAVINGS">Épargne</SelectItem>
              <SelectItem value="ASSET">Actif</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="wallet-parent">Wallet parent</Label>
          <Select
            value={form.parent_wallet_id || "NONE"}
            onValueChange={(value) => setForm({ ...form, parent_wallet_id: value === "NONE" ? "" : value })}
          >
            <SelectTrigger id="wallet-parent"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">Aucun (wallet autonome)</SelectItem>
              {eligibleParents.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedParentNeedsConversion ? (
            <p className="mt-1 text-xs font-medium text-warning-foreground">
              Ce wallet a encore un solde direct de {(selectedParent?.balance ?? 0).toLocaleString("fr-FR")} FCFA. Utilisez l'action « Convertir en wallet parent » depuis sa fiche pour répartir ce solde avant de créer un premier sous-wallet.
            </p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="wallet-initial-balance">Solde d'ouverture (FCFA)</Label>
          <Input
            id="wallet-initial-balance"
            type="number"
            placeholder="0"
            value={form.initial_balance}
            disabled={walletHasChildren}
            onChange={(event) => setForm({ ...form, initial_balance: event.target.value })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {walletHasChildren
              ? "Ce wallet est un wallet parent consolidateur : son solde propre reste à 0 par construction, son solde d'ouverture ne peut plus être modifié. Ajustez le solde de ses sous-wallets si nécessaire."
              : "Il sera conservé et ajouté aux opérations futures."}
          </p>
        </div>
        <div>
          <Label htmlFor="wallet-color">Couleur</Label>
          <Input
            id="wallet-color"
            type="color"
            value={form.color}
            onChange={(event) => setForm({ ...form, color: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="wallet-icon">Icône</Label>
          <Input
            id="wallet-icon"
            placeholder="wallet"
            value={form.icon}
            onChange={(event) => setForm({ ...form, icon: event.target.value })}
          />
        </div>
        <label className="flex items-center gap-3 pt-7">
          <input
            type="checkbox"
            checked={form.is_default}
            onChange={(event) => setForm({ ...form, is_default: event.target.checked })}
          />
          <span className="text-sm font-medium">Définir comme wallet principal</span>
        </label>
      </div>
      <Button className="w-full" disabled={loading || selectedParentNeedsConversion} onClick={save}>
        {loading ? "Enregistrement…" : wallet ? "Mettre à jour le wallet" : "Créer le wallet"}
      </Button>
    </div>
  );
}
