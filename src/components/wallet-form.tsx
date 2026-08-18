import { useEffect, useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWallet, updateWallet, type Wallet } from "@/lib/wallet.functions";

type Props = { onSuccess: () => void; wallet?: Wallet | null };

type FormValues = {
  name: string;
  type: string;
  initial_balance: string;
  color: string;
  icon: string;
  is_default: boolean;
};

const emptyForm: FormValues = {
  name: "",
  type: "CASH",
  initial_balance: "",
  color: "#16a34a",
  icon: "wallet",
  is_default: false,
};

export function WalletForm({ onSuccess, wallet }: Props) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormValues>(emptyForm);

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
          }
        : emptyForm,
    );
  }, [wallet]);

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

    try {
      setLoading(true);
      const values = {
        name: form.name.trim(),
        type: form.type,
        initial_balance: initialBalance,
        color: form.color,
        icon: form.icon,
        is_default: form.is_default,
      };
      if (wallet) await updateWallet({ data: { id: wallet.id, values } });
      else await createWallet({ data: values });
      setForm(emptyForm);
      onSuccess();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Nom du wallet *</Label>
          <Input
            placeholder="Wave Business"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div>
          <Label>Type</Label>
          <select
            className="w-full rounded-md border px-3 py-2"
            value={form.type}
            onChange={(event) => setForm({ ...form, type: event.target.value })}
          >
            <option value="CASH">Espèces</option>
            <option value="JEKO">Jèko</option>
            <option value="WAVE">Wave</option>
            <option value="ORANGE_MONEY">Orange Money</option>
            <option value="MTN_MOMO">MTN MoMo</option>
            <option value="BANK">Banque</option>
            <option value="SAVINGS">Épargne</option>
            <option value="ASSET">Actif</option>
          </select>
        </div>
        <div>
          <Label>Solde d'ouverture (FCFA)</Label>
          <Input
            type="number"
            placeholder="0"
            value={form.initial_balance}
            onChange={(event) => setForm({ ...form, initial_balance: event.target.value })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Il sera conservé et ajouté aux opérations futures.
          </p>
        </div>
        <div>
          <Label>Couleur</Label>
          <Input
            type="color"
            value={form.color}
            onChange={(event) => setForm({ ...form, color: event.target.value })}
          />
        </div>
        <div>
          <Label>Icône</Label>
          <Input
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
      <Button className="w-full" disabled={loading} onClick={save}>
        {loading ? "Enregistrement…" : wallet ? "Mettre à jour le wallet" : "Créer le wallet"}
      </Button>
    </div>
  );
}
