import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Sparkles } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Button } from "../ui/Button";
import { Textarea } from "../ui/Field";

export function SocialAiAssistant({ networks, pageNames, onApply }: { networks: ("facebook" | "instagram")[]; pageNames: string[]; onApply: (text: string) => void }) {
  const generate = useAction(api.socialAi.generate);
  const recent = useQuery(api.socialAi.recent, {});
  const [keywords, setKeywords] = useState("");
  const [proposal, setProposal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <section className="space-y-3 rounded-2xl border border-brand-500/30 bg-brand-500/5 p-4" aria-label="Assistant community manager">
    <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-5 w-5" /> Rédiger avec l’IA</h3>
    <p className="text-sm text-[var(--muted-foreground)]">Donnez les mots-clés et les informations utiles : sujet, offre, public, lieu ou date.</p>
    <Textarea aria-label="Mots-clés pour le post" rows={3} value={keywords} maxLength={3000} onChange={event => setKeywords(event.target.value)} placeholder="Ex. arrivage de meubles, seconde main, nouveautés à découvrir en magasin…" />
    <Button variant="secondary" disabled={busy || !keywords.trim() || !networks.length} onClick={async () => {
      setBusy(true); setError("");
      try { const result = await generate({ keywords, networks, pageNames }); setProposal(result.text); }
      catch (err) { setError(err instanceof Error ? err.message : "La génération a échoué."); }
      finally { setBusy(false); }
    }}><Sparkles className="h-4 w-4" />{busy ? "Rédaction en cours…" : proposal ? "Générer une autre proposition" : "Générer un post"}</Button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {proposal && <div className="space-y-3 rounded-xl bg-[var(--card)] p-3"><p className="whitespace-pre-wrap text-sm">{proposal}</p><Button onClick={() => onApply(proposal)}>Utiliser ce texte</Button><p className="text-xs text-[var(--muted-foreground)]">Le texte reste modifiable avant publication.</p></div>}
    {Boolean(recent?.length) && <details className="text-sm"><summary className="cursor-pointer font-medium">Mes dernières propositions</summary><div className="mt-2 space-y-2">{recent?.map(draft => <button type="button" key={draft.id} onClick={() => setProposal(draft.text)} className="block w-full rounded-lg bg-[var(--card)] p-2 text-left"><span className="block truncate">{draft.keywords}</span><span className="text-xs text-[var(--muted-foreground)]">{new Date(draft.createdAt).toLocaleString("fr-FR")}</span></button>)}</div></details>}
  </section>;
}
