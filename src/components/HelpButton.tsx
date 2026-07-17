import { HelpCircle } from "lucide-react";

const env = import.meta.env as Record<string, string | undefined>;

/**
 * Bouton d'aide flottant, présent dans les 7 apps : renvoie vers l'app Feedback
 * pour signaler un problème ou demander de l'aide depuis n'importe quel écran.
 *
 * Fixe en haut à droite. En mobile il descend sous la barre supérieure
 * (`h-14`), sinon il recouvrirait le sélecteur d'applications et l'avatar ; en
 * desktop la sidebar est latérale et le coin est libre.
 *
 * Volontairement construit sur `--card` / `--border` / `--foreground` : ce sont
 * les seuls tokens définis dans les 7 apps (klyde n'a pas de `brand-*`, ni
 * d'`--accent`), donc le bouton s'intègre partout sans être retouché.
 */
export function HelpButton() {
  const href = env.VITE_FEEDBACK_URL?.trim() || "https://feedback.groupemes.fr";
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Aide — signaler un problème ou proposer une idée"
      aria-label="Aide"
      className="fixed right-3 top-16 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] shadow-lg transition hover:scale-105 hover:shadow-xl lg:top-3"
    >
      <HelpCircle className="h-5 w-5" />
    </a>
  );
}
