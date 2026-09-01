import { useRef, useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "../../lib/cn";
import { useUpload } from "../../lib/useUpload";

export type Attachment = {
  storageId: Id<"_storage">;
  name?: string;
  contentType?: string;
  /** URL signée d'une pièce déjà enregistrée, ou aperçu local d'un ajout. */
  url?: string;
};

/**
 * Une pièce jointe est une image quand son type le dit. Les fiches d'avant
 * l'ajout des documents n'ont pas de type : elles ne contenaient que des
 * photos, on les affiche donc comme telles.
 */
export function isImageAttachment(item: { contentType?: string }) {
  return !item.contentType || item.contentType.startsWith("image/");
}

export function attachmentLabel(item: Attachment, index: number) {
  return item.name?.trim() || `Pièce jointe ${index + 1}`;
}

/**
 * Pièces jointes mixtes : photos ET documents (facture, devis, rapport…).
 * `MediaUpload` reste réservé aux galeries de photos ; ici le nom et le type
 * du fichier sont conservés, sinon un PDF arriverait dans une balise `img`.
 */
export function AttachmentUpload({
  items,
  onChange,
  className,
}: {
  items: Attachment[];
  onChange: (items: Attachment[]) => void;
  className?: string;
}) {
  const upload = useUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const added: Attachment[] = [];
      for (const file of Array.from(files)) {
        const storageId = await upload(file);
        added.push({
          storageId,
          name: file.name || undefined,
          // `useUpload` convertit les images en WebP : c'est le type réellement
          // stocké qui doit être retenu, pas celui du fichier d'origine.
          contentType: file.type
            ? file.type.startsWith("image/") && file.type !== "image/gif"
              ? "image/webp"
              : file.type
            : undefined,
          url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        });
      }
      onChange([...items, ...added]);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={className}>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {items.map((item, index) => (
          <div
            key={item.storageId}
            className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]"
          >
            {isImageAttachment(item) && item.url ? (
              <img src={item.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-[var(--muted-foreground)]">
                <FileText className="h-5 w-5" />
                <span className="line-clamp-2 break-all text-[11px] font-medium leading-tight">
                  {attachmentLabel(item, index)}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => onChange(items.filter((other) => other.storageId !== item.storageId))}
              className="absolute right-2 top-2 rounded-full bg-black/50 p-1 text-white opacity-0 transition group-hover:opacity-100"
              aria-label="Retirer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={cn(
            "flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-brand-300 bg-[var(--card)] text-brand-700 transition",
            "hover:bg-brand-50",
          )}
        >
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
          <span className="text-xs font-medium">Ajouter</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />
    </div>
  );
}
