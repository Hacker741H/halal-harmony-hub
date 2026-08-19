import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCommercePosLocations } from "@/lib/commerce-pos.functions";
import { createStockTransfer } from "@/lib/stock-transfers.functions";
import { getStocks } from "@/lib/stocks.functions";

type LineForm = { key: string; inventoryItemId: string; quantity: string };

function emptyLine(index: number): LineForm {
  return { key: `line-${index}`, inventoryItemId: "", quantity: "1" };
}

export function StockTransferForm({ onSuccess }: { onSuccess: (transferId: string) => void }) {
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineForm[]>([emptyLine(1)]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const locationsQuery = useQuery({ queryKey: ["commerce-pos-locations"], queryFn: () => getCommercePosLocations() });
  const itemsQuery = useQuery({ queryKey: ["stocks"], queryFn: () => getStocks() });
  const items = itemsQuery.data ?? [];
  const locations = locationsQuery.data ?? [];

  function updateLine(key: string, patch: Partial<LineForm>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function submit() {
    setError(null);
    if (!sourceLocationId) { setError("Le magasin source est obligatoire."); return; }
    if (!destinationLocationId) { setError("Le magasin destination est obligatoire."); return; }
    if (sourceLocationId === destinationLocationId) { setError("Les magasins source et destination doivent être différents."); return; }
    const parsedLines = lines.map((line) => ({ inventory_item_id: line.inventoryItemId, quantity: Number(line.quantity) }));
    if (parsedLines.some((line) => !line.inventory_item_id || !(line.quantity > 0))) {
      setError("Chaque ligne doit avoir un article et une quantité valide.");
      return;
    }
    setSaving(true);
    try {
      const transfer = await createStockTransfer({
        data: {
          source_location_id: sourceLocationId,
          destination_location_id: destinationLocationId,
          notes: notes.trim() || null,
          lines: parsedLines,
        },
      });
      toast.success("Transfert créé.");
      onSuccess(transfer.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Impossible de créer le transfert.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Magasin source</Label>
          <Select value={sourceLocationId} onValueChange={setSourceLocationId}>
            <SelectTrigger><SelectValue placeholder="Sélectionner le magasin source" /></SelectTrigger>
            <SelectContent>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Magasin destination</Label>
          <Select value={destinationLocationId} onValueChange={setDestinationLocationId}>
            <SelectTrigger><SelectValue placeholder="Sélectionner le magasin destination" /></SelectTrigger>
            <SelectContent>{locations.filter((location) => location.id !== sourceLocationId).map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between"><p className="text-sm font-medium">Articles à transférer</p><Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, emptyLine(current.length + 1)])}><Plus className="mr-1 h-4 w-4" />Ajouter une ligne</Button></div>
        {lines.map((line) => (
          <div key={line.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end">
            <div className="space-y-1">
              <Label className="text-xs">Article</Label>
              <Select value={line.inventoryItemId} onValueChange={(value) => updateLine(line.key, { inventoryItemId: value })}>
                <SelectTrigger><SelectValue placeholder="Sélectionner un article" /></SelectTrigger>
                <SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.nom}{item.sku ? ` (${item.sku})` : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Quantité</Label><Input type="number" min="0" step="0.001" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></div>
            <Button type="button" variant="ghost" size="icon" disabled={lines.length <= 1} onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))} aria-label="Retirer la ligne"><Minus className="h-4 w-4" /></Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Le coût de chaque article sera figé à celui du magasin source au moment de l’expédition.</p>
      </div>

      <div className="space-y-2"><Label htmlFor="transfer-notes">Notes</Label><Textarea id="transfer-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>

      <div className="flex justify-end"><Button type="button" disabled={saving} onClick={() => { void submit(); }}>{saving ? "Création…" : "Créer le transfert"}</Button></div>
    </div>
  );
}
