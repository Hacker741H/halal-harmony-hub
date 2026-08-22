import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileSignature } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OperationalHero } from "@/components/ui/operational-hero";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EntityDocumentsTab } from "@/components/documents/entity-documents-tab";
import { usePermissions } from "@/hooks/use-permissions";
import { CONTRACT_STATUSES, getContract, updateContractStatus } from "@/lib/contracts.functions";

export const Route = createFileRoute("/_authenticated/contracts/$contractId")({
  component: ContractDetailsPage,
});

const statusLabels: Record<string, string> = {
  ACTIF: "Actif",
  TERMINE: "Terminé",
  RESILIE: "Résilié",
};

function ContractDetailsPage() {
  const { contractId } = Route.useParams();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const contractQuery = useQuery({
    queryKey: ["contract", contractId],
    queryFn: () => getContract({ data: contractId }),
  });
  const statusMutation = useMutation({
    mutationFn: updateContractStatus,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["contract", contractId] }),
        queryClient.invalidateQueries({ queryKey: ["contracts"] }),
      ]);
      toast.success("Statut du contrat mis à jour.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Impossible de mettre à jour le statut.");
    },
  });

  if (contractQuery.isPending)
    return <p className="text-muted-foreground">Chargement du contrat…</p>;
  if (contractQuery.isError)
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <p className="font-medium text-destructive">Impossible de charger ce contrat.</p>
          <p className="text-sm text-muted-foreground">Réessayez dans un instant ou vérifiez votre connexion.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void contractQuery.refetch()}>Réessayer</Button>
        </CardContent>
      </Card>
    );
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
    ["Date de début", contract.date_debut],
    ["Date de fin", contract.date_fin],
    [
      "Montant",
      contract.montant === null ? null : `${Number(contract.montant).toLocaleString("fr-FR")} FCFA`,
    ],
  ] as const;

  const currentStatus = contract.statut ?? "ACTIF";
  const statusOptions = CONTRACT_STATUSES.includes(currentStatus as (typeof CONTRACT_STATUSES)[number])
    ? CONTRACT_STATUSES
    : [currentStatus, ...CONTRACT_STATUSES];

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" className="-ml-2 px-2">
        <Link to="/contracts">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Retour aux contrats
        </Link>
      </Button>

      <OperationalHero
        variant="deep"
        icon={FileSignature}
        eyebrow="Contrat"
        title={contract.reference || contract.type || "Contrat"}
        description="Fiche contrat"
        primaryStat={contract.montant === null ? undefined : { label: "Montant", value: `${Number(contract.montant).toLocaleString("fr-FR")} FCFA` }}
        actions={
          can("contracts.manage") ? (
            <div className="space-y-1">
              <label htmlFor="contract-status" className="text-sm font-medium">Statut</label>
              <Select
                value={currentStatus}
                disabled={statusMutation.isPending}
                onValueChange={(value) => statusMutation.mutate({ data: { id: contract.id, statut: value } })}
              >
                <SelectTrigger id="contract-status" className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {statusLabels[status] ?? status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <Badge variant="outline">{statusLabels[currentStatus] ?? currentStatus}</Badge>
          )
        }
      />

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
