import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";

import { SupplierSelect } from "@/components/selects/entity-selects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCommercePosLocations } from "@/lib/commerce-pos.functions";
import { createPurchase } from "@/lib/purchases.functions";
import { getStocks } from "@/lib/stocks.functions";

type LineForm = { key: string; inventoryItemId: string; quantity: string; unitCost: string };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine(index: number): LineForm {
  return { key: `line-${index}`, inventoryItemId: "", quantity: "1", unitCost: "" };
}

function formatAmount(value: number) {
  return `${value.toLocaleString("fr-FR")} FCFA`;
}

export function PurchaseForm({ onSuccess }: { onSuccess: (purchaseId: string) => void }) {
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(today());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineForm[]>([emptyLine(1)]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const locationsQuery = useQuery({ queryKey: ["commerce-pos-locations"], queryFn: () => getCommercePosLocations() });
  const itemsQuery = useQuery({ queryKey: ["stocks"], queryFn: () => getStocks() });
  const items = itemsQuery.data ?? [];

  const total = useMemo(
    () => lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0),
    [lines],
  );

  function updateLine(key: string, patch: Partial<LineForm>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function submit() {
    setError(null);
    if (!supplierId) { setError("Le fournisseur est obligatoire."); return; }
    if (!locationId) { setError("Le magasin est obligatoire."); return; }
    const parsedLines = lines.map((line) => ({
      inventory_item_id: line.inventoryItemId,
      quantity: Number(line.quantity),
      unit_cost: Number(line.unitCost),
    }));
    if (parsedLines.some((line) => !line.inventory_item_id || !(line.quantity > 0) || !(line.unit_cost > 0))) {
      setError("Chaque ligne doit avoir un article, une quantité et un coût unitaire valides.");
      return;
    }
    setSaving(true);
    try {
      const purchase = await createPurchase({
        data: {
          supplier_id: supplierId,
          business_location_id: locationId,
          purchase_date: purchaseDate,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
          lines: parsedLines,
        },
      });
      onSuccess(purchase.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Impossible d’enregistrer l’achat.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label>Fournisseur</Label><SupplierSelect value={supplierId} onValueChange={setSupplierId} placeholder="Sélectionner un fournisseur" /></div>
        <div className="space-y-2">
          <Label>Magasin</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger><SelectValue placeholder="Sélectionner un magasin" /></SelectTrigger>
            <SelectContent>{(locationsQuery.data ?? []).map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2"><Label htmlFor="purchase-date">Date d’achat</Label><Input id="purchase-date" type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="purchase-reference">Référence / document</Label><Input id="purchase-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Bon de livraison, facture…" /></div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between"><p className="text-sm font-medium">Lignes d’achat</p><Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, emptyLine(current.length + 1)])}><Plus className="mr-1 h-4 w-4" />Ajouter une ligne</Button></div>
        {lines.map((line) => (
          <div key={line.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px_130px_auto] sm:items-end">
            <div className="space-y-1">
              <Label className="text-xs">Article</Label>
              <Select value={line.inventoryItemId} onValueChange={(value) => updateLine(line.key, { inventoryItemId: value })}>
                <SelectTrigger><SelectValue placeholder="Sélectionner un article" /></SelectTrigger>
                <SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.nom}{item.sku ? ` (${item.sku})` : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Quantité</Label><Input type="number" min="0" step="0.001" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Coût unitaire</Label><Input type="number" min="0" step="1" value={line.unitCost} onChange={(event) => updateLine(line.key, { unitCost: event.target.value })} /></div>
            <Button type="button" variant="ghost" size="icon" disabled={lines.length <= 1} onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))} aria-label="Retirer la ligne"><Minus className="h-4 w-4" /></Button>
          </div>
        ))}
        <p className="text-right text-sm font-semibold">Total : {formatAmount(total)}</p>
      </div>

      <div className="space-y-2"><Label htmlFor="purchase-notes">Notes</Label><Textarea id="purchase-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>

      <div className="flex justify-end"><Button type="button" disabled={saving} onClick={() => { void submit(); }}>{saving ? "Enregistrement…" : "Enregistrer l’achat"}</Button></div>
    </div>
  );
}
