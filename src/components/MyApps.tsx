import { useConvexAuth, useQuery } from "convex/react";
import { ArrowUpRight } from "lucide-react";
import { api } from "../../convex/_generated/api";

/**
 * Grille « Mes applications » — identique dans toutes les apps de l'écosystème
 * (Mes Outils, Recyclerie, Klyd, Cycle en Bray, Bennes & Pro). Reprend les
 * cartes du portail Mes Outils et ne montre que les applications auxquelles
 * l'utilisateur connecté a réellement accès (droits `permissions.myAccess`).
 *
 * On masque toujours l'application courante (`current`) : depuis une app on ne
 * voit que les *autres*, plus un retour vers le portail Mes Outils. Les liens
 * pointent directement vers l'application (son CRM), pas vers le portail.
 *
 * Fichier volontairement autonome (aucune dépendance à la lib de permissions
 * locale) pour pouvoir être copié tel quel dans chaque dépôt.
 */

export type AppKey = "mesoutils" | "recycapp" | "klyde" | "cycleenbray" | "bennespro" | "pointeuse";

type Access = {
  role: string;
  isStaff: boolean;
  isAdmin: boolean;
  email: string | null;
  bootstrapMode: boolean;
  grants: { pageKey: string; actions: string[] }[];
};

type PortalApp = {
  key: AppKey;
  label: string;
  description: string;
  logoSrc: string;
  href: string;
  cardBg: string;
};

const env = import.meta.env as Record<string, string | undefined>;

const APPS: PortalApp[] = [
  {
    key: "mesoutils",
    label: "Mes Outils",
    description: "Portail interne : accès aux applications, espace partage et réservations.",
    logoSrc: "/mesoutils-light.png",
    href: env.VITE_MESOUTILS_URL ?? "https://mesoutils.eco-solidaire.fr",
    cardBg: "#e6f6ec",
  },
  {
    key: "recycapp",
    label: "Recyclerie",
    description: "CRM de gestion pour les demandes, la boutique, le stock et les clients.",
    logoSrc: "/recyclerie-logo.png",
    href: env.VITE_RECYCAPP_URL ?? "https://mesrecycleries.vercel.app/crm",
    cardBg: "#ffffff",
  },
  {
    key: "klyde",
    label: "Klyd",
    description: "Boutique textile : stock, mise en ligne et suivi des commandes.",
    logoSrc: "/klyd-logo.png",
    href: env.VITE_KLYD_URL ?? "https://klyd.vercel.app",
    cardBg: "#f6eee5",
  },
  {
    key: "cycleenbray",
    label: "Cycle en Bray",
    description: "Boutique et CRM de gestion pour la Recyclerie 60 et 76.",
    logoSrc: "/cycle-en-bray-logo.webp",
    href: env.VITE_CYCLEENBRAY_URL ?? "https://cycleenbray.vercel.app/crm",
    cardBg: "#eef7f1",
  },
  {
    key: "bennespro",
    label: "Bennes & Pro",
    description: "Gestion déchet'lab",
    logoSrc: "/bennespro-logo.png",
    href: env.VITE_BENNESPRO_URL ?? "https://bennespro.vercel.app",
    cardBg: "#a4cebe",
  },
  {
    key: "pointeuse",
    label: "Pointeuse",
    description: "Suivi des salariés et des chantiers : pointages, projets, dépenses et factures.",
    logoSrc: "/logo-lsdb.png",
    href: env.VITE_POINTEUSE_URL ?? "https://pointeuselsdb.vercel.app",
    cardBg: "#fff1e5",
  },
];

/** Réplique la logique `appCanAccess` du portail Mes Outils. */
function appCanAccess(access: Access, key: AppKey): boolean {
  if (access.isAdmin || access.bootstrapMode) return true;
  if (!access.isStaff) return false;
  if (key === "mesoutils") return access.grants.some((g) => g.pageKey.startsWith("mesoutils:"));
  if (key === "klyde") return access.grants.some((g) => g.pageKey.startsWith("klyde:"));
  if (key === "cycleenbray") return access.grants.some((g) => g.pageKey.startsWith("cycle:"));
  if (key === "bennespro") return access.grants.some((g) => g.pageKey.startsWith("bennespro:"));
  if (key === "pointeuse") return access.grants.some((g) => g.pageKey.startsWith("pointeuse:"));
  // recycapp : pages sans préfixe d'application (flotte, demandes, tournees…).
  return access.grants.some((g) => !g.pageKey.includes(":"));
}

/**
 * Applications accessibles à l'utilisateur, hors application courante.
 * `undefined` tant que les droits chargent ; `[]` si aucune app attribuée.
 */
export function useMyApps(current?: AppKey): PortalApp[] | undefined {
  // On ne requête `myAccess` que si l'utilisateur est authentifié : la fonction
  // lève « Non authentifié » sinon (elle est montée aussi sur des pages compte
  // accessibles déconnecté, ex. l'espace client Recyclerie / Cycle en Bray).
  const { isAuthenticated } = useConvexAuth();
  const access = useQuery(api.permissions.myAccess, isAuthenticated ? {} : "skip") as
    | Access
    | undefined;
  if (!isAuthenticated) return [];
  if (access === undefined) return undefined;
  return APPS.filter((app) => app.key !== current && appCanAccess(access, app.key));
}

export function MyAppsGrid({ current }: { current?: AppKey }) {
  const apps = useMyApps(current);

  if (apps === undefined) {
    return <p className="py-10 text-center text-sm text-zinc-500">Chargement…</p>;
  }
  if (apps.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-zinc-500">
        Aucune autre application ne vous est attribuée pour le moment.
      </p>
    );
  }

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {apps.map((app) => (
        <a key={app.key} href={app.href} target="_blank" rel="noreferrer" className="block">
          <div
            className="h-full rounded-lg border border-black/5 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
            style={{ backgroundColor: app.cardBg, color: "#1f1b18" }}
          >
            <div className="flex items-start justify-between gap-4">
              <img src={app.logoSrc} alt={app.label} className="h-14 w-auto object-contain" />
              <ArrowUpRight className="h-5 w-5 text-[#1f1b18]/55" />
            </div>
            <h3 className="mt-5 text-lg font-semibold">{app.label}</h3>
            <p className="mt-2 text-sm leading-6 text-[#1f1b18]/70">{app.description}</p>
            <div className="mt-5 text-sm font-medium text-[#1f1b18]/80">Ouvrir</div>
          </div>
        </a>
      ))}
    </section>
  );
}
