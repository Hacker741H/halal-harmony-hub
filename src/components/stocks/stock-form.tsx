import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  createStock,
  updateStock,
  type Stock,
} from "@/lib/stocks.functions";

type Props = {
  onSuccess: () => void;
  stock?: Stock | null;
};

export function StockForm({
  onSuccess,
  stock,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    nom: "",
    categorie: "",
    sku: "",
    unite: "",
    stock_actuel: "",
    seuil_alerte: "",
  });

  useEffect(() => {
    if (!stock) {
      setForm({
        nom: "",
        categorie: "",
        sku: "",
        unite: "",
        stock_actuel: "",
        seuil_alerte: "",
      });
      return;
    }

    setForm({
      nom: stock.nom ?? "",
      categorie: stock.categorie ?? "",
      sku: stock.sku ?? "",
      unite: stock.unite ?? "",
      stock_actuel: stock.stock_actuel?.toString() ?? "",
      seuil_alerte: stock.seuil_alerte?.toString() ?? "",
    });
  }, [stock]);

  const isEditing = !!stock;

  async function save() {
    if (!form.nom.trim()) {
      alert("Le nom de l'article est obligatoire.");
      return;
    }

    try {
      setLoading(true);

      const values = {
        nom: form.nom,
        categorie: form.categorie || null,
        sku: form.sku || null,
        unite: form.unite || null,
        stock_actuel: form.stock_actuel
          ? Number(form.stock_actuel)
          : 0,
        seuil_alerte: form.seuil_alerte
          ? Number(form.seuil_alerte)
          : null,
      };

      if (isEditing && stock) {
        await updateStock({
          data: {
            id: stock.id,
            values,
          },
        });

        alert("✅ Article mis à jour.");
      } else {
        await createStock({
          data: values,
        });

        alert("✅ Article créé.");
      }

      setForm({
        nom: "",
        categorie: "",
        sku: "",
        unite: "",
        stock_actuel: "",
        seuil_alerte: "",
      });

      onSuccess();
    } catch (error) {
      console.error(error);

      alert(
        error instanceof Error
          ? error.message
          : JSON.stringify(error, null, 2),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-primary/15 bg-primary/[0.06] px-4 py-3 text-sm leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground">Étape 1 — Créer la fiche de l’article</p>
        <p className="mt-1">Créez ici la référence, l’unité et le seuil d’alerte. Pour un achat réel, enregistrez ensuite un mouvement <span className="font-medium text-foreground">Achat fournisseur</span> : c’est lui qui conserve le prix d’achat et débite le wallet concerné.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">

        <div>
          <Label>Nom *</Label>
          <Input
            placeholder="Huile moteur"
            value={form.nom}
            onChange={(e) =>
              setForm({
                ...form,
                nom: e.target.value,
              })
            }
          />
        </div>

        <div>
          <Label>Catégorie</Label>
          <Input
            placeholder="Lubrifiants"
            value={form.categorie}
            onChange={(e) =>
              setForm({
                ...form,
                categorie: e.target.value,
              })
            }
          />
        </div>

        <div>
          <Label>SKU</Label>
          <Input
            placeholder="SKU-001"
            value={form.sku}
            onChange={(e) =>
              setForm({
                ...form,
                sku: e.target.value,
              })
            }
          />
        </div>

        <div>
          <Label>Unité</Label>
          <Input
            placeholder="Litre, Kg, Pièce..."
            value={form.unite}
            onChange={(e) =>
              setForm({
                ...form,
                unite: e.target.value,
              })
            }
          />
        </div>

        <div>
          <Label>Stock de départ / inventaire initial</Label>
          <Input
            type="number"
            placeholder="0"
            value={form.stock_actuel}
            onChange={(e) =>
              setForm({
                ...form,
                stock_actuel: e.target.value,
              })
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">Utilisez ce champ seulement pour un inventaire de départ déjà possédé. Un achat fournisseur doit passer par « Nouveau mouvement ».</p>
        </div>

        <div>
          <Label>Seuil d'alerte</Label>
          <Input
            type="number"
            placeholder="5"
            value={form.seuil_alerte}
            onChange={(e) =>
              setForm({
                ...form,
                seuil_alerte: e.target.value,
              })
            }
          />
        </div>

      </div>

      <Button
        className="w-full"
        disabled={loading}
        onClick={save}
      >
        {loading
          ? isEditing
            ? "Mise à jour..."
            : "Enregistrement..."
          : isEditing
            ? "Mettre à jour l'article"
            : "Créer l'article"}
      </Button>
    </div>
  );
}
