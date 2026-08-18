import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  const movementGuidance = movementType === "PURCHASE"
    ? "Réception fournisseur : la quantité entre en stock, une dépense est créée et le wallet sélectionné est débité."
    : movementType === "SALE"
      ? "Réservé aux ventes hors caisse. Pour une vente au comptoir, passez par Commerce → Ouvrir la caisse afin d’éviter toute double recette."
      : "Mouvement physique uniquement : aucun wallet et aucune écriture financière ne seront créés.";
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
      <div className={`rounded-xl border px-4 py-3 text-sm leading-6 ${movementType === "SALE" ? "border-warning/25 bg-warning/[0.08] text-warning" : "border-primary/15 bg-primary/[0.06] text-muted-foreground"}`}>
        <p className="font-semibold text-foreground">{movementType === "PURCHASE" ? "Achat et entrée en stock" : movementType === "SALE" ? "Vente hors caisse" : "Mouvement de stock"}</p>
        <p className="mt-1">{movementGuidance}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="stock-movement-item">Article</Label>
          <Select value={itemId || undefined} onValueChange={setItemId}>
            <SelectTrigger id="stock-movement-item">
              <SelectValue placeholder="Sélectionner un article" />
            </SelectTrigger>
            <SelectContent>
              {stocks.map((stock) => <SelectItem key={stock.id} value={stock.id}>{stock.nom}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="stock-movement-type">Type de mouvement</Label>
          <Select value={movementType} onValueChange={(value) => setMovementType(value as keyof typeof movementLabels)}>
            <SelectTrigger id="stock-movement-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(movementLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
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
              <Label>{movementType === "PURCHASE" ? "Prix d’achat unitaire (FCFA)" : "Prix de vente unitaire (FCFA)"}</Label>
              <Input type="number" min="0" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="stock-movement-wallet">{movementType === "PURCHASE" ? "Wallet débité" : "Wallet crédité"}</Label>
              <Select value={walletId || undefined} onValueChange={setWalletId}>
                <SelectTrigger id="stock-movement-wallet">
                  <SelectValue placeholder="Sélectionner un wallet" />
                </SelectTrigger>
                <SelectContent>
                  {wallets.map((wallet) => <SelectItem key={wallet.id} value={wallet.id}>{wallet.name}</SelectItem>)}
                </SelectContent>
              </Select>
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
