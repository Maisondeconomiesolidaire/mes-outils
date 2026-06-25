import { NavLink, Outlet } from "react-router-dom";
import { SignedIn, SignedOut, SignIn, UserButton } from "@clerk/clerk-react";
import { useConvexAuth } from "convex/react";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
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
              <SignIn
                routing="virtual"
                appearance={{
                  variables: { colorPrimary: "#47c667" },
                }}
              />
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

function ConvexAuthenticatedShell({
  theme,
  setTheme,
}: {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
}) {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return <FullSpinner label="Synchronisation de la session..." />;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="glass-card max-w-lg rounded-xl border border-[var(--border)] p-6 text-center">
          <img
            src={theme === "dark" ? "/mesoutils-dark.png" : "/mesoutils-light.png"}
            alt="Mes Outils"
            className="mx-auto h-14 w-auto"
          />
          <h1 className="mt-6 text-xl font-semibold text-[var(--foreground)]">
            Connexion Convex non active
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
            Votre session Clerk est ouverte, mais Convex ne reçoit pas encore de
            jeton d'authentification valide. Vérifiez l'intégration Convex dans
            Clerk ou le template JWT <code>convex</code>, puis reconnectez-vous.
          </p>
          <div className="mt-6 flex justify-center">
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </div>
    );
  }

  return <AuthenticatedShell theme={theme} setTheme={setTheme} />;
}

function AuthenticatedShell({
  theme,
  setTheme,
}: {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
}) {
  const access = usePermissionsAccess();

  if (access === undefined) {
    return <FullSpinner label="Chargement du portail..." />;
  }

  const navItems = PORTAL_NAV.filter((item) => {
    if ("adminOnly" in item && item.adminOnly) return access.isAdmin;
    if ("pageKey" in item && item.pageKey) {
      return canAccess(access, item.pageKey);
    }
    return true;
  });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#111812]/95 shadow-[0_18px_40px_rgba(0,0,0,0.16)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <img src="/mesoutils-dark.png" alt="Mes Outils" className="h-16 w-auto sm:h-[4.5rem]" />

          <nav className="ml-auto hidden items-center gap-2 md:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "rounded-full px-4 py-2 text-sm font-semibold transition",
                    isActive
                      ? "bg-brand-500 text-white shadow-[0_10px_24px_rgba(71,198,103,0.26)]"
                      : "text-white/72 hover:bg-brand-500/18 hover:text-white",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <ThemeToggle
              theme={theme}
              onToggle={() => setTheme(theme === "dark" ? "light" : "dark")}
            />
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex gap-2 overflow-x-auto md:hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition",
                  isActive
                    ? "bg-brand-500 text-white"
                    : "bg-[var(--card)] text-[var(--foreground)]",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
        <Outlet />
      </main>
    </div>
  );
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: "light" | "dark";
  onToggle: () => void;
}) {
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
