import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FileImage, FilePlus2, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { DocumentUpload } from "@/components/documents/document-upload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/integrations/supabase/client";
import {
  deleteDocumentMetadata,
  DOCUMENT_TYPES,
  getDocumentsLibrary,
  replaceDocumentMetadata,
  type Document,
  type DocumentStatus,
} from "@/lib/documents.functions";

const TYPE_LABELS: Record<(typeof DOCUMENT_TYPES)[number], string> = {
  ASSURANCE: "Assurance", CARTE_GRISE: "Carte grise", PERMIS: "Permis", CONTRAT: "Contrat", FACTURE: "Facture", CERTIFICAT: "Certificat", AUTRE: "Autre",
};

function documentStatus(date: string | null) {
  if (!date) return { label: "Sans échéance", className: "bg-muted text-muted-foreground" };
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  if (date < today) return { label: "Expiré", className: "bg-destructive/15 text-destructive" };
  if (date <= nextMonth) return { label: "Expire bientôt", className: "bg-amber-100 text-amber-800" };
  return { label: "Valide", className: "bg-emerald-100 text-emerald-800" };
}

export function DocumentsPage() {
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("ALL");
  const [status, setStatus] = useState<"ALL" | DocumentStatus>("ALL");
  const [relation, setRelation] = useState("ALL");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const [replacementTarget, setReplacementTarget] = useState<Document | null>(null);
  const replacementInputRef = useRef<HTMLInputElement>(null);

  const query = useQuery({
    queryKey: ["documents", page, search, type, status, relation],
    queryFn: () => getDocumentsLibrary({ data: {
      page, page_size: 20, search: search || null,
      type: type === "ALL" ? null : type as (typeof DOCUMENT_TYPES)[number],
      status: status === "ALL" ? null : status,
      relation: relation === "ALL" ? null : relation as "employee" | "driver" | "vehicle" | "motorcycle" | "farm" | "contract",
      expiration_from: null, expiration_to: null,
    } }),
  });
  const result = query.data ?? { documents: [], total: 0 };
  const pageCount = Math.max(1, Math.ceil(result.total / 20));
  const canReplace = permissions.can("documents.upload");
  const canDelete = permissions.can("documents.delete");
  const refreshLibrary = () => queryClient.invalidateQueries({ queryKey: ["documents"] });

  const replaceMutation = useMutation({
    mutationFn: async ({ document, file }: { document: Document; file: File }) => {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const newPath = `documents/${document.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("documents").upload(newPath, file, { upsert: false, contentType: file.type || undefined });
      if (uploadError) throw uploadError;
      let metadataUpdated = false;
      try {
        await replaceDocumentMetadata({ data: { id: document.id, storage_path: newPath, nom: file.name } });
        metadataUpdated = true;
        if (document.storage_path) {
          const { error: removeOldError } = await supabase.storage.from("documents").remove([document.storage_path]);
          if (removeOldError) {
            await replaceDocumentMetadata({ data: { id: document.id, storage_path: document.storage_path, nom: document.nom } });
            await supabase.storage.from("documents").remove([newPath]);
            throw new Error("Remplacement annulé : l’ancien fichier ne peut pas être supprimé.");
          }
        }
      } catch (error) {
        if (!metadataUpdated) await supabase.storage.from("documents").remove([newPath]);
        throw error;
      }
    },
    onSuccess: async () => { await refreshLibrary(); setReplacementTarget(null); toast.success("Document remplacé."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Impossible de remplacer le document."),
  });
  const deleteMutation = useMutation({
    mutationFn: async (document: Document) => {
      if (document.storage_path) {
        const { error: storageError } = await supabase.storage.from("documents").remove([document.storage_path]);
        if (storageError) throw storageError;
      }
      await deleteDocumentMetadata({ data: { id: document.id } });
    },
    onSuccess: async () => { await refreshLibrary(); setPreviewDocument(null); toast.success("Document supprimé."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Impossible de supprimer le document."),
  });

  return <div className="space-y-6 p-4 md:p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="text-2xl font-bold">Documents</h1><p className="text-sm text-muted-foreground">Bibliothèque documentaire et échéances ERP.</p></div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogTrigger asChild><Button><FilePlus2 className="mr-2 h-4 w-4" />Téléverser</Button></DialogTrigger><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Nouveau document</DialogTitle></DialogHeader><DocumentUpload onSuccess={() => { setDialogOpen(false); void refreshLibrary(); }} /></DialogContent></Dialog>
    </div>

    <div className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-4">
      <div className="md:col-span-2"><Label htmlFor="documents-search">Recherche</Label><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="documents-search" className="pl-9" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Nom du document" /></div></div>
      <div><Label>Type</Label><Select value={type} onValueChange={(value) => { setType(value); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Tous les types</SelectItem>{DOCUMENT_TYPES.map((item) => <SelectItem key={item} value={item}>{TYPE_LABELS[item]}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Statut</Label><Select value={status} onValueChange={(value) => { setStatus(value as "ALL" | DocumentStatus); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Tous statuts</SelectItem><SelectItem value="VALID">Valide</SelectItem><SelectItem value="EXPIRING">Expire bientôt</SelectItem><SelectItem value="EXPIRED">Expiré</SelectItem></SelectContent></Select></div>
      <div><Label>Entité</Label><Select value={relation} onValueChange={(value) => { setRelation(value); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Toutes les entités</SelectItem><SelectItem value="vehicle">Véhicules</SelectItem><SelectItem value="motorcycle">Motos</SelectItem><SelectItem value="driver">Chauffeurs</SelectItem><SelectItem value="employee">Employés</SelectItem><SelectItem value="farm">Exploitations</SelectItem><SelectItem value="contract">Contrats</SelectItem></SelectContent></Select></div>
    </div>

    <input ref={replacementInputRef} className="hidden" type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={(event) => { const file = event.target.files?.[0]; if (file && replacementTarget) replaceMutation.mutate({ document: replacementTarget, file }); event.currentTarget.value = ""; }} />
    {query.isLoading ? <p className="text-muted-foreground">Chargement des documents…</p> : query.isError ? <p className="text-destructive">Impossible de charger les documents.</p> : <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-190 text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-3">Document</th><th className="p-3">Type</th><th className="p-3">Expiration</th><th className="p-3">Statut</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{result.documents.length === 0 ? <tr><td className="p-6 text-center text-muted-foreground" colSpan={5}>Aucun document trouvé.</td></tr> : result.documents.map((document) => { const state = documentStatus(document.date_expiration); const isImage = document.type?.startsWith("image/"); return <tr key={document.id} className="border-t"><td className="p-3 font-medium"><div className="flex items-center gap-3">{isImage && document.url ? <button type="button" className="h-10 w-10 shrink-0 overflow-hidden rounded border bg-muted" onClick={() => setPreviewDocument(document)} title="Aperçu de l’image"><img src={document.url} alt="" className="h-full w-full object-cover" /></button> : <FileImage className="h-5 w-5 shrink-0 text-muted-foreground" />}<Link className="hover:underline" to="/documents/$documentId" params={{ documentId: document.id }}>{document.nom}</Link></div></td><td className="p-3">{document.type ? TYPE_LABELS[document.type as keyof typeof TYPE_LABELS] ?? document.type : "—"}</td><td className="p-3">{document.date_expiration ?? "—"}</td><td className="p-3"><Badge className={state.className}>{state.label}</Badge></td><td className="p-3"><div className="flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setPreviewDocument(document)} disabled={!document.url}><Eye className="mr-1 h-4 w-4" />Voir</Button>{canReplace && <Button type="button" variant="outline" size="sm" disabled={replaceMutation.isPending} onClick={() => { setReplacementTarget(document); replacementInputRef.current?.click(); }}><Upload className="mr-1 h-4 w-4" />Modifier</Button>}{canDelete && <Button type="button" variant="destructive" size="sm" disabled={deleteMutation.isPending} onClick={() => { if (window.confirm(`Supprimer définitivement « ${document.nom} » ?`)) deleteMutation.mutate(document); }}><Trash2 className="mr-1 h-4 w-4" />Supprimer</Button>}</div></td></tr>; })}</tbody></table></div>}
    <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{result.total} document(s)</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Précédent</Button><span className="py-2">Page {page}/{pageCount}</span><Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Suivant</Button></div></div>
    <Dialog open={previewDocument !== null} onOpenChange={(open) => { if (!open) setPreviewDocument(null); }}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>{previewDocument?.nom}</DialogTitle></DialogHeader>{previewDocument?.url ? previewDocument.type?.startsWith("image/") ? <img src={previewDocument.url} alt={previewDocument.nom} className="max-h-[70vh] w-full rounded-lg object-contain" /> : <iframe title={previewDocument.nom} src={previewDocument.url} className="h-[70vh] w-full rounded-lg border" /> : <p className="text-sm text-muted-foreground">Le fichier original est introuvable dans le stockage.</p>}</DialogContent></Dialog>
  </div>;
}
