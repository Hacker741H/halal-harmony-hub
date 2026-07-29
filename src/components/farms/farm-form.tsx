import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  createFarm,
  updateFarm,
  type Farm,
} from "@/lib/farms.functions";

type Props = {
  farm?: Farm | null;
  onSuccess: () => void;
};

export function FarmForm({
  farm,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    code: "",
    nom: "",
    localisation: "",
    village: "",
    departement: "",
    type_culture: "",
    superficie: "",
    proprietaire: "",
    telephone: "",
    nature: "",
    prix_kg: "",
    date_debut_contrat: "",
    date_fin_contrat: "",
    latitude: "",
    longitude: "",
    description: "",
  });

  useEffect(() => {
    if (!farm) {
      return;
    }

    setForm({
      code: farm.code ?? "",
      nom: farm.nom ?? "",
      localisation: farm.localisation ?? "",
      village: farm.village ?? "",
      departement: farm.departement ?? "",
      type_culture: farm.type_culture ?? "",
      superficie: farm.superficie?.toString() ?? "",
      proprietaire: farm.proprietaire ?? "",
      telephone: farm.telephone ?? "",
      nature: farm.nature ?? "",
      prix_kg: farm.prix_kg?.toString() ?? "",
      date_debut_contrat: farm.date_debut_contrat ?? "",
      date_fin_contrat: farm.date_fin_contrat ?? "",
      latitude: farm.latitude?.toString() ?? "",
      longitude: farm.longitude?.toString() ?? "",
      description: farm.description ?? "",
    });
  }, [farm]);

  const isEditing = !!farm;

  async function save() {
    try {
      setLoading(true);

      const values = {
        code: form.code,
        nom: form.nom,
        localisation: form.localisation,
        village: form.village || null,
        departement: form.departement || null,
        type_culture: form.type_culture || null,
        superficie: form.superficie
          ? Number(form.superficie)
          : null,
        proprietaire: form.proprietaire || null,
        telephone: form.telephone || null,
        nature: form.nature || null,
        prix_kg: form.prix_kg
          ? Number(form.prix_kg)
          : 0,
        date_debut_contrat:
          form.date_debut_contrat || null,
        date_fin_contrat:
          form.date_fin_contrat || null,
        latitude: form.latitude
          ? Number(form.latitude)
          : null,
        longitude: form.longitude
          ? Number(form.longitude)
          : null,
        description: form.description || null,
      };

      if (isEditing && farm) {
        await updateFarm({
          data: {
            id: farm.id,
            values,
          },
        });

        alert("✅ Exploitation mise à jour.");
      } else {
        await createFarm({
          data: {
            ...values,
            statut: "actif" as const,
          },
        });

        alert("✅ Exploitation créée.");
      }

      onSuccess();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">

      <div className="grid gap-4 md:grid-cols-2">

        <div>
          <Label>Code</Label>
          <Input
            value={form.code}
            onChange={(e)=>
              setForm({...form,code:e.target.value})
            }
            placeholder="HALAL01"
          />
        </div>

        <div>
          <Label>Nom</Label>
          <Input
            value={form.nom}
            onChange={(e)=>
              setForm({...form,nom:e.target.value})
            }
          />
        </div>

        <div>
          <Label>Localisation</Label>
          <Input
            value={form.localisation}
            onChange={(e)=>
              setForm({...form,localisation:e.target.value})
            }
          />
        </div>

        <div>
          <Label>Village</Label>
          <Input
            value={form.village}
            onChange={(e)=>
              setForm({...form,village:e.target.value})
            }
          />
        </div>

        <div>
          <Label>Département</Label>
          <Input
            value={form.departement}
            onChange={(e)=>
              setForm({...form,departement:e.target.value})
            }
          />
        </div>

        <div>
          <Label>Culture</Label>
          <Input
            value={form.type_culture}
            placeholder="Hévéa"
            onChange={(e)=>
              setForm({...form,type_culture:e.target.value})
            }
          />
        </div>

        <div>
          <Label>Superficie (ha)</Label>
          <Input
            type="number"
            value={form.superficie}
            onChange={(e)=>
              setForm({...form,superficie:e.target.value})
            }
          />
        </div>

        <div>
          <Label>Prix/kg</Label>
          <Input
            type="number"
            value={form.prix_kg}
            onChange={(e)=>
              setForm({...form,prix_kg:e.target.value})
            }
          />
        </div>

        <div>
          <Label>Propriétaire</Label>
          <Input
            value={form.proprietaire}
            onChange={(e)=>
              setForm({...form,proprietaire:e.target.value})
            }
          />
        </div>

        <div>
          <Label>Téléphone</Label>
          <Input
            value={form.telephone}
            onChange={(e)=>
              setForm({...form,telephone:e.target.value})
            }
          />
        </div>

        <div>
          <Label>Nature</Label>
          <Input
            placeholder="Garantie"
            value={form.nature}
            onChange={(e)=>
              setForm({...form,nature:e.target.value})
            }
          />
        </div>

        <div>
          <Label>Date début contrat</Label>
          <Input
            type="date"
            value={form.date_debut_contrat}
            onChange={(e)=>
              setForm({...form,date_debut_contrat:e.target.value})
            }
          />
        </div>

        <div>
          <Label>Date fin contrat</Label>
          <Input
            type="date"
            value={form.date_fin_contrat}
            onChange={(e)=>
              setForm({...form,date_fin_contrat:e.target.value})
            }
          />
        </div>

        <div>
          <Label>Latitude</Label>
          <Input
            value={form.latitude}
            onChange={(e)=>
              setForm({...form,latitude:e.target.value})
            }
          />
        </div>

        <div>
          <Label>Longitude</Label>
          <Input
            value={form.longitude}
            onChange={(e)=>
              setForm({...form,longitude:e.target.value})
            }
          />
        </div>

      </div>

      <div>
        <Label>Description</Label>
        <Textarea
          rows={5}
          value={form.description}
          onChange={(e)=>
            setForm({...form,description:e.target.value})
          }
        />
      </div>

      <Button
        className="w-full"
        disabled={loading}
        onClick={save}
      >
        {loading
          ? "Enregistrement..."
          : isEditing
          ? "Mettre à jour"
          : "Créer l'exploitation"}
      </Button>

    </div>
  );
}
