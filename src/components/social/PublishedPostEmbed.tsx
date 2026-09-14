import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "../ui/Button";

type Preview = { permalink: string; embedUrl: string; network: string };
export function PublishedPostEmbed({ id }: { id: string }) {
  const resolve = useAction(api.socialEnhancements.publishedPreview);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPreview(null); setError("");
    resolve({ id }).then(result => { if (!cancelled) setPreview(result); }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "L'aperçu est indisponible."); });
    return () => { cancelled = true; };
  }, [id, attempt, resolve]);
  if (error) return <div className="space-y-3 rounded-xl bg-[var(--accent)] p-4"><p role="alert" className="text-sm">{error}</p><Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>Réessayer l'aperçu</Button></div>;
  if (!preview) return <p role="status" className="text-sm">Chargement de la publication originale…</p>;
  return <div className="space-y-3">
    <div className="mx-auto max-w-[540px] overflow-hidden rounded-xl border border-[var(--border)] bg-white">
      <iframe key={preview.embedUrl} src={preview.embedUrl} title={`Publication originale ${preview.network === "facebook" ? "Facebook" : "Instagram"}`} className="h-[760px] w-full border-0" allow="encrypted-media; picture-in-picture; clipboard-write; web-share" allowFullScreen />
    </div>
    <p className="text-center text-sm"><a href={preview.permalink} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline">Ouvrir le post sur {preview.network === "facebook" ? "Facebook" : "Instagram"}</a></p>
    <p className="text-center text-xs text-[var(--muted-foreground)]">Si le réseau bloque l’affichage intégré, ouvrez le post avec le lien ci-dessus.</p>
  </div>;
}
