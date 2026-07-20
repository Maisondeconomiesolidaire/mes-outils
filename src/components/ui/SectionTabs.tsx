import { useQuery } from "convex/react";
import { useLocation, useSearchParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { SECTION_SUBNAV, canAccess, sectionForPath } from "../../lib/permissions";
import { usePermissionsAccess } from "../RequirePermission";
import { UnderlineTabs } from "./UnderlineTabs";

/**
 * Répartit les notifications non lues sur les sous-onglets de la section
 * courante, à partir du `href` que porte chaque notification.
 *
 * Une notification pointe `/gotravaux?v=reservations` : arrivé sur Gotravaux,
 * l'utilisateur voit la pastille sur « Réservations » et sait d'où vient
 * l'alerte de la sidebar. Les `href` sans `?v=` ne désignent aucun onglet et
 * sont ignorés.
 */
function useTabBadges(sectionPath: string | undefined) {
  const counts = useQuery(api.mesoutilsNotifications.unreadCountsByHref, {}) as
    | Record<string, number>
    | undefined;
  if (!sectionPath || !counts) return {};
  const badges: Record<string, number> = {};
  for (const [href, count] of Object.entries(counts)) {
    const [path, queryString] = href.split("?");
    if (path !== sectionPath || !queryString) continue;
    const tab = new URLSearchParams(queryString).get("v");
    if (!tab) continue;
    badges[tab] = (badges[tab] ?? 0) + count;
  }
  return badges;
}

/**
 * Onglets de sous-pages d'une section (Réservations, Gotravaux, Salles…),
 * pilotés par le paramètre d'URL `?v=`. À placer en haut du contenu de page.
 */
export function SectionTabs({ className }: { className?: string }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const access = usePermissionsAccess();
  const section = sectionForPath(location.pathname);
  const badges = useTabBadges(section?.to);
  const subnav = ((section && SECTION_SUBNAV[section.to]) ?? []).filter(
    (item) => !item.pageKey || canAccess(access, item.pageKey),
  );
  if (subnav.length === 0) return null;

  const active = searchParams.get("v") ?? subnav[0].key;

  return (
    <UnderlineTabs
      className={className}
      items={subnav.map((item) => ({ key: item.key, label: item.label, icon: item.icon }))}
      value={active}
      badges={badges}
      onChange={(key) => {
        const next = new URLSearchParams(searchParams);
        next.set("v", key);
        setSearchParams(next, { replace: true });
      }}
    />
  );
}
