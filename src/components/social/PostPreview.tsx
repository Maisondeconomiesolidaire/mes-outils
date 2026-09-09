import { Globe2, Heart, MessageCircle, MoreHorizontal, Send, ThumbsUp } from "lucide-react";
import { FacebookIcon } from "../icons/FacebookIcon";
import { InstagramIcon } from "../icons/InstagramIcon";
import { cn } from "../../lib/cn";

/**
 * Aperçu d'une publication, dessiné par nous.
 *
 * Ni Facebook ni Instagram n'exposent d'aperçu par API : il n'existe aucun
 * point d'entrée qui rende une image du post avant publication. L'aperçu est
 * donc une reproduction de la mise en page des deux réseaux — assez fidèle
 * pour juger le cadrage, la longueur du texte et l'ordre des photos, sans
 * prétendre au pixel près.
 *
 * Il s'affiche toujours en clair, même quand Mes Outils est en thème sombre :
 * c'est ainsi que le post apparaîtra à ses lecteurs.
 */

/** En-tête commun : pastille du compte, nom, et ce qui tient lieu de date. */
function AccountLine({
  name,
  subtitle,
  network,
}: {
  name: string;
  subtitle: string;
  network: "facebook" | "instagram";
}) {
  const initial = name.replace(/^@/, "").charAt(0).toUpperCase() || "?";
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white",
          network === "facebook"
            ? "bg-[#1877F2]"
            : "bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF]",
        )}
      >
        {initial}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-zinc-900">{name}</span>
        <span className="flex items-center gap-1 text-[11px] text-zinc-500">
          {subtitle}
          {network === "facebook" ? <Globe2 className="h-3 w-3" /> : null}
        </span>
      </span>
    </div>
  );
}

/** Grille de photos façon Facebook : 1 pleine, 2 côte à côte, 3+ en mosaïque. */
function PhotoGrid({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  if (urls.length === 1) {
    return <img src={urls[0]} alt="" className="max-h-80 w-full bg-zinc-100 object-cover" />;
  }
  const shown = urls.slice(0, 4);
  const extra = urls.length - shown.length;
  return (
    <div
      className={cn(
        "grid gap-0.5 bg-white",
        shown.length === 2 ? "grid-cols-2" : "grid-cols-2",
      )}
    >
      {shown.map((url, index) => (
        <div key={url} className="relative">
          <img
            src={url}
            alt=""
            className={cn(
              "h-40 w-full bg-zinc-100 object-cover",
              shown.length === 3 && index === 0 ? "col-span-2 h-48" : "",
            )}
          />
          {extra > 0 && index === shown.length - 1 ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-xl font-bold text-white">
              +{extra}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function FacebookPostPreview({
  accountName,
  message,
  photoUrls,
  scheduledFor,
}: {
  accountName: string;
  message: string;
  photoUrls: string[];
  scheduledFor?: number | null;
}) {
  const when = scheduledFor
    ? new Date(scheduledFor).toLocaleString("fr-FR", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "À l'instant";
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 p-3">
        <AccountLine name={accountName} subtitle={when} network="facebook" />
        <MoreHorizontal className="h-4 w-4 shrink-0 text-zinc-400" />
      </div>

      {message ? (
        <p className="whitespace-pre-wrap px-3 pb-3 text-[14px] leading-[1.45] text-zinc-900">
          {message}
        </p>
      ) : (
        <p className="px-3 pb-3 text-[14px] italic text-zinc-400">Message vide</p>
      )}

      <PhotoGrid urls={photoUrls} />

      <div className="flex items-center justify-around border-t border-zinc-200 px-3 py-1.5 text-[13px] font-semibold text-zinc-500">
        <span className="flex items-center gap-1.5">
          <ThumbsUp className="h-4 w-4" /> J'aime
        </span>
        <span className="flex items-center gap-1.5">
          <MessageCircle className="h-4 w-4" /> Commenter
        </span>
        <span className="flex items-center gap-1.5">
          <FacebookIcon className="h-4 w-4" /> Partager
        </span>
      </div>
    </div>
  );
}

export function InstagramPostPreview({
  accountName,
  caption,
  photoUrls,
}: {
  accountName: string;
  caption: string;
  photoUrls: string[];
}) {
  const handle = accountName.replace(/^@/, "");
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 p-3">
        <AccountLine name={handle} subtitle="Publication" network="instagram" />
        <MoreHorizontal className="h-4 w-4 shrink-0 text-zinc-400" />
      </div>

      {/* Instagram n'a pas de post sans image : l'aperçu le montre plutôt que
          de laisser croire à une publication texte possible. */}
      {photoUrls.length > 0 ? (
        <div className="relative">
          <img src={photoUrls[0]} alt="" className="aspect-square w-full bg-zinc-100 object-cover" />
          {photoUrls.length > 1 ? (
            <>
              <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
                1/{photoUrls.length}
              </span>
              <span className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
                {photoUrls.slice(0, 10).map((url, index) => (
                  <span
                    key={url}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      index === 0 ? "bg-white" : "bg-white/50",
                    )}
                  />
                ))}
              </span>
            </>
          ) : null}
        </div>
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-zinc-100 text-center text-sm text-zinc-500">
          <span className="flex flex-col items-center gap-2">
            <InstagramIcon className="h-6 w-6 text-zinc-400" />
            Ajoutez une photo : Instagram n'accepte pas de publication sans image.
          </span>
        </div>
      )}

      <div className="flex items-center gap-4 px-3 pt-3 text-zinc-800">
        <Heart className="h-5 w-5" />
        <MessageCircle className="h-5 w-5" />
        <Send className="h-5 w-5" />
      </div>

      <p className="line-clamp-4 whitespace-pre-wrap px-3 pb-3 pt-2 text-[13px] leading-[1.5] text-zinc-900">
        <span className="font-semibold">{handle}</span>{" "}
        {caption || <span className="italic text-zinc-400">Légende vide</span>}
      </p>
    </div>
  );
}
