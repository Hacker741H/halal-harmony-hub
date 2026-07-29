import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createSalaryPayment,
  getSalaryPaymentPeople,
} from "@/lib/salary-payments.functions";
import { getWallets } from "@/lib/wallet.functions";

type Props = {
  onSuccess: () => void;
};

const currentPeriod = `${new Date().toISOString().slice(0, 7)}-01`;

export function SalaryPaymentForm({ onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [walletId, setWalletId] = useState("");
  const [periodStart, setPeriodStart] = useState(currentPeriod);
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [isPartial, setIsPartial] = useState(false);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");

  const { data: people = [] } = useQuery({
    queryKey: ["salary-payment-people"],
    queryFn: () => getSalaryPaymentPeople(),
  });
  const { data: wallets = [] } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => getWallets(),
  });

  const selectedDriver = useMemo(
    () => people.find((person) => person.driver_id === driverId) ?? null,
    [driverId, people],
  );

  async function save() {
    const numericAmount = Number(amount);
    const resolvedEmployeeId = selectedDriver?.employee_id ?? employeeId;

    if (!resolvedEmployeeId || !walletId || !periodStart || !paidAt || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      alert("Renseignez la personne, la période, le wallet et un montant positif.");
      return;
    }

    try {
      setLoading(true);
      await createSalaryPayment({
        data: {
          employee_id: resolvedEmployeeId,
          driver_id: driverId || null,
          contract_id: null,
          wallet_id: walletId,
          period_start: periodStart,
          paid_at: paidAt,
          amount: numericAmount,
          is_partial: isPartial,
          reference: reference.trim() || null,
          description: description.trim() || null,
        },
      });
      onSuccess();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Impossible d'enregistrer le paiement de salaire.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Cette validation crée automatiquement la dépense de salaire dans le journal financier.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Employé</Label>
          <select className="w-full rounded-md border px-3 py-2" value={employeeId} disabled={Boolean(driverId)} onChange={(event) => setEmployeeId(event.target.value)}>
            <option value="">Sélectionner un employé</option>
            {people.map((person) => <option key={person.employee_id} value={person.employee_id}>{person.nom} {person.prenom ?? ""}</option>)}
          </select>
        </div>
        <div>
          <Label>Chauffeur (facultatif)</Label>
          <select className="w-full rounded-md border px-3 py-2" value={driverId} onChange={(event) => setDriverId(event.target.value)}>
            <option value="">Paiement employé</option>
            {people.filter((person) => person.driver_id).map((person) => <option key={person.driver_id} value={person.driver_id ?? ""}>{person.nom} {person.prenom ?? ""}</option>)}
          </select>
        </div>
        <div>
          <Label>Période concernée</Label>
          <Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
        </div>
        <div>
          <Label>Date de paiement</Label>
          <Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
        </div>
        <div>
          <Label>Montant (FCFA)</Label>
          <Input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
        <div>
          <Label>Wallet</Label>
          <select className="w-full rounded-md border px-3 py-2" value={walletId} onChange={(event) => setWalletId(event.target.value)}>
            <option value="">Sélectionner un wallet</option>
            {wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPartial} onChange={(event) => setIsPartial(event.target.checked)} />
            Paiement partiel (plusieurs paiements autorisés pour la période)
          </label>
        </div>
        <div className="md:col-span-2">
          <Label>Référence</Label>
          <Input value={reference} onChange={(event) => setReference(event.target.value)} />
        </div>
      </div>
      <div>
        <Label>Description</Label>
        <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
      </div>
      <Button className="w-full" disabled={loading} onClick={save}>
        {loading ? "Enregistrement..." : "Valider le paiement de salaire"}
      </Button>
    </div>
  );
}
