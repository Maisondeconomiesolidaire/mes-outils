import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useMyApps, type AppKey } from "./MyApps";

/** Icône « applications » (grille de points, à la Google apps). */
function AppsDotsIcon({ className }: { className?: string }) {
  const dots = [5, 12, 19];
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      {dots.flatMap((cy) => dots.map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2} />))}
    </svg>
  );
}

/**
 * Sélecteur d'applications façon « Google apps » : un bouton en grille de points
 * qui ouvre une modale flottante (par-dessus tout) listant les applications de
 * l'écosystème accessibles à l'utilisateur.
 */
export function AppSwitcher({ current }: { current?: AppKey }) {
  const [open, setOpen] = useState(false);
  const apps = useMyApps(current);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Mes applications"
        title="Mes applications"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] transition hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
      >
        <AppsDotsIcon className="h-5 w-5" />
      </button>

      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-[400] flex items-start justify-center bg-black/40 p-4 backdrop-blur-[2px] sm:items-center"
              onClick={() => setOpen(false)}
            >
              <div
                className="w-full max-w-sm rounded-[28px] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_32px_80px_rgba(0,0,0,0.32)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-bold text-[var(--foreground)]">Mes applications</h2>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Fermer"
                    className="rounded-full p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {apps === undefined ? (
                  <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">Chargement…</p>
                ) : apps.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
                    Aucune autre application ne vous est attribuée.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-1">
                    {apps.map((app) => (
                      <a
                        key={app.key}
                        href={app.href}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setOpen(false)}
                        className="flex flex-col items-center gap-2 rounded-2xl p-3 text-center transition hover:bg-[var(--accent)]"
                      >
                        <span
                          className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl"
                          style={{ backgroundColor: app.cardBg }}
                        >
                          <img src={app.logoSrc} alt="" className="h-9 w-auto object-contain" />
                        </span>
                        <span className="text-xs font-semibold leading-tight text-[var(--foreground)]">
                          {app.label}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
