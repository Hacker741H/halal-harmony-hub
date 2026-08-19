import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";

import { ClientSelect, FarmSelect } from "@/components/selects/entity-selects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCommercePosLocations } from "@/lib/commerce-pos.functions";
import { formatXOF } from "@/lib/format";
import {
  createCommercialSale,
  updateCommercialSale,
  type CommercialSale,
  type CommercialSaleLine,
  type CommercialSaleValues,
} from "@/lib/commercial-sales.functions";
import { getStocks } from "@/lib/stocks.functions";

type LineForm = {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  inventoryItemId: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function lineFromValues(line: CommercialSaleLine, index: number): LineForm {
  return {
    key: `line-${index + 1}`,
    description: line.description,
    quantity: String(line.quantity),
    unit: line.unit,
    unitPrice: String(line.unit_price),
    inventoryItemId: line.inventory_item_id ?? "",
  };
}

function emptyLine(index: number): LineForm {
  return { key: `line-${index}`, description: "", quantity: "1", unit: "UNITE", unitPrice: "", inventoryItemId: "" };
}

function toNullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function CommercialSaleForm({
  sale,
  lines: initialLines,
  onSuccess,
}: {
  sale?: CommercialSale;
  lines?: CommercialSaleLine[];
  onSuccess: (saleId: string) => void;
}) {
  const [clientId, setClientId] = useState(sale?.client_id ?? "");
  const [businessLocationId, setBusinessLocationId] = useState(sale?.business_location_id ?? "");
  const [saleDate, setSaleDate] = useState(sale?.sale_date ?? today());
  const [reference, setReference] = useState(sale?.reference ?? "");
  const [notes, setNotes] = useState(sale?.notes ?? "");
  const [linkFarm, setLinkFarm] = useState(Boolean(sale?.farm_id));
  const [farmId, setFarmId] = useState(sale?.farm_id ?? "");
  const [lineCount, setLineCount] = useState(Math.max(2, initialLines?.length ?? 1));
  const [lines, setLines] = useState<LineForm[]>(
    initialLines?.length ? initialLines.map(lineFromValues) : [emptyLine(1)],
  );
  const [submitting, setSubmitting] = useState(false);

  const locationsQuery = useQuery({ queryKey: ["commerce-pos-locations"], queryFn: () => getCommercePosLocations() });
  const itemsQuery = useQuery({ queryKey: ["stocks"], queryFn: () => getStocks() });
  const items = itemsQuery.data ?? [];
  const hasStockLine = lines.some((line) => line.inventoryItemId);

  function updateLine(key: string, field: keyof Omit<LineForm, "key">, value: string) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line));
  }

  function selectLineItem(key: string, itemId: string) {
    const item = items.find((entry) => entry.id === itemId);
    setLines((current) => current.map((line) => line.key === key ? {
      ...line,
      inventoryItemId: itemId,
      description: item ? item.nom : line.description,
      unit: item?.unite ?? line.unit,
    } : line));
  }

  function addLine() {
    const next = lineCount + 1;
    setLineCount(next);
    setLines((current) => [...current, emptyLine(next)]);
  }

  function removeLine(key: string) {
    setLines((current) => current.length > 1 ? current.filter((line) => line.key !== key) : current);
  }

  const estimatedTotal = lines.reduce((sum, line) => {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    return sum + (Number.isFinite(quantity) && Number.isFinite(unitPrice) ? quantity * unitPrice : 0);
  }, 0);

  async function submit() {
    const values: CommercialSaleValues = {
      client_id: clientId,
      farm_id: linkFarm && farmId ? farmId : null,
      business_location_id: businessLocationId || null,
      sale_date: saleDate,
      reference: toNullable(reference),
      notes: toNullable(notes),
      lines: lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unit: line.unit,
        unit_price: Number(line.unitPrice),
        inventory_item_id: line.inventoryItemId || null,
        harvest_id: null,
        farm_id: linkFarm && farmId ? farmId : null,
      })),
    };

    if (!clientId) {
      toast.error("Sélectionnez le client de la vente.");
      return;
    }
    if (!saleDate) {
      toast.error("Indiquez la date de vente.");
      return;
    }
    if (hasStockLine && !businessLocationId) {
      toast.error("Un magasin est requis dès qu’une ligne référence un article de stock.");
      return;
    }

    setSubmitting(true);
    try {
      const saved = sale
        ? await updateCommercialSale({ data: { id: sale.id, values } })
        : await createCommercialSale({ data: values });
      toast.success(sale ? "Vente mise à jour." : "Vente créée en brouillon.");
      onSuccess(saved.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d’enregistrer la vente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label>Client <span className="text-destructive">*</span></Label>
          <ClientSelect value={clientId} onValueChange={setClientId} placeholder="Sélectionner un client" disabled={submitting} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="commercial-sale-date">Date de vente <span className="text-destructive">*</span></Label>
          <Input id="commercial-sale-date" type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} disabled={submitting} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="commercial-sale-reference">Référence</Label>
          <Input id="commercial-sale-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Bon, commande, référence…" disabled={submitting} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Magasin {hasStockLine ? <span className="text-destructive">*</span> : null}</Label>
          <Select value={businessLocationId} onValueChange={setBusinessLocationId} disabled={submitting}>
            <SelectTrigger><SelectValue placeholder="Sélectionner un magasin" /></SelectTrigger>
            <SelectContent>{(locationsQuery.data ?? []).map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-caption text-muted-foreground">Obligatoire dès qu’une ligne référence un article de stock : la confirmation en dépend pour sortir la quantité vendue du bon magasin.</p>
        </div>
      </div>

      <div className="rounded-xl border border-border/75 bg-surface-sunken/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-label text-foreground">Origine agricole</p>
            <p className="mt-1 text-caption">Optionnelle : associez la vente à une exploitation existante sans dupliquer ses données.</p>
          </div>
          <Button type="button" variant={linkFarm ? "secondary" : "outline"} size="sm" onClick={() => setLinkFarm((value) => !value)} disabled={submitting}>
            {linkFarm ? "Exploitation associée" : "Associer une exploitation"}
          </Button>
        </div>
        {linkFarm ? <div className="mt-4 space-y-2"><Label>Exploitation</Label><FarmSelect value={farmId} onValueChange={setFarmId} placeholder="Sélectionner une exploitation" disabled={submitting} /></div> : null}
      </div>

      <section className="space-y-3" aria-labelledby="sale-lines-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 id="sale-lines-title" className="text-label text-foreground">Lignes de vente</h3><p className="mt-1 text-caption">Les montants sont calculés par quantité × prix unitaire.</p></div>
          <Button type="button" variant="outline" size="sm" onClick={addLine} disabled={submitting}><Plus className="size-4" />Ajouter une ligne</Button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border/75">
          <div className="min-w-[680px] divide-y divide-border/70">
            <div className="grid grid-cols-[minmax(14rem,1.8fr)_100px_110px_130px_110px_40px] gap-3 bg-surface-sunken/55 px-3 py-2 text-caption font-medium text-muted-foreground">
              <span>Désignation</span><span>Quantité</span><span>Unité</span><span>Prix unitaire</span><span>Total</span><span className="sr-only">Actions</span>
            </div>
            {lines.map((line) => {
              const total = Number(line.quantity) * Number(line.unitPrice);
              return <div key={line.key} className="grid grid-cols-[minmax(14rem,1.8fr)_100px_110px_130px_110px_40px] items-start gap-3 px-3 py-3">
                <div className="space-y-1.5">
                  <Select value={line.inventoryItemId || "NONE"} onValueChange={(value) => selectLineItem(line.key, value === "NONE" ? "" : value)} disabled={submitting}>
                    <SelectTrigger className="h-8 text-caption"><SelectValue placeholder="Article de stock (optionnel)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Sans article de stock</SelectItem>
                      {items.map((item) => <SelectItem key={item.id} value={item.id}>{item.nom}{item.sku ? ` (${item.sku})` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input value={line.description} onChange={(event) => updateLine(line.key, "description", event.target.value)} placeholder="Produit ou prestation" disabled={submitting} />
                </div>
                <Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(line.key, "quantity", event.target.value)} aria-label="Quantité" disabled={submitting} />
                <Input value={line.unit} onChange={(event) => updateLine(line.key, "unit", event.target.value)} aria-label="Unité" disabled={submitting} />
                <Input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.key, "unitPrice", event.target.value)} aria-label="Prix unitaire" disabled={submitting} />
                <p className="truncate pt-2 text-body-sm font-semibold tabular-nums text-foreground" title={formatXOF(Number.isFinite(total) ? total : 0)}>{formatXOF(Number.isFinite(total) ? total : 0)}</p>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeLine(line.key)} disabled={submitting || lines.length === 1} aria-label="Retirer cette ligne"><Minus className="size-4" /></Button>
              </div>;
            })}
          </div>
        </div>
        <div className="flex justify-end"><p className="rounded-lg bg-primary/10 px-3 py-2 text-body-sm font-semibold tabular-nums text-primary">Total prévisionnel : {formatXOF(estimatedTotal)}</p></div>
      </section>

      <div className="space-y-2">
        <Label htmlFor="commercial-sale-notes">Notes internes</Label>
        <Textarea id="commercial-sale-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Contexte, modalités convenues, informations de livraison…" disabled={submitting} />
      </div>

      <div className="flex justify-end gap-3 border-t border-border/70 pt-5">
        <Button type="button" onClick={() => void submit()} loading={submitting} loadingLabel="Enregistrement de la vente">
          {sale ? "Enregistrer les modifications" : "Créer la vente"}
        </Button>
      </div>
    </div>
  );
}
