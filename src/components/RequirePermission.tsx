import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, LockKeyhole, Send, ShieldAlert, XCircle } from "lucide-react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ALL_PERMISSION_PAGES, canAccess } from "../lib/permissions";
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
        pageKey={pageKey}
        pageLabel={pageLabelFor(pageKey, "Portail CRM")}
        requestedAction={action}
      />
    );
  }

  if (adminOnly && !access.isAdmin) {
    return (
      <Denied
        title="Acces admin requis"
        description="Cette page est reservee aux administrateurs."
        pageKey={pageKey ?? "mesoutils:admin"}
        pageLabel={pageLabelFor(pageKey ?? "mesoutils:admin", "Administration Mes Outils")}
        requestedAction="manage"
      />
    );
  }

  if (pageKey && !canAccess(access, pageKey, action)) {
    return (
      <Denied
        title="Acces non autorise"
        description="Votre compte n'a pas les permissions necessaires pour cette section."
        pageKey={pageKey}
        pageLabel={pageLabelFor(pageKey, "Cette section")}
        requestedAction={action}
      />
    );
  }

  return <>{children}</>;
}

function pageLabelFor(pageKey: string | undefined, fallback: string) {
  return ALL_PERMISSION_PAGES.find((page) => page.key === pageKey)?.label ?? fallback;
}

function Denied({
  title,
  description,
  pageKey,
  pageLabel,
  requestedAction,
}: {
  title: string;
  description: string;
  pageKey?: string;
  pageLabel: string;
  requestedAction: "read" | "create" | "manage";
}) {
  const requestAccess = useAction(api.permissions.requestAccess);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const sendRequest = async () => {
    setStatus("sending");
    try {
      await requestAccess({ pageKey, pageLabel, requestedAction });
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className="glass-card max-w-md rounded-lg border border-[var(--border)] p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-red-50 text-red-500">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-[var(--foreground)]">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{description}</p>
        <button
          type="button"
          onClick={sendRequest}
          disabled={status === "sending" || status === "sent"}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : status === "sent" ? <CheckCircle2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          {status === "sending" ? "Envoi en cours..." : status === "sent" ? "Demande envoyee" : "Demander l'acces a Selim"}
        </button>
        <Link
          to="/portail"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-brand-50"
        >
          <LockKeyhole className="h-4 w-4" />
          Retour au portail
        </Link>
      </div>
      {status === "sent" && (
        <div role="status" className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm font-medium text-emerald-700 shadow-lg">
          <CheckCircle2 className="h-5 w-5" />
          Email envoye a Selim.
        </div>
      )}
      {status === "error" && (
        <div role="alert" className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-700 shadow-lg">
          <XCircle className="h-5 w-5" />
          L'email n'a pas pu etre envoye. Reessayez plus tard.
        </div>
      )}
    </div>
  );
}
