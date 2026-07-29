import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Archive, Download, FileText } from "lucide-react";
import { toast } from "sonner";

import { DocumentUpload } from "@/components/documents/document-upload";
import { Button } from "@/components/ui/button";
import { archiveDocument, getDocumentsForRelation, type DocumentRelation } from "@/lib/documents.functions";

type Props = { entityId: string; relation: Extract<DocumentRelation, "employee" | "driver" | "vehicle" | "motorcycle" | "farm" | "contract"> };

export function EntityDocumentsTab({ entityId, relation }: Props) {
  const queryClient = useQueryClient();
  const key = ["entity-documents", relation, entityId];
  const documentsQuery = useQuery({ queryKey: key, queryFn: () => getDocumentsForRelation({ data: { entity_id: entityId, relation } }) });
  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveDocument({ data: { id } }),
    onSuccess: () => { toast.success("Document archivé."); void queryClient.invalidateQueries({ queryKey: key }); },
    onError: () => toast.error("Impossible d'archiver le document."),
  });
  return <div className="space-y-5"><DocumentUpload entityId={entityId} relation={relation} onSuccess={() => { void queryClient.invalidateQueries({ queryKey: key }); }} />{documentsQuery.isLoading ? <p className="text-sm text-muted-foreground">Chargement des documents…</p> : documentsQuery.isError ? <p className="text-sm text-destructive">Impossible de charger les documents.</p> : documentsQuery.data?.length ? <div className="space-y-2">{documentsQuery.data.map((document) => <div key={document.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><Link to="/documents/$documentId" params={{ documentId: document.id }} className="font-medium hover:underline">{document.nom}</Link><p className="text-xs text-muted-foreground">{document.type ?? "Document"}{document.date_expiration ? ` · expire le ${document.date_expiration}` : ""}</p></div><div className="flex gap-2">{document.url && <Button asChild variant="outline" size="sm"><a href={document.url} target="_blank" rel="noreferrer"><Download className="h-4 w-4" /></a></Button>}<Button size="sm" variant="outline" disabled={archiveMutation.isPending} onClick={() => archiveMutation.mutate(document.id)}><Archive className="h-4 w-4" /></Button></div></div>)}</div> : <div className="flex items-center gap-2 rounded-lg border border-dashed p-5 text-sm text-muted-foreground"><FileText className="h-5 w-5" />Aucun document lié.</div>}</div>;
}
