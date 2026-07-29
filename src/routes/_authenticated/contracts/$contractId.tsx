import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileSignature } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntityDocumentsTab } from "@/components/documents/entity-documents-tab";
import { getContract } from "@/lib/contracts.functions";

export const Route = createFileRoute("/_authenticated/contracts/$contractId")({
  component: ContractDetailsPage,
});

function ContractDetailsPage() {
  const { contractId } = Route.useParams();
  const contractQuery = useQuery({
    queryKey: ["contract", contractId],
    queryFn: () => getContract({ data: contractId }),
  });

  if (contractQuery.isPending)
    return <p className="text-muted-foreground">Chargement du contrat…</p>;
  const contract = contractQuery.data;
  if (!contract)
    return (
      <Card>
        <CardContent className="p-6">Contrat introuvable ou inaccessible.</CardContent>
      </Card>
    );

  const fields = [
    ["Référence", contract.reference],
    ["Type", contract.type],
    ["Partie", contract.partie],
    ["Statut", contract.statut],
    ["Date de début", contract.date_debut],
    ["Date de fin", contract.date_fin],
    [
      "Montant",
      contract.montant === null ? null : `${Number(contract.montant).toLocaleString("fr-FR")} FCFA`,
    ],
  ] as const;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost">
        <Link to="/contracts">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Retour aux contrats
        </Link>
      </Button>
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold">
          <FileSignature className="h-7 w-7" />
          {contract.reference || contract.type || "Contrat"}
        </h1>
        <p className="text-muted-foreground">Fiche contrat</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Informations</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {fields.map(([label, value]) => (
            <div key={label}>
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="font-medium">{value || "-"}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Description</CardTitle>
        </CardHeader>
        <CardContent>{contract.description || "Aucune description renseignée."}</CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Documents</CardTitle></CardHeader><CardContent><EntityDocumentsTab entityId={contractId} relation="contract" /></CardContent></Card>
    </div>
  );
}
