import { useLocation, useSearchParams } from "react-router-dom";
import { SECTION_SUBNAV, sectionForPath } from "../../lib/permissions";
import { UnderlineTabs } from "./UnderlineTabs";

/**
 * Onglets de sous-pages d'une section (Réservations, Gotravaux, Salles…),
 * pilotés par le paramètre d'URL `?v=`. À placer en haut du contenu de page.
 */
export function SectionTabs({ className }: { className?: string }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = sectionForPath(location.pathname);
  const subnav = (section && SECTION_SUBNAV[section.to]) ?? [];
  if (subnav.length === 0) return null;

  const active = searchParams.get("v") ?? subnav[0].key;

  return (
    <UnderlineTabs
      className={className}
      items={subnav.map((item) => ({ key: item.key, label: item.label, icon: item.icon }))}
      value={active}
      onChange={(key) => {
        const next = new URLSearchParams(searchParams);
        next.set("v", key);
        setSearchParams(next, { replace: true });
      }}
    />
  );
}
