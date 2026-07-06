import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "./cn";

/**
 * Confirmations/alertes via un vrai modal (au lieu des `window.confirm/alert`
 * du navigateur). Usage impératif : `if (!(await confirmPermanentDelete(...)))`.
 * `<ConfirmRoot />` doit être monté une fois à la racine de l'app.
 */

const DEFAULT_DELETE_MESSAGE =
  "Cette action supprimera définitivement cet élément. Voulez-vous continuer ?";

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /** Alerte simple (un seul bouton, pas d'annulation). */
  alert?: boolean;
};

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

let trigger: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

function openDialog(opts: ConfirmOptions): Promise<boolean> {
  if (!trigger) {
    // Repli si le root n'est pas monté (tests, SSR).
    if (opts.alert) {
      window.alert(opts.message);
      return Promise.resolve(true);
    }
    return Promise.resolve(window.confirm(opts.message));
  }
  return trigger(opts);
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return openDialog(opts);
}

export function confirmPermanentDelete(message = DEFAULT_DELETE_MESSAGE): Promise<boolean> {
  return openDialog({
    title: "Suppression définitive",
    message,
    confirmLabel: "Supprimer",
    tone: "danger",
  });
}

export function alertDialog(message: string, title = "Information"): Promise<boolean> {
  return openDialog({ title, message, alert: true, confirmLabel: "J'ai compris" });
}

export function ConfirmRoot() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    trigger = (opts) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve }));
    return () => {
      trigger = null;
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        pending.resolve(false);
        setPending(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [pending]);

  if (!pending) return null;

  const close = (result: boolean) => {
    pending.resolve(result);
    setPending(null);
  };
  const danger = pending.tone !== "primary" && !pending.alert;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]" onClick={() => close(false)} aria-hidden="true" />
      <div className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
              danger ? "bg-red-500/12 text-red-500" : "bg-brand-500/12 text-brand-600",
            )}
          >
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {pending.title ?? "Confirmer"}
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{pending.message}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          {!pending.alert && (
            <button
              type="button"
              onClick={() => close(false)}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--accent)]"
            >
              {pending.cancelLabel ?? "Annuler"}
            </button>
          )}
          <button
            type="button"
            autoFocus
            onClick={() => close(true)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold text-white transition",
              danger ? "bg-red-600 hover:bg-red-700" : "bg-brand-500 hover:bg-brand-600",
            )}
          >
            {pending.confirmLabel ?? "Confirmer"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
