// REFONTE CAISSE + IMAGE ARTICLE : point unique pour tout ce qui touche à
// l'image d'un article Commerce -- URL publique, miniature avec repli
// neutre, et le champ d'upload partagé par la création (CommerceQuickInventoryReceipt)
// et la modification (ItemImageEditDialog, store-management-cockpit.tsx).
//
// Audit préalable (voir commit) : aucune architecture image n'existait pour
// inventory_items -- le seul upload réel du projet est le bucket privé
// "documents" (document-upload.tsx). Ce fichier reprend son schéma exact
// (upload direct navigateur -> Storage, puis metadata en base, avec
// nettoyage si l'étape metadata échoue après un upload réussi) pour un
// nouveau bucket public dédié, commerce-item-images -- l'image produit
// n'est pas une donnée sensible.
import { useRef, useState } from "react";
import { ImageOff, Loader2, Package, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const COMMERCE_ITEM_IMAGE_BUCKET = "commerce-item-images";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 Mo, aligné sur le file_size_limit du bucket.

/** Chemin -> URL publique. Pure concaténation pour un bucket public, aucun appel réseau. */
export function commerceItemImageUrl(imagePath: string | null | undefined): string | null {
  if (!imagePath) return null;
  return supabase.storage.from(COMMERCE_ITEM_IMAGE_BUCKET).getPublicUrl(imagePath).data.publicUrl;
}

// Redimensionnement + normalisation d'orientation cote client, avant
// upload -- simple, sans dependance : createImageBitmap avec
// imageOrientation:"from-image" applique deja la rotation EXIF, un canvas
// fait le reste. Repli sur le fichier original si quoi que ce soit echoue
// (navigateur ancien, image corrompue) : mieux vaut une image un peu plus
// lourde qu'un upload bloque.
async function prepareImageForUpload(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const maxDimension = 1024;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.85),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

export function validateCommerceItemImageFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return "Formats acceptés : JPEG, PNG ou WebP.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "Image trop lourde (5 Mo maximum).";
  }
  return null;
}

/**
 * Upload direct navigateur -> Storage (comme document-upload.tsx), en
 * amont de tout enregistrement en base : l'appelant reçoit un `imagePath`
 * à transmettre au serveur (création ou update_commerce_inventory_item_image),
 * jamais le binaire lui-même.
 */
export async function uploadCommerceItemImage(file: File): Promise<string> {
  const prepared = await prepareImageForUpload(file);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "image.jpg";
  const path = `${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from(COMMERCE_ITEM_IMAGE_BUCKET)
    .upload(path, prepared, { upsert: false, contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}

export async function removeCommerceItemImageObject(imagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(COMMERCE_ITEM_IMAGE_BUCKET).remove([imagePath]);
  if (error) console.error(error);
}

/**
 * Miniature avec repli neutre -- ne bloque jamais l'affichage du produit,
 * l'ajout au panier ni l'encaissement si l'image manque ou échoue à
 * charger (onError bascule silencieusement sur le placeholder).
 */
export function CommerceItemThumb({
  imagePath,
  alt,
  className = "size-10 rounded-lg",
}: {
  imagePath: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = commerceItemImageUrl(imagePath);
  if (!url || failed) {
    return (
      <div
        className={`grid shrink-0 place-items-center bg-muted text-muted-foreground ${className}`}
        aria-hidden="true"
      >
        <Package className="size-[45%]" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 object-cover ${className}`}
    />
  );
}

/**
 * Zone "Image de l'article" complète : choisir, aperçu, remplacer,
 * supprimer, chargement, erreur. Utilisée à la création (upload différé --
 * le fichier n'est envoyé qu'à la validation du formulaire parent, voir
 * `onFileSelected`) et à la modification (upload immédiat, voir
 * ItemImageEditDialog dans store-management-cockpit.tsx).
 */
export function CommerceItemImageField({
  previewUrl,
  onFileSelected,
  onRemove,
  uploading,
  disabled,
}: {
  previewUrl: string | null;
  onFileSelected: (file: File) => void;
  onRemove: () => void;
  uploading: boolean;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    const validationError = validateCommerceItemImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    onFileSelected(file);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Aperçu de l’article"
            className="size-16 shrink-0 rounded-lg border border-border object-cover"
          />
        ) : (
          <div
            className="grid size-16 shrink-0 place-items-center rounded-lg border border-dashed border-border bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            {uploading ? <Loader2 className="size-5 animate-spin" /> : <ImageOff className="size-5" />}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            {previewUrl ? "Remplacer" : "Choisir une image"}
          </Button>
          {previewUrl ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || uploading}
              onClick={() => {
                setError(null);
                onRemove();
              }}
            >
              <Trash2 className="size-3.5" />
              Supprimer
            </Button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            handleChange(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <p className="text-xs text-muted-foreground">JPEG, PNG ou WebP · 5 Mo maximum · facultatif.</p>
    </div>
  );
}
