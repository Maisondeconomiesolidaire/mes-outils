import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "../../lib/cn";
import { useUpload } from "../../lib/useUpload";

type LocalMedia = {
  storageId: Id<"_storage">;
  previewUrl: string;
};

/**
 * Upload de photos pour les publications. Les vidéos ne sont plus acceptées :
 * servies depuis Convex, elles faisaient exploser le data egress.
 */
export function MediaUpload({
  images,
  onChange,
  className,
}: {
  images: Id<"_storage">[];
  onChange: (images: Id<"_storage">[]) => void;
  className?: string;
}) {
  const upload = useUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<LocalMedia[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (images.length === 0 && media.length > 0) {
      setMedia([]);
    }
  }, [images.length, media.length]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const added: LocalMedia[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const storageId = await upload(file);
        added.push({
          storageId,
          previewUrl: URL.createObjectURL(file),
        });
      }
      update([...media, ...added]);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function update(next: LocalMedia[]) {
    setMedia(next);
    onChange(next.map((item) => item.storageId));
  }

  function remove(storageId: Id<"_storage">) {
    update(media.filter((item) => item.storageId !== storageId));
  }

  return (
    <div className={className}>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {media.map((item) => (
          <div
            key={item.storageId}
            className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]"
          >
            <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => remove(item.storageId)}
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
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
          <span className="text-xs font-medium">Ajouter</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => handleFiles(event.target.files)}
      />
    </div>
  );
}
