import { useEffect, useMemo, useState } from "react";

function signatureFromDocument() {
  const assets = [
    ...Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).map(
      (node) => node.src,
    ),
    ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')).map(
      (node) => node.href,
    ),
  ];
  return assets.filter((asset) => asset.includes("/assets/")).sort().join("|");
}

function signatureFromHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const assets = [
    ...Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]")).map((node) =>
      new URL(node.getAttribute("src") ?? "", window.location.origin).href,
    ),
    ...Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')).map(
      (node) => new URL(node.getAttribute("href") ?? "", window.location.origin).href,
    ),
  ];
  return assets.filter((asset) => asset.includes("/assets/")).sort().join("|");
}

export function UpdateAvailableBanner({ appName }: { appName: string }) {
  const initialSignature = useMemo(signatureFromDocument, []);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!initialSignature) return;
    let cancelled = false;

    async function checkForUpdate() {
      try {
        const response = await fetch(`/?__version_check=${Date.now()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const nextSignature = signatureFromHtml(await response.text());
        if (!cancelled && nextSignature && nextSignature !== initialSignature) {
          setUpdateAvailable(true);
        }
      } catch {
        // La vérification est best-effort : une erreur réseau ne doit pas gêner l'app.
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };

    const interval = window.setInterval(checkForUpdate, 60_000);
    window.addEventListener("focus", checkForUpdate);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void checkForUpdate();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", checkForUpdate);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [initialSignature]);

  if (!updateAvailable) return null;

  const brandStyle = {
    backgroundColor: "var(--color-brand-600, var(--primary, #1f8a80))",
  };

  return (
    <div className="fixed inset-x-0 top-3 z-[500] px-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[var(--foreground)] shadow-[var(--shadow-strong,0_18px_48px_rgba(0,0,0,0.18))] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3 text-left">
          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={brandStyle} />
          <div className="min-w-0">
            <p className="font-semibold">Selim a encore bricolé deux-trois trucs...</p>
            <p className="mt-1 text-sm leading-5 text-[var(--muted-foreground)]">
              Pour profiter de la dernière version de {appName}, pensez à rafraîchir la page. Promis, c'est pour le mieux.
            </p>
          </div>
        </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
          className="inline-flex shrink-0 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          style={brandStyle}
      >
          Rafraîchir
      </button>
      </div>
    </div>
  );
}
