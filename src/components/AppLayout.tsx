import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { SignedIn, SignedOut, SignIn, UserButton, useClerk, useUser } from "@clerk/clerk-react";
import { useConvexAuth, useQuery } from "convex/react";
import { LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";

/** Style "bouton primaire" appliqué à l'élément de navigation actif. */
const NAV_ACTIVE = "bg-brand-500 text-white shadow-[0_8px_18px_rgba(71,198,103,0.25)]";
import { PORTAL_NAV, canAccess } from "../lib/permissions";
import { cn } from "../lib/cn";
import { usePermissionsAccess } from "./RequirePermission";
import { FullSpinner } from "./ui/Spinner";

export function AppLayout() {
  const [theme, setTheme] = useTheme();
  const logoSrc = theme === "dark" ? "/mesoutils-dark.png" : "/mesoutils-light.png";

  return (
    <>
      <SignedOut>
        <div className="flex min-h-screen items-center justify-center px-4 py-10">
          <div className="w-full max-w-md">
            <div className="mb-6 flex items-center justify-between">
              <img src={logoSrc} alt="Mes Outils" className="h-20 w-auto" />
              <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
            </div>
            <div className="glass-card rounded-xl border border-[var(--border)] p-4 sm:p-6">
              {/* Routing « hash » (et non « virtual ») : un formulaire monté en
                  pleine page doit gérer ses étapes (email → code/mot de passe →
                  2FA) via l'URL, sinon le bouton « Continuer » ne fait rien et
                  les clics répétés déclenchent un 429 « too many requests ».
                  Configuration identique à celle de recycapp (qui fonctionne)
                  avec la même clé Clerk. */}
              <SignIn routing="hash" appearance={{ variables: { colorPrimary: "#47c667" } }} />
            </div>
          </div>
        </div>
      </SignedOut>

      <SignedIn>
        <ConvexAuthenticatedShell theme={theme} setTheme={setTheme} />
      </SignedIn>
    </>
  );
}

function ConvexAuthenticatedShell({ theme, setTheme }: { theme: "light" | "dark"; setTheme: (t: "light" | "dark") => void }) {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) return <FullSpinner label="Synchronisation de la session..." />;

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="glass-card max-w-lg rounded-xl border border-[var(--border)] p-6 text-center">
          <img src={theme === "dark" ? "/mesoutils-dark.png" : "/mesoutils-light.png"} alt="Mes Outils" className="mx-auto h-14 w-auto" />
          <h1 className="mt-6 text-xl font-semibold text-[var(--foreground)]">Connexion Convex non active</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
            Votre session Clerk est ouverte mais Convex ne reçoit pas de jeton valide. Vérifiez le template JWT <code>convex</code> dans Clerk.
          </p>
          <div className="mt-6 flex justify-center"><UserButton afterSignOutUrl="/" /></div>
        </div>
      </div>
    );
  }

  return <AuthenticatedShell theme={theme} setTheme={setTheme} />;
}

function AuthenticatedShell({ theme, setTheme }: { theme: "light" | "dark"; setTheme: (t: "light" | "dark") => void }) {
  const access = usePermissionsAccess();
  const { user } = useUser();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Ferme le tiroir mobile à chaque changement de page.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  const hasMesoutilsAccess =
    access !== undefined &&
    (access.isAdmin || access.grants.some((grant) => grant.pageKey.startsWith("mesoutils:")));
  const unreadMessages = useQuery(api.community.unreadDirectCount, hasMesoutilsAccess ? {} : "skip") ?? 0;
  const pendingVehicleReservations = useQuery(api.reservations.pendingVehicleReservationsCount, access ? {} : "skip") ?? 0;
  const unreadNotifications = useQuery(api.mesoutilsNotifications.unreadCount, hasMesoutilsAccess ? {} : "skip") ?? 0;

  if (access === undefined) return <FullSpinner label="Chargement du portail..." />;

  const navItems = PORTAL_NAV.filter((item) => {
    if ("adminOnly" in item && item.adminOnly) return access.isAdmin;
    // La messagerie interne n'est visible que pour les utilisateurs ayant au
    // moins un droit « Mes Outils » (ou les admins).
    if (item.to === "/messagerie") return hasMesoutilsAccess;
    if ("pageKey" in item && item.pageKey) return canAccess(access, item.pageKey);
    if (item.to === "/notifications") return hasMesoutilsAccess;
    return true;
  }).map((item) => ({
    ...item,
    badge:
      item.to === "/messagerie"
        ? unreadMessages
        : item.to === "/gotravaux"
          ? pendingVehicleReservations
          : item.to === "/notifications"
            ? unreadNotifications
            : 0,
  }));

  const isMessagerie = location.pathname.startsWith("/messagerie");
  const logoSrc = theme === "dark" ? "/mesoutils-dark.png" : "/mesoutils-light.png";

  const sidebar = (
    <SidebarContent
      navItems={navItems}
      logoSrc={logoSrc}
      theme={theme}
      setTheme={setTheme}
      userName={user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Moi"}
      userEmail={user?.primaryEmailAddress?.emailAddress}
      userImage={user?.imageUrl}
      currentPath={location.pathname}
    />
  );

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Sidebar persistante (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-[var(--border)] bg-[var(--card)] lg:flex">
        {sidebar}
      </aside>

      {/* Barre supérieure minimale (mobile) : seulement le bouton menu. */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--nav-bg)] px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--foreground)] hover:bg-[var(--accent)]"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link to="/"><img src={logoSrc} alt="Mes Outils" className="h-8 w-auto" /></Link>
        <Link to="/compte" className="ml-auto">
          <UserAvatar name={user?.fullName ?? "Moi"} src={user?.imageUrl} />
        </Link>
      </header>

      {/* Tiroir mobile */}
      {mobileOpen ? (
        <div className="lg:hidden">
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-[var(--border)] bg-[var(--card)]">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
              aria-label="Fermer le menu"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      {isMessagerie ? (
        <main className="h-[calc(100dvh-3.5rem)] overflow-hidden p-0 sm:p-3 lg:h-screen lg:p-4">
          <Outlet />
        </main>
      ) : (
        <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      )}
    </div>
  );
}

function SidebarContent({
  navItems,
  logoSrc,
  theme,
  setTheme,
  userName,
  userEmail,
  userImage,
  currentPath,
}: {
  navItems: ReadonlyArray<{ to: string; label: string; badge?: number }>;
  logoSrc: string;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  userName: string;
  userEmail?: string;
  userImage?: string | null;
  currentPath: string;
}) {
  return (
    <>
      <div className="flex h-20 items-center overflow-hidden border-b border-[var(--border)] px-5">
        <Link to="/"><img src={logoSrc} alt="Mes Outils" className="h-16 w-auto" /></Link>
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                isActive ? NAV_ACTIVE : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
              )
            }
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.badge ? <NavBadge count={item.badge} active={currentPath === item.to || (item.to !== "/" && currentPath.startsWith(item.to))} /> : null}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-2 border-t border-[var(--border)] p-3">
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--muted-foreground)] transition hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Mode clair" : "Mode sombre"}
        </button>
        <div className="flex items-center gap-1.5">
          <Link
            to="/compte"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-[var(--accent)] px-3 py-2 transition hover:bg-[var(--selected)]"
          >
            <UserAvatar name={userName} src={userImage} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--foreground)]">{userName}</p>
              <p className="truncate text-xs text-[var(--muted-foreground)]">{userEmail}</p>
            </div>
          </Link>
          <SignOutButton />
        </div>
      </div>
    </>
  );
}

function NavBadge({ count, active }: { count: number; active: boolean }) {
  return (
    <span className={cn(
      "ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-black leading-none",
      active ? "bg-white text-brand-700" : "bg-brand-500 text-white",
    )}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function UserAvatar({ name, src }: { name: string; src?: string | null }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-600 text-xs font-semibold text-white">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function SignOutButton() {
  const { signOut } = useClerk();
  return (
    <button
      type="button"
      onClick={() => void signOut({ redirectUrl: "/" })}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--muted-foreground)] transition hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
      aria-label="Se déconnecter"
      title="Se déconnecter"
    >
      <LogOut className="h-4 w-4" />
    </button>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] transition hover:bg-[var(--accent)]"
      aria-label="Basculer le theme"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("mesoutils-theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
    window.localStorage.setItem("mesoutils-theme", theme);
  }, [theme]);

  return [theme, setTheme] as const;
}
