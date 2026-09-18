import { useEffect, useRef, useState } from "react";
import { Film, Loader2, X } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "../../lib/cn";
import { useUpload } from "../../lib/useUpload";

type LocalVideo = {
  storageId: Id<"_storage">;
  previewUrl: string;
  name: string;
};

/**
 * Plafond par vidéo, identique côté serveur (`posts.ts`, `socialComposer.ts`).
 * Une vidéo servie depuis Convex se paie en data egress : le fil ne la
 * précharge pas et on refuse ici ce qui serait trop lourd, plutôt que de
 * laisser l'envoi échouer après plusieurs minutes.
 */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/**
 * Envoi de vidéos. Séparé de `MediaUpload` (photos) : les réseaux ne mélangent
 * pas vidéo et photos dans une même publication, et l'aperçu d'une vidéo n'a
 * rien d'une vignette carrée.
 */
export function VideoUpload({
  value,
  onChange,
  onPreviewsChange,
  onUploadingChange,
  max = 1,
  initialMedia = [],
  className,
}: {
  value: Id<"_storage">[];
  onChange: (ids: Id<"_storage">[]) => void;
  /** Aperçus locaux : le fichier choisi n'est lisible que dans cet onglet. */
  onPreviewsChange?: (previews: { storageId: Id<"_storage">; previewUrl: string }[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
  max?: number;
  initialMedia?: { storageId: Id<"_storage">; previewUrl: string }[];
  className?: string;
}) {
  const upload = useUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [videos, setVideos] = useState<LocalVideo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const valueKey = value.join("|");
  const initialKey = initialMedia.map((item) => `${item.storageId}:${item.previewUrl}`).join("|");

  // La liste affichée suit toujours `value` : un parent qui vide sa sélection
  // (post envoyé, formulaire réinitialisé) ne doit pas laisser d'aperçu.
  useEffect(() => {
    setVideos((current) => {
      const byId = new Map(current.map((item) => [item.storageId, item]));
      const initialById = new Map(initialMedia.map((item) => [item.storageId, item]));
      return value.map(
        (id) =>
          byId.get(id) ??
          (initialById.has(id)
            ? { storageId: id, previewUrl: initialById.get(id)!.previewUrl, name: "Vidéo" }
            : { storageId: id, previewUrl: "", name: "Vidéo" }),
      );
    });
  }, [valueKey, initialKey]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const room = max - videos.length;
    if (room <= 0) {
      setError(`${max} vidéo${max > 1 ? "s" : ""} au maximum.`);
      return;
    }
    setUploading(true);
    onUploadingChange?.(true);
    try {
      const added: LocalVideo[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        if (!file.type.startsWith("video/")) {
          setError("Ce fichier n'est pas une vidéo.");
          continue;
        }
        if (file.size > MAX_VIDEO_BYTES) {
          setError(
            `« ${file.name} » fait ${Math.round(file.size / 1024 / 1024)} Mo : ${MAX_VIDEO_BYTES / 1024 / 1024} Mo au maximum.`,
          );
          continue;
        }
        const storageId = await upload(file);
        added.push({ storageId, previewUrl: URL.createObjectURL(file), name: file.name });
      }
      if (added.length) update([...videos, ...added]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'envoyer la vidéo.");
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function update(next: LocalVideo[]) {
    setVideos(next);
    onChange(next.map((item) => item.storageId));
    onPreviewsChange?.(next.map(({ storageId, previewUrl }) => ({ storageId, previewUrl })));
  }

  return (
    <div className={cn("space-y-3", className)}>
      {videos.map((item) => (
        <div
          key={item.storageId}
          className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-black"
        >
          {item.previewUrl ? (
            <video
              src={item.previewUrl}
              controls
              playsInline
              preload="metadata"
              className="aspect-video max-h-80 w-full bg-black object-contain"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center gap-2 text-sm text-white/70">
              <Film className="h-5 w-5" /> Vidéo envoyée
            </div>
          )}
          <button
            type="button"
            onClick={() => update(videos.filter((video) => video.storageId !== item.storageId))}
            className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white transition hover:bg-black/80"
            aria-label={`Retirer ${item.name}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      {videos.length < max ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-brand-300 bg-[var(--card)] px-4 py-6 text-brand-700 transition hover:bg-brand-50 disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Film className="h-5 w-5" />}
          <span className="text-sm font-medium">
            {uploading ? "Envoi de la vidéo…" : "Ajouter une vidéo"}
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">
            MP4 ou MOV · {MAX_VIDEO_BYTES / 1024 / 1024} Mo au maximum
          </span>
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple={max > 1}
        className="hidden"
        onChange={(event) => handleFiles(event.target.files)}
      />
    </div>
  );
}
