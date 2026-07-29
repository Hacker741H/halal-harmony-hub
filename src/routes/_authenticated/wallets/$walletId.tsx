import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowDownCircle,
  ArrowUpCircle,
  RefreshCw,
  Repeat,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getFinanceOperationsByWallet } from "@/lib/finance.functions";
import { getWallet } from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/wallets/$walletId")({
  component: WalletDetailsPage,
});
const format = (value: number) => `${value.toLocaleString("fr-FR")} FCFA`;
function WalletDetailsPage() {
  const { walletId } = Route.useParams();
  const walletQuery = useQuery({
    queryKey: ["wallet", walletId],
    queryFn: () => getWallet({ data: walletId }),
  });
  const operationsQuery = useQuery({
    queryKey: ["wallet-operations", walletId],
    queryFn: () => getFinanceOperationsByWallet({ data: walletId }),
  });
  if (walletQuery.isPending) return <p className="text-muted-foreground">Chargement du wallet…</p>;
  const wallet = walletQuery.data;
  if (!wallet)
    return (
      <Card>
        <CardContent className="p-6">Wallet introuvable.</CardContent>
      </Card>
    );
  const operations = operationsQuery.data ?? [];
  const isWave = wallet.type === "WAVE" || /wave/i.test(wallet.name);
  const incoming = operations
    .filter(
      (op) =>
        (op.wallet_id === walletId && ["REVENUE", "DEPOSIT"].includes(op.type)) ||
        (op.destination_wallet_id === walletId && op.type === "TRANSFER"),
    )
    .reduce((sum, op) => sum + Number(op.amount), 0);
  const outgoing = operations
    .filter((op) => op.wallet_id === walletId && ["EXPENSE", "TRANSFER"].includes(op.type))
    .reduce((sum, op) => sum + Number(op.amount), 0);
  return (
    <div className="space-y-6 p-6 lg:p-8">
      <Button asChild variant="ghost">
        <Link to="/wallets">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Retour aux wallets
        </Link>
      </Button>
      <section
        className={`overflow-hidden rounded-[2rem] p-7 text-white ${isWave ? "bg-[#0b2430]" : "bg-emerald-950"}`}
        style={{ borderTop: `6px solid ${isWave ? "#1cc7f4" : wallet.color || "#16a34a"}` }}
      >
        <p className="flex items-center gap-2 text-sm text-emerald-200">
          <WalletCards className="h-4 w-4" />
          {isWave ? "Wave Business" : wallet.type}
        </p>
        <h1 className="mt-2 text-3xl font-bold">{wallet.name}</h1>
        <p className="mt-6 text-sm text-emerald-200">Solde disponible</p>
        <p className="mt-1 text-4xl font-bold">{format(Number(wallet.balance ?? 0))}</p>
      </section>
      {isWave && (
        <section className="grid gap-4 rounded-3xl border border-sky-100 bg-sky-50/70 p-5 md:grid-cols-3">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[#1cc7f4] p-2">
              <img src="/wave-logo.svg" alt="Wave" className="h-8 w-8" />
            </div>
            <div>
              <p className="font-semibold text-slate-900">Wave Business</p>
              <p className="text-sm text-slate-600">Connexion API en attente</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <RefreshCw className="h-4 w-4 text-sky-600" />
            Dernière synchronisation : non disponible
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <ShieldCheck className="h-4 w-4 text-sky-600" />
            Clé API requise et stockée côté serveur
          </div>
        </section>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Summary
          icon={<ArrowUpCircle className="text-emerald-600" />}
          label="Entrées"
          value={incoming}
        />
        <Summary
          icon={<ArrowDownCircle className="text-rose-600" />}
          label="Sorties"
          value={outgoing}
        />
        <Summary
          icon={<Repeat className="text-sky-600" />}
          label="Opérations"
          value={operations.length}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Historique des opérations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {operationsQuery.isPending ? (
            <p className="text-muted-foreground">Chargement…</p>
          ) : operations.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              Aucune opération pour ce wallet.
            </p>
          ) : (
            operations.map((operation) => (
              <div
                key={operation.id}
                className="flex flex-col justify-between gap-2 rounded-xl border p-4 sm:flex-row sm:items-center"
              >
                <div>
                  <p className="font-medium">
                    {operation.category || operation.description || operation.type}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {operation.operation_date} · {operation.type}
                    {operation.destination_wallet_id === walletId ? " · transfert reçu" : ""}
                  </p>
                </div>
                <p
                  className={`font-semibold ${operation.wallet_id === walletId && ["EXPENSE", "TRANSFER"].includes(operation.type) ? "text-rose-600" : "text-emerald-700"}`}
                >
                  {operation.wallet_id === walletId &&
                  ["EXPENSE", "TRANSFER"].includes(operation.type)
                    ? "−"
                    : "+"}
                  {format(Number(operation.amount))}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function Summary({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <p className="mt-3 text-2xl font-bold">{format(value)}</p>
      </CardContent>
    </Card>
  );
}
