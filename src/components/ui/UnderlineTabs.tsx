import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

export type UnderlineTabItem<T extends string> = {
  key: T;
  label: string;
  icon?: LucideIcon;
};

/**
 * Onglets soulignés (même style que les sous-pages de recycapp) : barre
 * inférieure fine, onglet actif souligné en vert de marque.
 *
 * À l'ouverture de la page, les onglets glissent depuis la gauche en cascade.
 * Ce n'est pas décoratif : sans mouvement, une rangée d'onglets discrets passe
 * inaperçue et l'utilisateur ne devine pas qu'il existe d'autres vues. Le
 * soulignement de l'onglet actif s'étire une fois la cascade passée.
 * L'animation se coupe si le système demande moins de mouvement
 * (`prefers-reduced-motion`).
 */
export function UnderlineTabs<T extends string>({
  items,
  value,
  onChange,
  counts,
  badges,
  className,
  size = "md",
}: {
  items: UnderlineTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  counts?: Partial<Record<T, number>>;
  /**
   * Pastille colorée signalant qu'il y a quelque chose à voir sur cet onglet
   * (notifications non lues). Distincte de `counts`, qui affiche un simple
   * volume en gris : ici on demande l'attention.
   */
  badges?: Partial<Record<T, number>>;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("border-b border-[var(--border)]", className)}>
      <div className="flex flex-nowrap items-end gap-6 overflow-x-auto overflow-y-hidden">
        {items.map((item, index) => {
          const active = item.key === value;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              style={{ animationDelay: `${index * 95}ms` }}
              className={cn(
                "animate-tab-slide-in relative flex items-center gap-2 whitespace-nowrap pb-3 font-semibold transition-colors",
                size === "sm" ? "text-sm" : "text-[15px]",
                active
                  ? "text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {Icon ? <Icon className="h-[18px] w-[18px]" /> : null}
              <span>{item.label}</span>
              {counts?.[item.key] !== undefined && (
                <span className="text-xs text-[var(--muted-foreground)]">{counts[item.key]}</span>
              )}
              {(badges?.[item.key] ?? 0) > 0 ? (
                <span
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-bold text-white"
                  title="Notifications non lues sur cet onglet"
                >
                  {badges?.[item.key]}
                </span>
              ) : null}
              {/* Soulignement porté par un élément dédié : il peut s'étirer sans
                  décaler le texte, contrairement à une bordure. */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-0 -bottom-px h-0.5 rounded-full",
                  active ? "animate-tab-underline bg-brand-500" : "bg-transparent",
                )}
                style={active ? { animationDelay: `${items.length * 95}ms` } : undefined}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
