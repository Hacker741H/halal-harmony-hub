import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  createMotorcycle,
  updateMotorcycle,
  type Motorcycle,
} from "@/lib/motorcycles.functions";
import { getWallets } from "@/lib/wallet.functions";

type Props = {
  motorcycle?: Motorcycle | null;
  onSuccess: () => void;
};

export function MotorcycleForm({
  motorcycle,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [immatriculation, setImmatriculation] = useState(
    motorcycle?.immatriculation ?? "",
  );

  const [marque, setMarque] = useState(
    motorcycle?.marque ?? "",
  );

  const [modele, setModele] = useState(
    motorcycle?.modele ?? "",
  );

  const [couleur, setCouleur] = useState(
    motorcycle?.couleur ?? "",
  );

  const [annee, setAnnee] = useState(
    motorcycle?.annee?.toString() ?? "",
  );

  const [kilometrage, setKilometrage] = useState(
    motorcycle?.kilometrage?.toString() ?? "0",
  );

  const [prixAchat, setPrixAchat] = useState(
    motorcycle?.prix_achat?.toString() ?? "",
  );

  const [dateAchat, setDateAchat] = useState(
    motorcycle?.date_achat ?? "",
  );

  const [purchaseWalletId, setPurchaseWalletId] = useState(
    motorcycle?.purchase_wallet_id ?? "",
  );

  const { data: wallets = [] } = useQuery({
    queryKey: ["wallets"],
    queryFn: () => getWallets(),
  });

  const [assuranceExpiration, setAssuranceExpiration] =
    useState(
      motorcycle?.assurance_expiration ?? "",
    );

  const [visiteExpiration, setVisiteExpiration] =
    useState(
      motorcycle?.visite_expiration ?? "",
    );

  const [derniereRevision, setDerniereRevision] =
    useState(
      motorcycle?.derniere_revision ?? "",
    );

  const [prochaineRevision, setProchaineRevision] =
    useState(
      motorcycle?.prochaine_revision ?? "",
    );

  const [observations, setObservations] =
    useState(
      motorcycle?.observations ?? "",
    );

  async function save() {
    if (!immatriculation.trim()) {
      alert("L'immatriculation est obligatoire.");
      return;
    }

    const purchasePrice = prixAchat ? Number(prixAchat) : 0;
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      alert("Le prix d'achat doit être un montant valide.");
      return;
    }
    if (purchasePrice > 0 && !purchaseWalletId) {
      alert("Sélectionnez le wallet utilisé pour l'achat.");
      return;
    }

    try {
      setLoading(true);

      const payload = {
        immatriculation,
        marque,
        modele,
        couleur,
        annee: annee ? Number(annee) : null,
        kilometrage: Number(kilometrage),
        prix_achat: purchasePrice || null,
        date_achat: dateAchat || null,
        purchase_wallet_id: purchasePrice > 0 ? purchaseWalletId : null,
        assurance_expiration:
          assuranceExpiration || null,
        visite_expiration:
          visiteExpiration || null,
        derniere_revision:
          derniereRevision || null,
        prochaine_revision:
          prochaineRevision || null,
        observations,
      };      if (motorcycle) {
        await updateMotorcycle({
          data: {
            id: motorcycle.id,
            ...payload,
          },
        });
      } else {
        await createMotorcycle({
          data: {
            ...payload,
            statut: "actif" as const,
          },
        });
      }

      onSuccess();
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error
          ? error.message
          : "Une erreur est survenue.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">

      <div className="grid gap-4 md:grid-cols-2">

        <div>
          <Label>Immatriculation</Label>
          <Input
            value={immatriculation}
            onChange={(e) =>
              setImmatriculation(e.target.value)
            }
          />
        </div>

        <div>
          <Label>Marque</Label>
          <Input
            value={marque}
            onChange={(e) =>
              setMarque(e.target.value)
            }
          />
        </div>

        <div>
          <Label>Modèle</Label>
          <Input
            value={modele}
            onChange={(e) =>
              setModele(e.target.value)
            }
          />
        </div>

        <div>
          <Label>Couleur</Label>
          <Input
            value={couleur}
            onChange={(e) =>
              setCouleur(e.target.value)
            }
          />
        </div>

        <div>
          <Label>Année</Label>
          <Input
            type="number"
            value={annee}
            onChange={(e) =>
              setAnnee(e.target.value)
            }
          />
        </div>

        <div>
          <Label>Kilométrage</Label>
          <Input
            type="number"
            value={kilometrage}
            onChange={(e) =>
              setKilometrage(e.target.value)
            }
          />
        </div>

      </div>

      <div className="border rounded-lg p-4 space-y-4">

        <h3 className="font-semibold">
          Informations d'achat
        </h3>

        <div className="grid gap-4 md:grid-cols-2">

          <div>
            <Label>Prix d'achat</Label>
            <Input
              type="number"
              value={prixAchat}
              onChange={(e) =>
                setPrixAchat(e.target.value)
              }
            />
          </div>

          <div>
            <Label>Date d'achat</Label>
            <Input
              type="date"
              value={dateAchat}
              onChange={(e) =>
                setDateAchat(e.target.value)
              }
            />
          </div>

          <div className="md:col-span-2">
            <Label>Wallet d'achat</Label>
            <select
              className="w-full rounded-md border px-3 py-2"
              value={purchaseWalletId}
              disabled={Number(prixAchat || 0) <= 0}
              onChange={(event) => setPurchaseWalletId(event.target.value)}
            >
              <option value="">Sélectionner un wallet</option>
              {wallets.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Le prix d'achat crée automatiquement une dépense liée à cette moto.
            </p>
          </div>

        </div>

      </div>      <div className="border rounded-lg p-4 space-y-4">

        <h3 className="font-semibold">
          Échéances
        </h3>

        <div className="grid gap-4 md:grid-cols-2">

          <div>
            <Label>Expiration assurance</Label>
            <Input
              type="date"
              value={assuranceExpiration}
              onChange={(e) =>
                setAssuranceExpiration(
                  e.target.value,
                )
              }
            />
          </div>

          <div>
            <Label>Expiration visite technique</Label>
            <Input
              type="date"
              value={visiteExpiration}
              onChange={(e) =>
                setVisiteExpiration(
                  e.target.value,
                )
              }
            />
          </div>

          <div>
            <Label>Dernière révision</Label>
            <Input
              type="date"
              value={derniereRevision}
              onChange={(e) =>
                setDerniereRevision(
                  e.target.value,
                )
              }
            />
          </div>

          <div>
            <Label>Prochaine révision</Label>
            <Input
              type="date"
              value={prochaineRevision}
              onChange={(e) =>
                setProchaineRevision(
                  e.target.value,
                )
              }
            />
          </div>

        </div>

      </div>

      <div className="border rounded-lg p-4 space-y-4">

        <h3 className="font-semibold">
          Observations
        </h3>

        <Textarea
          rows={5}
          placeholder="Notes sur la moto..."
          value={observations}
          onChange={(e) =>
            setObservations(
              e.target.value,
            )
          }
        />

      </div>      <div className="flex justify-end gap-2">

        <Button
          type="button"
          onClick={save}
          disabled={loading}
        >
          {loading
            ? "Enregistrement..."
            : motorcycle
              ? "Mettre à jour"
              : "Créer la moto"}
        </Button>

      </div>

    </div>
  );
}
