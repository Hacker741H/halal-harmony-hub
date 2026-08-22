import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Archive, ArrowLeft, Download, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { OperationalHero } from "@/components/ui/operational-hero";
import { useConfirm } from "@/hooks/use-confirm";
import { usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/integrations/supabase/client";
import {
  archiveDocument,
  deleteDocumentMetadata,
  getDocument,
  getDocumentHistory,
  getDocumentRelations,
  replaceDocumentMetadata,
  restoreDocument,
} from "@/lib/documents.functions";

export const Route = createFileRoute("/_authenticated/documents/$documentId")({
  component: DocumentDetailPage,
});

function DocumentDetailPage() {
  const { documentId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const permissions = usePermissions();
  const { confirm, dialog } = useConfirm();
  const documentQuery = useQuery({ queryKey: ["document", documentId], queryFn: () => getDocument({ data: { id: documentId } }) });
  const relationsQuery = useQuery({ queryKey: ["document-relations", documentId], queryFn: () => getDocumentRelations({ data: { id: documentId } }) });
  const historyQuery = useQuery({ queryKey: ["document-history", documentId], queryFn: () => getDocumentHistory({ data: { id: documentId } }) });
  const archiveMutation = useMutation({ mutationFn: () => archiveDocument({ data: { id: documentId } }), onSuccess: () => { toast.success("Document archivé."); void documentQuery.refetch(); void historyQuery.refetch(); }, onError: () => toast.error("Impossible d'archiver le document.") });
  const restoreMutation = useMutation({ mutationFn: () => restoreDocument({ data: { id: documentId } }), onSuccess: () => { toast.success("Document restauré."); void documentQuery.refetch(); void historyQuery.refetch(); }, onError: () => toast.error("Impossible de restaurer le document.") });

  if (documentQuery.isLoading) return <div className="p-6 text-muted-foreground">Chargement du document…</div>;
  if (documentQuery.isError || !documentQuery.data) return <div className="space-y-4 p-6"><p className="text-destructive">Document introuvable ou non autorisé.</p><Button asChild variant="outline"><Link to="/documents">Retour aux documents</Link></Button></div>;

  const document = documentQuery.data;
  const relation = relationsQuery.data?.[0];
  const entityHref = relation ? relation.route.replace(/\$[A-Za-z]+Id/, relation.entityId) : null;
  const canReplace = permissions.can("documents.upload");
  const canDelete = permissions.can("documents.delete");
  const replaceMutation = useMutation({
    mutationFn: async (file: File) => {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const newPath = `documents/${documentId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("documents").upload(newPath, file, { upsert: false, contentType: file.type || undefined });
      if (uploadError) throw uploadError;
      try {
        await replaceDocumentMetadata({ data: { id: documentId, storage_path: newPath, nom: file.name } });
        if (document.storage_path) {
          const { error: removeOldError } = await supabase.storage.from("documents").remove([document.storage_path]);
          if (removeOldError) {
            await replaceDocumentMetadata({ data: { id: documentId, storage_path: document.storage_path, nom: document.nom } });
            await supabase.storage.from("documents").remove([newPath]);
            throw new Error("Remplacement annulé : l'ancien fichier ne peut pas être supprimé.");
          }
        }
      } catch (error) {
        await supabase.storage.from("documents").remove([newPath]);
        throw error;
      }
    },
    onSuccess: () => { toast.success("Document remplacé."); void documentQuery.refetch(); void historyQuery.refetch(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Impossible de remplacer le document."),
  });
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (document.storage_path) {
        const { error } = await supabase.storage.from("documents").remove([document.storage_path]);
        if (error) throw error;
      }
      await deleteDocumentMetadata({ data: { id: documentId } });
    },
    onSuccess: () => { toast.success("Document supprimé."); void queryClient.invalidateQueries({ queryKey: ["documents"] }); void navigate({ to: "/documents" }); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Impossible de supprimer le document."),
  });

  return <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
    <input ref={replacementInputRef} className="hidden" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) replaceMutation.mutate(file); event.currentTarget.value = ""; }} />
    <Button asChild variant="ghost" className="-ml-2 px-2"><Link to="/documents"><ArrowLeft className="mr-2 h-4 w-4" />Documents</Link></Button>

    <OperationalHero
      variant="deep"
      icon={FileText}
      eyebrow="Document"
      title={document.nom}
      description={document.type ?? "Document"}
      actions={<>{document.url && <Button asChild variant="outline"><a href={document.url} target="_blank" rel="noreferrer"><Download className="mr-2 h-4 w-4" />Télécharger</a></Button>}{canReplace && <Button variant="outline" disabled={replaceMutation.isPending} onClick={() => replacementInputRef.current?.click()}><Upload className="mr-2 h-4 w-4" />{replaceMutation.isPending ? "Remplacement…" : "Remplacer"}</Button>}{canDelete && <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => confirm({
      title: "Supprimer définitivement ce document ?",
      description: "Cette action est irréversible : le fichier et ses métadonnées seront supprimés.",
      variant: "destructive",
      confirmLabel: "Supprimer",
      onConfirm: async () => { await deleteMutation.mutateAsync(); },
    })}><Trash2 className="mr-2 h-4 w-4" />{deleteMutation.isPending ? "Suppression…" : "Supprimer"}</Button>}{document.archived_at ? <Button variant="outline" disabled={restoreMutation.isPending} onClick={() => restoreMutation.mutate()}>Restaurer</Button> : <Button variant="outline" disabled={archiveMutation.isPending} onClick={() => archiveMutation.mutate()}><Archive className="mr-2 h-4 w-4" />Archiver</Button>}</>}
    />
    <div className="grid gap-4 md:grid-cols-2"><section className="rounded-lg border p-4"><h2 className="mb-3 font-semibold">Informations générales</h2><dl className="space-y-2 text-sm"><div><dt className="text-muted-foreground">Date d'émission</dt><dd>{document.date_emission ?? "—"}</dd></div><div><dt className="text-muted-foreground">Date d'expiration</dt><dd>{document.date_expiration ?? "—"}</dd></div><div><dt className="text-muted-foreground">Entité liée</dt><dd>{entityHref ? <Link className="text-primary underline" to={entityHref}>Ouvrir {relation?.label}</Link> : "Entité absente ou ancienne relation"}</dd></div></dl></section><section className="rounded-lg border p-4"><h2 className="mb-3 font-semibold">Historique</h2>{historyQuery.data?.length ? <ul className="space-y-2 text-sm">{historyQuery.data.map((entry) => <li key={entry.id}>{entry.action} · {new Date(entry.created_at).toLocaleString("fr-FR")}</li>)}</ul> : <p className="text-sm text-muted-foreground">Aucun événement visible.</p>}</section></div>
    {dialog}
  </div>;
}
