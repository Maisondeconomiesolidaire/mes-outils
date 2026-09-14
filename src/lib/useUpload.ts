import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const MAX_DIMENSION = 1600;
const WEBP_QUALITY = 0.82;

async function compressImage(file: File, jpeg = false): Promise<File> {
  if (!file.type.startsWith("image/") || (!jpeg && file.type === "image/gif")) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    if (jpeg) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, jpeg ? "image/jpeg" : "image/webp", WEBP_QUALITY),
    );
    if (!blob || (!jpeg && blob.size >= file.size)) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + (jpeg ? ".jpg" : ".webp"), {
      type: jpeg ? "image/jpeg" : "image/webp",
    });
  } catch {
    return file;
  }
}

export function useUpload({ jpeg = false }: { jpeg?: boolean } = {}) {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);

  return async function upload(file: File): Promise<Id<"_storage">> {
    const optimized = await compressImage(file, jpeg);
    const url = await generateUploadUrl();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": optimized.type },
      body: optimized,
    });
    if (!res.ok) throw new Error("Echec de l'envoi du fichier.");
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    return storageId;
  };
}
