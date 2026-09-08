import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WalletSelect } from "@/components/selects/entity-selects";

import {
  createMotorcycle,
  updateMotorcycle,
  type Motorcycle,
} from "@/lib/motorcycles.functions";
import { getWallets } from "@/lib/wallet.functions";
import { notifyMutationError } from "@/lib/notify-mutation-error";

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
      toast.error("L'immatriculation est obligatoire.");
      return;
    }

    const purchasePrice = prixAchat ? Number(prixAchat) : 0;
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      toast.error("Le prix d'achat doit être un montant valide.");
      return;
    }
    if (purchasePrice > 0 && !purchaseWalletId) {
      toast.error("Sélectionnez le wallet utilisé pour l'achat.");
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
      notifyMutationError(error, "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">

      <div className="grid gap-4 md:grid-cols-2">

        <div>
          <Label htmlFor="motorcycle-immatriculation">Immatriculation</Label>
          <Input
            id="motorcycle-immatriculation"
            value={immatriculation}
            onChange={(e) =>
              setImmatriculation(e.target.value)
            }
          />
        </div>

        <div>
          <Label htmlFor="motorcycle-marque">Marque</Label>
          <Input
            id="motorcycle-marque"
            value={marque}
            onChange={(e) =>
              setMarque(e.target.value)
            }
          />
        </div>

        <div>
          <Label htmlFor="motorcycle-modele">Modèle</Label>
          <Input
            id="motorcycle-modele"
            value={modele}
            onChange={(e) =>
              setModele(e.target.value)
            }
          />
        </div>

        <div>
          <Label htmlFor="motorcycle-couleur">Couleur</Label>
          <Input
            id="motorcycle-couleur"
            value={couleur}
            onChange={(e) =>
              setCouleur(e.target.value)
            }
          />
        </div>

        <div>
          <Label htmlFor="motorcycle-annee">Année</Label>
          <Input
            id="motorcycle-annee"
            type="number"
            value={annee}
            onChange={(e) =>
              setAnnee(e.target.value)
            }
          />
        </div>

        <div>
          <Label htmlFor="motorcycle-kilometrage">Kilométrage</Label>
          <Input
            id="motorcycle-kilometrage"
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
            <Label htmlFor="motorcycle-prix-achat">Prix d'achat</Label>
            <Input
              id="motorcycle-prix-achat"
              type="number"
              value={prixAchat}
              onChange={(e) =>
                setPrixAchat(e.target.value)
              }
            />
          </div>

          <div>
            <Label htmlFor="motorcycle-date-achat">Date d'achat</Label>
            <Input
              id="motorcycle-date-achat"
              type="date"
              value={dateAchat}
              onChange={(e) =>
                setDateAchat(e.target.value)
              }
            />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="motorcycle-purchase-wallet">Wallet d'achat</Label>
            <WalletSelect
              id="motorcycle-purchase-wallet"
              value={purchaseWalletId}
              onValueChange={setPurchaseWalletId}
              disabled={Number(prixAchat || 0) <= 0}
              placeholder="Sélectionner un wallet"
            />
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
            <Label htmlFor="motorcycle-assurance-expiration">Expiration assurance</Label>
            <Input
              id="motorcycle-assurance-expiration"
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
            <Label htmlFor="motorcycle-visite-expiration">Expiration visite technique</Label>
            <Input
              id="motorcycle-visite-expiration"
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
            <Label htmlFor="motorcycle-derniere-revision">Dernière révision</Label>
            <Input
              id="motorcycle-derniere-revision"
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
            <Label htmlFor="motorcycle-prochaine-revision">Prochaine révision</Label>
            <Input
              id="motorcycle-prochaine-revision"
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

        <Label htmlFor="motorcycle-observations" className="sr-only">Observations</Label>
        <Textarea
          id="motorcycle-observations"
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
