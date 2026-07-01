import { createPortal } from "react-dom";
import { type ReactNode, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Classes optionnelles pour ajustements ponctuels. La taille de base reste 80vw × 80vh. */
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-2 sm:p-6">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        className={cn(
          // Plein écran sur mobile, panneau centré 80vw × 80vh à partir de sm.
          "relative z-10 flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-strong)]",
          "sm:h-[80vh] sm:w-[80vw] sm:max-w-[80vw]",
          className,
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:px-5 sm:py-4">
          <h2 className="truncate text-lg font-semibold text-[var(--foreground)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-2 text-[var(--muted-foreground)] transition hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
