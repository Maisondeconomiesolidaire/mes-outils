import { ArrowUpRight, Lock } from "lucide-react";
import { EmptyState } from "../components/ui/EmptyState";
import { APPS, appCanAccess } from "../lib/permissions";
import { usePermissionsAccess } from "../components/RequirePermission";
import { cn } from "../lib/cn";

export function Portail() {
  const access = usePermissionsAccess();

  const visibleApps = APPS.filter((app) =>
    app.comingSoon ? access?.isAdmin : appCanAccess(access, app.key),
  );

  if (!access) return null;

  return (
    <div>
      {visibleApps.length === 0 ? (
        <EmptyState
          icon={<Lock className="h-8 w-8" />}
          title="Aucune application disponible"
          description="Ton compte est connecte, mais aucun espace ne lui est encore attribue."
        />
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleApps.map((app) => {
            const Icon = app.icon;
            const hasCustomBg = Boolean(app.cardBg);
            const content = (
              <div
                className={cn(
                  "h-full rounded-lg border border-[var(--border)] p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-strong)]",
                  !hasCustomBg && "glass-card",
                )}
                style={hasCustomBg ? { backgroundColor: app.cardBg, color: "#1f1b18" } : undefined}
              >
                <div className="flex items-start justify-between gap-4">
                  {app.logoSrc ? (
                    <img src={app.logoSrc} alt={app.label} className="h-14 w-auto object-contain" />
                  ) : (
                    <Icon className="h-8 w-8 text-[var(--foreground)]" />
                  )}
                  <ArrowUpRight className={cn("h-5 w-5", hasCustomBg ? "text-[#1f1b18]/55" : "text-[var(--muted-foreground)]")} />
                </div>
                <h3 className={cn("mt-5 text-lg font-semibold", !hasCustomBg && "text-[var(--foreground)]")}>{app.label}</h3>
                <p className={cn("mt-2 text-sm leading-6", hasCustomBg ? "text-[#1f1b18]/70" : "text-[var(--muted-foreground)]")}>
                  {app.description}
                </p>
                <div className={cn("mt-5 text-sm font-medium", hasCustomBg ? "text-[#8f4a43]" : "text-brand-600")}>
                  Ouvrir
                </div>
              </div>
            );

            if (app.comingSoon || !app.href) {
              return <div key={app.key}>{content}</div>;
            }

            return (
              <a
                key={app.key}
                href={app.href}
                target={app.external ? "_blank" : undefined}
                rel={app.external ? "noreferrer" : undefined}
              >
                {content}
              </a>
            );
          })}
        </section>
      )}
    </div>
  );
}
