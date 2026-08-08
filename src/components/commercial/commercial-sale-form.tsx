import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";

import { ClientSelect, FarmSelect } from "@/components/selects/entity-selects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createCommercialSale,
  updateCommercialSale,
  type CommercialSale,
  type CommercialSaleLine,
  type CommercialSaleValues,
} from "@/lib/commercial-sales.functions";

type LineForm = {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
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
  };
}

function emptyLine(index: number): LineForm {
  return { key: `line-${index}`, description: "", quantity: "1", unit: "UNITE", unitPrice: "" };
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

  function updateLine(key: string, field: keyof Omit<LineForm, "key">, value: string) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line));
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
      sale_date: saleDate,
      reference: toNullable(reference),
      notes: toNullable(notes),
      lines: lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unit: line.unit,
        unit_price: Number(line.unitPrice),
        inventory_item_id: null,
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
              return <div key={line.key} className="grid grid-cols-[minmax(14rem,1.8fr)_100px_110px_130px_110px_40px] items-center gap-3 px-3 py-3">
                <Input value={line.description} onChange={(event) => updateLine(line.key, "description", event.target.value)} placeholder="Produit ou prestation" disabled={submitting} />
                <Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(line.key, "quantity", event.target.value)} aria-label="Quantité" disabled={submitting} />
                <Input value={line.unit} onChange={(event) => updateLine(line.key, "unit", event.target.value)} aria-label="Unité" disabled={submitting} />
                <Input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.key, "unitPrice", event.target.value)} aria-label="Prix unitaire" disabled={submitting} />
                <p className="truncate text-body-sm font-semibold tabular-nums text-foreground" title={`${Number.isFinite(total) ? total.toLocaleString("fr-FR") : 0} FCFA`}>{Number.isFinite(total) ? total.toLocaleString("fr-FR") : "0"} FCFA</p>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeLine(line.key)} disabled={submitting || lines.length === 1} aria-label="Retirer cette ligne"><Minus className="size-4" /></Button>
              </div>;
            })}
          </div>
        </div>
        <div className="flex justify-end"><p className="rounded-lg bg-primary/10 px-3 py-2 text-body-sm font-semibold tabular-nums text-primary">Total prévisionnel : {estimatedTotal.toLocaleString("fr-FR")} FCFA</p></div>
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
