import {
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export type Action =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "manage"
  | "reply"
  | "share"
  | "checkout"
  | "print"
  | "analyze"
  | "start";

export type Grant = {
  pageKey: string;
  actions: string[];
};

export type Access = {
  role: string;
  isStaff: boolean;
  isAdmin: boolean;
  email: string | null;
  bootstrapMode: boolean;
  grants: Grant[];
};

export type AppDefinition = {
  key: "recycapp" | "mesoutils" | "pointage" | "collecte";
  label: string;
  description: string;
  icon: LucideIcon;
  logoSrc?: string;
  href?: string;
  external?: boolean;
  comingSoon?: boolean;
  accent: string;
};

export type PermissionPage = {
  app: "recycapp" | "mesoutils";
  key: string;
  label: string;
  description: string;
  actions: Action[];
};

export const ACTION_LABELS: Record<Action, string> = {
  read: "Lecture",
  create: "Creation",
  update: "Modification",
  delete: "Suppression",
  manage: "Gestion",
  reply: "Repondre",
  share: "Partager",
  checkout: "Encaisser",
  print: "Imprimer",
  analyze: "Analyse IA",
  start: "Demarrer",
};

export const RECYCAPP_PAGES: PermissionPage[] = [
  {
    app: "recycapp",
    key: "dashboard",
    label: "Tableau de bord",
    description: "Vue globale des demandes et indicateurs.",
    actions: ["read"],
  },
  {
    app: "recycapp",
    key: "notifications",
    label: "Notifications",
    description: "Alertes internes.",
    actions: ["read", "manage"],
  },
  {
    app: "recycapp",
    key: "messages",
    label: "Messages",
    description: "Conversations client.",
    actions: ["read", "reply"],
  },
  {
    app: "recycapp",
    key: "documents",
    label: "Documents",
    description: "Fichiers, devis et factures.",
    actions: ["read", "create", "update", "delete", "share"],
  },
  {
    app: "recycapp",
    key: "demandes",
    label: "Demandes",
    description: "Pipeline commercial.",
    actions: ["read", "create", "update", "delete"],
  },
  {
    app: "recycapp",
    key: "calendrier",
    label: "Calendrier",
    description: "Planning des interventions.",
    actions: ["read", "update"],
  },
  {
    app: "recycapp",
    key: "clients",
    label: "Clients",
    description: "Fiches clients.",
    actions: ["read", "create", "update", "delete"],
  },
  {
    app: "recycapp",
    key: "articles",
    label: "Articles",
    description: "Stock et etiquettes.",
    actions: ["read", "create", "update", "delete", "print", "analyze"],
  },
  {
    app: "recycapp",
    key: "caisse",
    label: "Caisse",
    description: "Encaissement magasin.",
    actions: ["read", "checkout", "delete"],
  },
  {
    app: "recycapp",
    key: "ateliers",
    label: "Ateliers",
    description: "Reparation et valorisation.",
    actions: ["read", "create", "update", "delete"],
  },
  {
    app: "recycapp",
    key: "arrivages",
    label: "Arrivages",
    description: "Objets entrants.",
    actions: ["read", "create", "update", "delete"],
  },
  {
    app: "recycapp",
    key: "sorties",
    label: "Sorties",
    description: "Sorties de stock.",
    actions: ["read", "create", "delete"],
  },
  {
    app: "recycapp",
    key: "tournees",
    label: "Tournees",
    description: "Tournees collecte.",
    actions: ["read", "create", "update", "delete", "start"],
  },
  {
    app: "recycapp",
    key: "flotte",
    label: "Flotte",
    description: "Vehicules et affectations.",
    actions: ["read", "create", "update", "delete"],
  },
  {
    app: "recycapp",
    key: "equipe",
    label: "Equipe",
    description: "Gestion des membres.",
    actions: ["read", "create", "update", "delete"],
  },
  {
    app: "recycapp",
    key: "admin",
    label: "Admin",
    description: "Configuration des permissions.",
    actions: ["read", "manage"],
  },
];

export const MESOUTILS_PAGES: PermissionPage[] = [
  {
    app: "mesoutils",
    key: "mesoutils:actualites",
    label: "Espace partage",
    description: "Posts internes, publications d'equipe, likes et commentaires.",
    actions: ["read", "create", "manage"],
  },
  {
    app: "mesoutils",
    key: "mesoutils:reservations",
    label: "Reservations",
    description: "Reservation de salles et demandes vehicules partagees.",
    actions: ["read", "create", "manage"],
  },
  {
    app: "mesoutils",
    key: "mesoutils:admin",
    label: "Admin Mes Outils",
    description: "Gestion transverse des droits Mes Outils et recyclerie.",
    actions: ["read", "manage"],
  },
];

export const ALL_PERMISSION_PAGES = [...RECYCAPP_PAGES, ...MESOUTILS_PAGES];
export const KNOWN_PAGE_KEYS = new Set(ALL_PERMISSION_PAGES.map((page) => page.key));

export const APPS: AppDefinition[] = [
  {
    key: "recycapp",
    label: "Recyclerie",
    description: "CRM operationnel: demandes, flotte, tournees, boutique, stock et clients.",
    icon: ShieldCheck,
    logoSrc: "/recyclerie-logo.png",
    href: import.meta.env.VITE_RECYCAPP_URL,
    external: true,
    accent: "from-brand-500 to-brand-600",
  },
];

export const PORTAL_NAV = [
  { to: "/", label: "Portail" },
  { to: "/actualites", label: "Espace partage", pageKey: "mesoutils:actualites" },
  { to: "/reservations", label: "Reservations", pageKey: "mesoutils:reservations" },
  { to: "/admin", label: "Admin", adminOnly: true, icon: ShieldCheck },
] as const;

export function canAccess(
  access: Access | undefined,
  pageKey: string,
  action: Action = "read",
) {
  if (!access) return false;
  if (access.isAdmin || access.bootstrapMode) return true;
  if (!access.isStaff) return false;
  return Boolean(
    access.grants.find((grant) => grant.pageKey === pageKey)?.actions.includes(action),
  );
}

export function appCanAccess(access: Access | undefined, appKey: AppDefinition["key"]) {
  if (!access) return false;
  if (appKey === "pointage" || appKey === "collecte") return access.isAdmin;
  if (access.isAdmin || access.bootstrapMode) return true;
  if (!access.isStaff) return false;
  if (appKey === "mesoutils") {
    return access.grants.some((grant) => grant.pageKey.startsWith("mesoutils:"));
  }
  return access.grants.some((grant) => !grant.pageKey.includes(":"));
}

export function groupPagesByApp() {
  return [
    { key: "mesoutils", label: "Mes Outils", pages: MESOUTILS_PAGES },
    { key: "recycapp", label: "Recyclerie", pages: RECYCAPP_PAGES },
  ] as const;
}
