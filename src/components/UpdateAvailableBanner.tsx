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

export function UpdateAvailableBanner() {
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

  return (
    <div className="fixed inset-x-0 top-0 z-[500] border-b border-amber-300/70 bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-950 shadow-lg">
      <span>Cette page vient d'être mise à jour. Actualisez la page pour profiter de la dernière version.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="ml-3 rounded-md bg-amber-950 px-3 py-1 text-xs font-semibold text-white transition hover:bg-amber-900"
      >
        Actualiser
      </button>
    </div>
  );
}
