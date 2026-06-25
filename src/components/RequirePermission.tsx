import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { canAccess } from "../lib/permissions";
import { FullSpinner } from "./ui/Spinner";

export function usePermissionsAccess() {
  return useQuery(api.permissions.myAccess);
}

export function RequirePermission({
  pageKey,
  action = "read",
  adminOnly = false,
  children,
}: {
  pageKey?: string;
  action?: "read" | "create" | "manage";
  adminOnly?: boolean;
  children: ReactNode;
}) {
  const access = usePermissionsAccess();

  if (access === undefined) {
    return <FullSpinner label="Verification des acces..." />;
  }

  if (!access.isStaff && !access.isAdmin) {
    return (
      <Denied
        title="Acces staff requis"
        description="Ce compte n'a pas encore de droits staff ou admin dans le portail."
      />
    );
  }

  if (adminOnly && !access.isAdmin) {
    return (
      <Denied
        title="Acces admin requis"
        description="Cette page est reservee aux administrateurs."
      />
    );
  }

  if (pageKey && !canAccess(access, pageKey, action)) {
    return (
      <Denied
        title="Acces non autorise"
        description="Votre compte n'a pas les permissions necessaires pour cette section."
      />
    );
  }

  return <>{children}</>;
}

function Denied({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className="glass-card max-w-md rounded-lg border border-[var(--border)] p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-red-50 text-red-500">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-[var(--foreground)]">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{description}</p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-brand-50"
        >
          <LockKeyhole className="h-4 w-4" />
          Retour au portail
        </Link>
      </div>
    </div>
  );
}
