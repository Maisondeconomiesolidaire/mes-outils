import { NavLink, Outlet } from "react-router-dom";
import { SignedIn, SignedOut, SignIn, UserButton } from "@clerk/clerk-react";
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
              <img src={logoSrc} alt="Mes Outils" className="h-16 w-auto" />
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
        <AuthenticatedShell theme={theme} setTheme={setTheme} />
      </SignedIn>
    </>
  );
}

function AuthenticatedShell({
  theme,
  setTheme,
}: {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
}) {
  const access = usePermissionsAccess();
  const logoSrc = theme === "dark" ? "/mesoutils-dark.png" : "/mesoutils-light.png";

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
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--background)]">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <img src={logoSrc} alt="Mes Outils" className="h-12 w-auto sm:h-14" />

          <nav className="ml-auto hidden items-center gap-2 md:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "rounded-full px-4 py-2 text-sm font-medium transition",
                    isActive
                      ? "bg-brand-500 text-white"
                      : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
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

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
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
                    : "bg-[var(--card)] text-[var(--muted-foreground)]",
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
