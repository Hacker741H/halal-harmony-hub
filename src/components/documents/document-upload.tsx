import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContractSelect, DriverSelect, EmployeeSelect, FarmSelect, MotorcycleSelect, VehicleSelect } from "@/components/selects/entity-selects";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  createDocument,
  type DocumentRelation,
} from "@/lib/documents.functions";

type Props = {
  entityId?: string;
  relation?: DocumentRelation;
  onSuccess: () => void;
};

export function DocumentUpload({ entityId, relation, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState("AUTRE");
  const [dateEmission, setDateEmission] = useState("");
  const [dateExpiration, setDateExpiration] = useState("");
  const [name, setName] = useState("");
  const [selectedRelation, setSelectedRelation] = useState<DocumentRelation>(relation ?? "vehicle");
  const [selectedEntityId, setSelectedEntityId] = useState(entityId ?? "");
  const activeRelation = relation ?? selectedRelation;
  const activeEntityId = entityId ?? selectedEntityId;

  async function save() {
    if (!file || !activeEntityId) {
      toast.error("Choisissez un fichier.");
      return;
    }

    let storagePath: string | null = null;
    let metadataCreated = false;

    try {
      setLoading(true);
      const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      storagePath = `${activeRelation}/${activeEntityId}/${crypto.randomUUID()}-${safeFileName}`;
      const { error: storageError } = await supabase.storage
        .from("documents")
        .upload(storagePath, file, { upsert: false, contentType: file.type || undefined });

      if (storageError) throw storageError;

      await createDocument({
        data: {
          entity_id: activeEntityId,
          relation: activeRelation,
          document: {
            nom: name.trim() || file.name,
            type: type === "AUTRE" ? null : type,
            url: null,
            storage_path: storagePath,
            date_emission: dateEmission || null,
            date_expiration: dateExpiration || null,
          },
        },
      });
      metadataCreated = true;

      toast.success("Document envoyé.");
      setFile(null);
      setName("");
      setType("AUTRE");
      setDateEmission("");
      setDateExpiration("");
      onSuccess();
    } catch (error) {
      console.error(error);
      if (storagePath && !metadataCreated) {
        const { error: cleanupError } = await supabase.storage.from("documents").remove([storagePath]);
        const cleanupResult = cleanupError ? "METADATA_FAILED_REMOVE_FAILED" : "METADATA_FAILED_REMOVED";
        const { error: auditError } = await supabase.rpc("record_document_storage_cleanup", {
          p_storage_path: storagePath,
          p_result: cleanupResult,
        });
        if (cleanupError || auditError) console.error(cleanupError ?? auditError);
      }
      toast.error(error instanceof Error ? error.message : "Impossible d'envoyer le document.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="document-file">Document</Label>
        <Input
          id="document-file"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null;
            setFile(nextFile);
            if (nextFile && !name) setName(nextFile.name);
          }}
        />
      </div>

      <div>
        <Label htmlFor="document-name">Nom</Label>
        <Input id="document-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nom du document" />
      </div>

      {!entityId && (
        <>
          <div>
            <Label>Entité liée</Label>
            <Select value={selectedRelation} onValueChange={(value) => { setSelectedRelation(value as DocumentRelation); setSelectedEntityId(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vehicle">Véhicule</SelectItem>
                <SelectItem value="motorcycle">Moto</SelectItem>
                <SelectItem value="driver">Chauffeur</SelectItem>
                <SelectItem value="employee">Employé</SelectItem>
                <SelectItem value="farm">Exploitation</SelectItem>
                <SelectItem value="contract">Contrat</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Élément lié</Label>
            {selectedRelation === "vehicle" && <VehicleSelect value={selectedEntityId} onValueChange={setSelectedEntityId} />}
            {selectedRelation === "motorcycle" && <MotorcycleSelect value={selectedEntityId} onValueChange={setSelectedEntityId} />}
            {selectedRelation === "driver" && <DriverSelect value={selectedEntityId} onValueChange={setSelectedEntityId} />}
            {selectedRelation === "employee" && <EmployeeSelect value={selectedEntityId} onValueChange={setSelectedEntityId} />}
            {selectedRelation === "farm" && <FarmSelect value={selectedEntityId} onValueChange={setSelectedEntityId} />}
            {selectedRelation === "contract" && <ContractSelect value={selectedEntityId} onValueChange={setSelectedEntityId} />}
          </div>
        </>
      )}

      <div>
        <Label>Type</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="AUTRE">Autre</SelectItem>
            <SelectItem value="PERMIS">Permis</SelectItem>
            <SelectItem value="ASSURANCE">Assurance</SelectItem>
            <SelectItem value="CARTE_GRISE">Carte grise</SelectItem>
            <SelectItem value="CONTRAT">Contrat</SelectItem>
            <SelectItem value="FACTURE">Facture</SelectItem>
            <SelectItem value="CERTIFICAT">Certificat</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="document-issued-at">Date d'émission</Label>
          <Input
            id="document-issued-at"
            type="date"
            value={dateEmission}
            onChange={(event) => setDateEmission(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="document-expires-at">Date d'expiration</Label>
          <Input
            id="document-expires-at"
            type="date"
            value={dateExpiration}
            onChange={(event) => setDateExpiration(event.target.value)}
          />
        </div>
      </div>

      <Button className="w-full" disabled={loading} onClick={save}>
        {loading ? "Envoi..." : "Envoyer le document"}
      </Button>
    </div>
  );
}
