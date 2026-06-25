import { Link, NavLink, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { SignedIn, SignedOut, SignIn, UserButton, useUser } from "@clerk/clerk-react";
import { useConvexAuth } from "convex/react";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { PORTAL_NAV, SECTION_SUBNAV, canAccess, sectionForPath } from "../lib/permissions";
import { cn } from "../lib/cn";
import { usePermissionsAccess } from "./RequirePermission";
import { FullSpinner } from "./ui/Spinner";
import { MessagerieSidebar } from "../pages/Messagerie";

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
              <SignIn routing="virtual" appearance={{ variables: { colorPrimary: "#47c667" } }} />
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
  const [searchParams] = useSearchParams();

  if (access === undefined) return <FullSpinner label="Chargement du portail..." />;

  const navItems = PORTAL_NAV.filter((item) => {
    if ("adminOnly" in item && item.adminOnly) return access.isAdmin;
    if ("pageKey" in item && item.pageKey) return canAccess(access, item.pageKey);
    return true;
  });

  const section = sectionForPath(location.pathname);
  const subnav = (section && SECTION_SUBNAV[section.to]) ?? [];
  const activeV = searchParams.get("v") ?? subnav[0]?.key ?? "";
  const isMessagerie = location.pathname.startsWith("/messagerie");
  const logoSrc = theme === "dark" ? "/mesoutils-dark.png" : "/mesoutils-light.png";

  return (
    <div className="min-h-screen">
      {/* Sidebar persistante (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-[var(--border)] bg-[var(--card)] lg:flex">
        <div className="flex h-20 items-center border-b border-[var(--border)] px-5">
          <Link to="/"><img src={logoSrc} alt="Mes Outils" className="h-12 w-auto" /></Link>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col p-3">
          {isMessagerie ? (
            <MessagerieSidebar />
          ) : (
          <div className="space-y-1 overflow-y-auto">
          {subnav.length > 0 ? (
            <>
              <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                {section?.label}
              </p>
              {subnav.map((item) => {
                const Icon = item.icon;
                const isActive = activeV === item.key;
                return (
                  <Link
                    key={item.key}
                    to={{ pathname: section!.to, search: `?v=${item.key}` }}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                      isActive ? "bg-brand-500 text-white" : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                    )}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </>
          ) : (
            navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                    isActive ? "bg-brand-500 text-white" : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))
          )}
          </div>
          )}
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
          <div className="flex items-center gap-3 rounded-xl bg-[var(--accent)] px-3 py-2">
            <UserButton afterSignOutUrl="/" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--foreground)]">{user?.fullName ?? user?.primaryEmailAddress?.emailAddress}</p>
              <p className="truncate text-xs text-[var(--muted-foreground)]">{user?.primaryEmailAddress?.emailAddress}</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        {/* Navbar : sections principales */}
        <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--nav-bg)]">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <Link to="/" className="lg:hidden"><img src={logoSrc} alt="Mes Outils" className="h-10 w-auto" /></Link>
            <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                      isActive ? "bg-brand-500 text-white" : "text-[var(--nav-muted)] hover:bg-brand-500/10 hover:text-brand-700",
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="lg:hidden">
              <UserButton afterSignOutUrl="/" />
            </div>
          </div>

          {/* Sous-navigation (mobile uniquement — la sidebar la porte en desktop) */}
          {subnav.length > 0 ? (
            <div className="flex gap-1 overflow-x-auto border-t border-[var(--border)] px-4 py-2 lg:hidden">
              {subnav.map((item) => {
                const isActive = activeV === item.key;
                return (
                  <Link
                    key={item.key}
                    to={{ pathname: section!.to, search: `?v=${item.key}` }}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold transition",
                      isActive ? "bg-brand-500 text-white" : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ) : null}
        </header>

        {isMessagerie ? (
          <main className="h-[calc(100vh-3.75rem)] overflow-hidden p-0 sm:p-3 lg:p-4">
            <Outlet />
          </main>
        ) : (
          <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        )}
      </div>
    </div>
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
