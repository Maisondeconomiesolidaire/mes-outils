import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "../../lib/cn";
import { useUpload } from "../../lib/useUpload";

type LocalPhoto = {
  storageId: Id<"_storage">;
  previewUrl: string;
};

export function PhotoUpload({
  value,
  onChange,
  className,
}: {
  value: Id<"_storage">[];
  onChange: (ids: Id<"_storage">[]) => void;
  className?: string;
}) {
  const upload = useUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (value.length === 0 && photos.length > 0) {
      setPhotos([]);
    }
  }, [photos.length, value.length]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const added: LocalPhoto[] = [];
      for (const file of Array.from(files)) {
        const storageId = await upload(file);
        added.push({ storageId, previewUrl: URL.createObjectURL(file) });
      }
      const next = [...photos, ...added];
      setPhotos(next);
      onChange(next.map((photo) => photo.storageId));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove(storageId: Id<"_storage">) {
    const next = photos.filter((photo) => photo.storageId !== storageId);
    setPhotos(next);
    onChange(next.map((photo) => photo.storageId));
  }

  return (
    <div className={className}>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {photos.map((photo) => (
          <div
            key={photo.storageId}
            className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]"
          >
            <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => remove(photo.storageId)}
              className="absolute right-2 top-2 rounded-full bg-black/50 p-1 text-white opacity-0 transition group-hover:opacity-100"
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
