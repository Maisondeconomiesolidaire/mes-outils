import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Bike,
  CarFront,
  Bell,
  DoorOpen,
  Home,
  MessageCircle,
  Newspaper,
  PartyPopper,
  ShieldCheck,
  Shirt,
  Tag,
  Truck,
  Wrench,
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
  key: "recycapp" | "mesoutils" | "klyde" | "cycleenbray" | "bennespro" | "pointage" | "collecte";
  label: string;
  description: string;
  icon: LucideIcon;
  logoSrc?: string;
  href?: string;
  external?: boolean;
  comingSoon?: boolean;
  accent: string;
  cardBg?: string;
};

export type PermissionPage = {
  app: "recycapp" | "mesoutils" | "klyde" | "cycleenbray" | "bennespro";
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
    key: "mesoutils:gotravaux",
    label: "Gotravaux",
    description: "Gestion des vehicules, informations de flotte et maintenance.",
    actions: ["read", "create", "update"],
  },
  {
    app: "mesoutils",
    key: "mesoutils:salles",
    label: "Salles",
    description: "Gestion des salles, capacites, services et disponibilites.",
    actions: ["read", "create", "update"],
  },
  {
    app: "mesoutils",
    key: "mesoutils:admin",
    label: "Admin Mes Outils",
    description: "Gestion transverse des droits Mes Outils et recyclerie.",
    actions: ["read", "manage"],
  },
];

export const KLYDE_PAGES: PermissionPage[] = [
  {
    app: "klyde",
    key: "klyde:stock",
    label: "Stock & articles",
    description: "Saisie, detourage, analyse IA et gestion du stock textile.",
    actions: ["read", "create", "update", "delete", "analyze"],
  },
  {
    app: "klyde",
    key: "klyde:boutique",
    label: "Boutique en ligne",
    description: "Mise en ligne, retrait et vitrine publique des articles.",
    actions: ["read", "manage"],
  },
  {
    app: "klyde",
    key: "klyde:commandes",
    label: "Commandes",
    description: "Suivi des commandes boutique et expeditions.",
    actions: ["read", "manage"],
  },
  {
    app: "klyde",
    key: "klyde:admin",
    label: "Admin Klyde",
    description: "Configuration et droits de la boutique Klyde.",
    actions: ["read", "manage"],
  },
];

export const CYCLEENBRAY_PAGES: PermissionPage[] = [
  {
    app: "cycleenbray",
    key: "cycle:stock",
    label: "Stock velos",
    description: "Creation, publication et suivi des velos reconditionnes.",
    actions: ["read", "create", "update", "delete", "print"],
  },
  {
    app: "cycleenbray",
    key: "cycle:boutique",
    label: "Boutique Cycle en Bray",
    description: "Catalogue public, filtres, mise en avant et reservations.",
    actions: ["read", "manage"],
  },
  {
    app: "cycleenbray",
    key: "cycle:admin",
    label: "Admin Cycle en Bray",
    description: "Configuration et droits de l'application Cycle en Bray.",
    actions: ["read", "manage"],
  },
];

export const BENNESPRO_PAGES: PermissionPage[] = [
  {
    app: "bennespro",
    key: "bennespro:depots",
    label: "Dépôts",
    description: "Enregistrement des dépôts de déchets et bons de dépôt.",
    actions: ["read", "create"],
  },
  {
    app: "bennespro",
    key: "bennespro:entreprises",
    label: "Entreprises",
    description: "Entreprises déposantes et leurs véhicules.",
    actions: ["read", "create", "update", "delete"],
  },
  {
    app: "bennespro",
    key: "bennespro:admin",
    label: "Admin Bennes & Pro",
    description: "Configuration et droits de l'application Bennes & Pro.",
    actions: ["read", "manage"],
  },
];

export const ALL_PERMISSION_PAGES = [...RECYCAPP_PAGES, ...MESOUTILS_PAGES, ...KLYDE_PAGES, ...CYCLEENBRAY_PAGES, ...BENNESPRO_PAGES];
export const KNOWN_PAGE_KEYS = new Set(ALL_PERMISSION_PAGES.map((page) => page.key));

export const APPS: AppDefinition[] = [
  {
    key: "recycapp",
    label: "Recyclerie",
    description: "CRM de gestion pour les demandes, la boutique, le stock et les clients.",
    icon: ShieldCheck,
    logoSrc: "/recyclerie-logo.png",
    href: "https://mesrecycleries.vercel.app",
    external: true,
    accent: "from-brand-500 to-brand-600",
  },
  {
    key: "klyde",
    label: "Klyd",
    description: "Boutique textile : stock, mise en ligne et suivi des commandes.",
    icon: Shirt,
    logoSrc: "/klyd-logo.png",
    href: import.meta.env.VITE_KLYD_URL ?? "https://klyd.vercel.app",
    external: true,
    accent: "from-brand-500 to-brand-600",
    cardBg: "#f6eee5",
  },
  {
    key: "cycleenbray",
    label: "Cycle en Bray",
    description: "Boutique et CRM de gestion pour la Recyclerie 60 et 76.",
    icon: Bike,
    logoSrc: "/cycle-en-bray-logo.webp",
    href: import.meta.env.VITE_CYCLEENBRAY_URL ?? "https://cycleenbray.vercel.app",
    external: true,
    accent: "from-emerald-500 to-zinc-900",
    cardBg: "#eef7f1",
  },
  {
    key: "bennespro",
    label: "Bennes & Pro",
    description: "Dépôts de déchets par les entreprises : bennes, matériaux et bons de dépôt.",
    icon: Truck,
    href: import.meta.env.VITE_BENNESPRO_URL ?? "https://bennespro.vercel.app",
    external: true,
    accent: "from-amber-500 to-zinc-900",
    cardBg: "#fdf5e6",
  },
];

export const PORTAL_NAV = [
  { to: "/", label: "Portail", icon: Home },
  { to: "/actualites", label: "Espace partage", pageKey: "mesoutils:actualites", icon: Newspaper },
  { to: "/reservations", label: "Reservations", pageKey: "mesoutils:reservations", icon: CalendarCheck },
  { to: "/gotravaux", label: "Gotravaux", pageKey: "mesoutils:gotravaux", icon: Wrench },
  { to: "/salles", label: "Salles", pageKey: "mesoutils:salles", icon: DoorOpen },
  { to: "/messagerie", label: "Messagerie", icon: MessageCircle },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/admin", label: "Admin", adminOnly: true, icon: ShieldCheck },
] as const;

export type SubNavItem = { key: string; label: string; icon: LucideIcon };

/** Sous-pages affichées dans la sidebar pour chaque section principale. */
export const SECTION_SUBNAV: Record<string, SubNavItem[]> = {
  "/actualites": [
    { key: "publications", label: "Publications", icon: Newspaper },
    { key: "evenements", label: "Événements", icon: PartyPopper },
    { key: "bonsplans", label: "Bons plans", icon: Tag },
  ],
  "/reservations": [
    { key: "rooms", label: "Salles", icon: DoorOpen },
    { key: "vehicles", label: "Véhicules", icon: CarFront },
    { key: "mine", label: "Mes réservations", icon: CalendarCheck },
  ],
  "/gotravaux": [
    { key: "vehicles", label: "Véhicules", icon: CarFront },
    { key: "tasks", label: "Maintenance", icon: Wrench },
    { key: "reservations", label: "Réservations", icon: CalendarClock },
    { key: "calendar", label: "Calendrier", icon: CalendarDays },
  ],
  "/salles": [
    { key: "rooms", label: "Salles", icon: DoorOpen },
    { key: "reservations", label: "Réservations", icon: CalendarClock },
    { key: "calendar", label: "Calendrier", icon: CalendarDays },
  ],
};

/** Retrouve la section principale correspondant à un pathname. */
export function sectionForPath(pathname: string): (typeof PORTAL_NAV)[number] | undefined {
  return PORTAL_NAV.find((item) =>
    item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
}

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
  if (appKey === "klyde") {
    return access.grants.some((grant) => grant.pageKey.startsWith("klyde:"));
  }
  if (appKey === "cycleenbray") {
    return access.grants.some((grant) => grant.pageKey.startsWith("cycle:"));
  }
  if (appKey === "bennespro") {
    return access.grants.some((grant) => grant.pageKey.startsWith("bennespro:"));
  }
  return access.grants.some((grant) => !grant.pageKey.includes(":"));
}

export function groupPagesByApp() {
  return [
    { key: "mesoutils", label: "Mes Outils", pages: MESOUTILS_PAGES },
    { key: "recycapp", label: "Recyclerie", pages: RECYCAPP_PAGES },
    { key: "klyde", label: "Klyde", pages: KLYDE_PAGES },
    { key: "cycleenbray", label: "Cycle en Bray", pages: CYCLEENBRAY_PAGES },
    { key: "bennespro", label: "Bennes & Pro", pages: BENNESPRO_PAGES },
  ] as const;
}
