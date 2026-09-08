import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WalletSelect } from "@/components/selects/entity-selects";
import {
  createSalaryPayment,
  getSalaryPaymentPeople,
} from "@/lib/salary-payments.functions";
import { getWallets } from "@/lib/wallet.functions";
import { notifyMutationError } from "@/lib/notify-mutation-error";

type Props = {
  onSuccess: () => void;
  initialDriverId?: string;
  initialPeriodStart?: string;
  defaultDescription?: string;
};

const currentPeriod = `${new Date().toISOString().slice(0, 7)}-01`;

export function SalaryPaymentForm({
  onSuccess,
  initialDriverId,
  initialPeriodStart,
  defaultDescription,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [driverId, setDriverId] = useState(initialDriverId ?? "");
  const [walletId, setWalletId] = useState("");
  const [periodStart, setPeriodStart] = useState(initialPeriodStart ?? currentPeriod);
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [isPartial, setIsPartial] = useState(false);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState(defaultDescription ?? "");

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
      toast.error("Renseignez la personne, la période, le wallet et un montant positif.");
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
      toast.success("Paiement de salaire enregistré.");
      onSuccess();
    } catch (error) {
      console.error(error);
      notifyMutationError(error, "Impossible d'enregistrer le paiement de salaire.");
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
          <Label htmlFor="salary-employee">Employé</Label>
          <Select value={employeeId || undefined} disabled={Boolean(driverId)} onValueChange={setEmployeeId}>
            <SelectTrigger id="salary-employee">
              <SelectValue placeholder="Sélectionner un employé" />
            </SelectTrigger>
            <SelectContent>
              {people.map((person) => <SelectItem key={person.employee_id} value={person.employee_id}>{person.nom} {person.prenom ?? ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="salary-driver">Chauffeur (facultatif)</Label>
          <Select
            value={driverId || "NONE"}
            disabled={Boolean(initialDriverId)}
            onValueChange={(value) => setDriverId(value === "NONE" ? "" : value)}
          >
            <SelectTrigger id="salary-driver"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">Paiement employé</SelectItem>
              {people.filter((person) => person.driver_id).map((person) => <SelectItem key={person.driver_id} value={person.driver_id ?? ""}>{person.nom} {person.prenom ?? ""}</SelectItem>)}
            </SelectContent>
          </Select>
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
          <Label htmlFor="salary-wallet">Wallet</Label>
          <WalletSelect
            id="salary-wallet"
            value={walletId}
            onValueChange={setWalletId}
            placeholder="Sélectionner un wallet"
          />
        </div>
        <div className="md:col-span-2 flex items-center gap-2">
          <Checkbox id="salary-partial" checked={isPartial} onCheckedChange={(checked) => setIsPartial(checked === true)} />
          <Label htmlFor="salary-partial" className="text-sm font-normal">Paiement partiel (plusieurs paiements autorisés pour la période)</Label>
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
