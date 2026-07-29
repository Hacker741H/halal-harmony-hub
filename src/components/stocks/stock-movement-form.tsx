import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Stock } from "@/lib/stocks.functions";
import { createStockMovement } from "@/lib/stock-movements.functions";
import { getWallets } from "@/lib/wallet.functions";

type Props = {
  stocks: Stock[];
  onSuccess: () => void;
};

const movementLabels = {
  PURCHASE: "Achat fournisseur",
  SALE: "Vente client",
  IN: "Entrée gratuite",
  OUT: "Sortie interne",
  ADJUSTMENT_IN: "Ajustement positif",
  ADJUSTMENT_OUT: "Ajustement négatif",
  LOSS: "Perte",
  TRANSFER: "Transfert interne",
} as const;

export function StockMovementForm({ stocks, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [itemId, setItemId] = useState("");
  const [movementType, setMovementType] = useState<keyof typeof movementLabels>("PURCHASE");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [walletId, setWalletId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplier, setSupplier] = useState("");
  const [client, setClient] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");

  const { data: wallets = [] } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => getWallets(),
  });

  const isFinancial = movementType === "PURCHASE" || movementType === "SALE";
  const selectedItem = useMemo(
    () => stocks.find((stock) => stock.id === itemId) ?? null,
    [itemId, stocks],
  );

  async function save() {
    const numericQuantity = Number(quantity);
    const numericUnitPrice = unitPrice ? Number(unitPrice) : null;

    if (!itemId || !Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      alert("Sélectionnez un article et une quantité positive.");
      return;
    }
    if (isFinancial && (!walletId || numericUnitPrice === null || numericUnitPrice <= 0)) {
      alert("Un achat ou une vente exige un wallet et un prix unitaire positif.");
      return;
    }

    try {
      setLoading(true);
      await createStockMovement({
        data: {
          inventory_item_id: itemId,
          movement_type: movementType,
          quantity: numericQuantity,
          unit_price: isFinancial ? numericUnitPrice : null,
          wallet_id: isFinancial ? walletId : null,
          movement_date: date,
          supplier: supplier.trim() || null,
          client: client.trim() || null,
          reference: reference.trim() || null,
          description: description.trim() || null,
        },
      });
      onSuccess();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Impossible d'enregistrer le mouvement.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Article</Label>
          <select className="w-full rounded-md border px-3 py-2" value={itemId} onChange={(event) => setItemId(event.target.value)}>
            <option value="">Sélectionner un article</option>
            {stocks.map((stock) => <option key={stock.id} value={stock.id}>{stock.nom}</option>)}
          </select>
        </div>
        <div>
          <Label>Type de mouvement</Label>
          <select className="w-full rounded-md border px-3 py-2" value={movementType} onChange={(event) => setMovementType(event.target.value as keyof typeof movementLabels)}>
            {Object.entries(movementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <Label>Quantité {selectedItem?.unite ? `(${selectedItem.unite})` : ""}</Label>
          <Input type="number" min="0.01" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </div>
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        {isFinancial && (
          <>
            <div>
              <Label>Prix unitaire (FCFA)</Label>
              <Input type="number" min="0" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} />
            </div>
            <div>
              <Label>Wallet</Label>
              <select className="w-full rounded-md border px-3 py-2" value={walletId} onChange={(event) => setWalletId(event.target.value)}>
                <option value="">Sélectionner un wallet</option>
                {wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Une {movementType === "PURCHASE" ? "dépense" : "recette"} sera créée automatiquement.
              </p>
            </div>
          </>
        )}
        <div>
          <Label>Fournisseur</Label>
          <Input value={supplier} onChange={(event) => setSupplier(event.target.value)} />
        </div>
        <div>
          <Label>Client</Label>
          <Input value={client} onChange={(event) => setClient(event.target.value)} />
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
        {loading ? "Enregistrement..." : "Enregistrer le mouvement"}
      </Button>
    </div>
  );
}
