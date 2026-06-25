import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="glass-card rounded-lg border border-[var(--border)] px-6 py-12 text-center">
      {icon ? <div className="mx-auto mb-3 flex justify-center text-brand-500">{icon}</div> : null}
      <h3 className="text-lg font-semibold text-[var(--foreground)]">{title}</h3>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted-foreground)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
