import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { CalendarDays, Check, CircleDashed, CircleDollarSign, Clock, Info, Layers, LayoutDashboard, LogIn, Mail, MapPin, Save, Search, ShieldCheck, ShieldOff, Trash2, UserRound } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select } from "../components/ui/Field";
import { FullSpinner } from "../components/ui/Spinner";
import { Modal } from "../components/ui/Modal";
import { UnderlineTabs } from "../components/ui/UnderlineTabs";
import { ACTION_LABELS, ALL_PERMISSION_PAGES, type Action, type Grant, KNOWN_PAGE_KEYS, groupPagesByApp } from "../lib/permissions";
import { cn } from "../lib/cn";
import { confirmPermanentDelete } from "../lib/confirm";

type CrmRole = "client" | "staff" | "admin";

type ClerkUser = {
  clerkId: string;
  email: string;
  name: string;
  role: CrmRole;
  imageUrl: string | null;
  createdAt: number | null;
  lastSignInAt: number | null;
};

type PermissionPerson = {
  email: string;
  name?: string;
  role?: CrmRole;
  permissionActive?: boolean;
  grants: Grant[];
  updatedAt?: number;
};

type ManagedPerson = PermissionPerson & {
  clerkId?: string;
  imageUrl?: string | null;
  role: CrmRole;
  source: "clerk" | "manual";
  createdAt?: number | null;
  lastSignInAt?: number | null;
};

type ClerkUsersState = {
  users: ClerkUser[];
  totalCount: number;
  setupError: string | null;
};

function emptyGrants() {
  return ALL_PERMISSION_PAGES.map((page) => ({
    pageKey: page.key,
    actions: [] as string[],
  }));
}

function mergeGrants(grants: Grant[]) {
  const source = new Map(grants.map((grant) => [grant.pageKey, grant.actions]));
  return emptyGrants().map((grant) => ({
    ...grant,
    actions: source.get(grant.pageKey) ?? [],
  }));
}

function preservedUnknownGrants(grants: Grant[]) {
  return grants.filter((grant) => !KNOWN_PAGE_KEYS.has(grant.pageKey));
}

function hasAction(grants: Grant[], pageKey: string, action: Action) {
  return Boolean(grants.find((grant) => grant.pageKey === pageKey)?.actions.includes(action));
}

function toggleAction(grants: Grant[], pageKey: string, action: Action) {
  return grants.map((grant) =>
    grant.pageKey === pageKey
      ? {
          ...grant,
          actions: grant.actions.includes(action)
            ? grant.actions.filter((entry) => entry !== action)
            : [...grant.actions, action],
        }
      : grant,
  );
}

function setPageAll(grants: Grant[], pageKey: string, actions: Action[], checked: boolean) {
  return grants.map((grant) =>
    grant.pageKey === pageKey ? { ...grant, actions: checked ? [...actions] : [] } : grant,
  );
}

function mergeUsers(clerkUsers: ClerkUser[], permissionPeople: PermissionPerson[]) {
  const people = new Map<string, ManagedPerson>();

  for (const user of clerkUsers) {
    people.set(user.email, {
      email: user.email,
      name: user.name,
      clerkId: user.clerkId,
      imageUrl: user.imageUrl,
      // Le rôle fait foi côté Convex : tant qu'aucun droit n'est défini, l'utilisateur est client.
      role: "client",
      permissionActive: undefined,
      grants: [],
      source: "clerk",
      createdAt: user.createdAt,
      lastSignInAt: user.lastSignInAt,
    });
  }

  for (const permission of permissionPeople) {
    const existing = people.get(permission.email);
    people.set(permission.email, {
      ...existing,
      email: permission.email,
      name: existing?.name ?? permission.name,
      role: permission.role ?? "staff",
      permissionActive: permission.permissionActive,
      grants: permission.grants,
      updatedAt: permission.updatedAt,
      source: existing ? "clerk" : "manual",
      createdAt: existing?.createdAt,
      lastSignInAt: existing?.lastSignInAt,
    });
  }

  return Array.from(people.values()).sort((a, b) =>
    (a.name ?? a.email).localeCompare(b.name ?? b.email, "fr"),
  );
}

/** Un email @eco-solidaire.fr = membre interne (admin), sinon client. */
function isAdminEmail(email: string) {
  return email.trim().toLowerCase().endsWith("@eco-solidaire.fr");
}

const SIGNUP_APP_LABELS: Record<string, string> = {
  recycapp: "Recyclerie",
  mesoutils: "Mes Outils",
  klyde: "Klyd",
  cycleenbray: "Cycle en Bray",
  bennespro: "Bennes & Pro",
};

/** Libellé lisible de l'origine d'inscription (app · formulaire). */
function signupSourceLabel(source?: { app?: string; path?: string }): string | null {
  if (!source?.app) return null;
  const appLabel = SIGNUP_APP_LABELS[source.app] ?? source.app;
  const path = (source.path ?? "").split("?")[0];
  const form = path.startsWith("/collecte")
    ? "Formulaire collecte"
    : path.startsWith("/aerogommage")
      ? "Formulaire aérogommage"
      : path.startsWith("/velo")
        ? "Formulaire vélo"
        : path.startsWith("/livraison")
          ? "Formulaire livraison"
          : path.startsWith("/boutique/panier")
            ? "Panier boutique"
            : path.startsWith("/boutique")
              ? "Boutique"
              : path.startsWith("/reebike")
                ? "Reebike"
                : path.startsWith("/reparation")
                  ? "Réparation"
                  : path.startsWith("/compte")
                    ? "Espace compte"
                    : path === "/" || path === ""
                      ? "Accueil"
                      : path || "—";
  return `${appLabel} · ${form}`;
}

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Date absolue lisible ; `null` si l'horodatage est absent. */
function formatDate(ts?: number | null, withTime = false): string | null {
  if (!ts) return null;
  return (withTime ? dateTimeFmt : dateFmt).format(new Date(ts));
}

/** « il y a 3 jours », « aujourd'hui »… à partir d'un horodatage. */
function relativeTime(ts?: number | null): string | null {
  if (!ts) return null;
  const diff = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diff / day);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days} jours`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(days / 365);
  return `il y a ${years} an${years > 1 ? "s" : ""}`;
}

export function Admin() {
  const [tab, setTab] = useState<"dashboard" | "revenue" | "access">("dashboard");
  return (
    <div className="space-y-6">
      <div>
        <p className="section-kicker">Administration</p>
        <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">Tableau de bord</h2>
      </div>
      <UnderlineTabs
        items={[
          { key: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
          { key: "revenue", label: "Chiffre d'affaires", icon: CircleDollarSign },
          { key: "access", label: "Accès", icon: ShieldCheck },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "dashboard" ? (
        <GlobalDashboard />
      ) : tab === "revenue" ? (
        <RevenueDashboard />
      ) : (
        <AccessManager />
      )}
    </div>
  );
}

function AccessManager() {
  const permissionsData = useQuery(api.permissions.listManaged);
  const signupSources = useQuery(api.permissions.listSignupSources) ?? {};
  const listClerkUsers = useAction(api.permissions.listClerkUsers);
  const upsert = useMutation(api.permissions.upsert);
  const remove = useMutation(api.permissions.remove);
  const [kindFilter, setKindFilter] = useState<"all" | "admins" | "clients">("all");

  const groups = groupPagesByApp();
  const [selectedApp, setSelectedApp] = useState<string>(groups[0].key);
  const currentGroup = groups.find((group) => group.key === selectedApp) ?? groups[0];

  const [search, setSearch] = useState("");
  const [clerkData, setClerkData] = useState<ClerkUsersState | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftRole, setDraftRole] = useState<CrmRole>("client");
  const [active, setActive] = useState(true);
  const [grants, setGrants] = useState<Grant[]>(emptyGrants);
  const [unknownGrants, setUnknownGrants] = useState<Grant[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"access" | "info">("access");

  useEffect(() => {
    let cancelled = false;
    setClerkData(null);
    listClerkUsers({ limit: 300 })
      .then((result) => {
        if (!cancelled) setClerkData(result as ClerkUsersState);
      })
      .catch(() => {
        if (!cancelled) {
          setClerkData({ users: [], totalCount: 0, setupError: "clerk_api_error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [listClerkUsers]);

  const people = useMemo(
    () => mergeUsers(clerkData?.users ?? [], permissionsData?.people ?? []),
    [clerkData?.users, permissionsData?.people],
  );

  const filteredPeople = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return people.filter((person) => {
      if (kindFilter === "admins" && !isAdminEmail(person.email)) return false;
      if (kindFilter === "clients" && isAdminEmail(person.email)) return false;
      if (!needle) return true;
      return [person.name, person.email]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle));
    });
  }, [people, search, kindFilter]);

  const counts = useMemo(() => {
    let admins = 0;
    for (const person of people) if (isAdminEmail(person.email)) admins++;
    return { all: people.length, admins, clients: people.length - admins };
  }, [people]);

  const selectedPerson = people.find((person) => person.email === selectedEmail) ?? null;

  useEffect(() => {
    if (!permissionsData || clerkData === null) return;
    if (selectedEmail && people.some((person) => person.email === selectedEmail)) return;
    setSelectedEmail(people[0]?.email ?? null);
  }, [permissionsData, clerkData, people, selectedEmail]);

  useEffect(() => {
    setSavedMessage(null);
    setDetailTab("access");
    if (!selectedPerson) {
      setDraftName("");
      setDraftEmail("");
      setDraftRole("client");
      setActive(true);
      setGrants(emptyGrants());
      setUnknownGrants([]);
      return;
    }
    setDraftName(selectedPerson.name ?? "");
    setDraftEmail(selectedPerson.email);
    setDraftRole(selectedPerson.role);
    setActive(selectedPerson.role === "staff" ? selectedPerson.permissionActive ?? true : true);
    setGrants(mergeGrants(selectedPerson.grants));
    setUnknownGrants(preservedUnknownGrants(selectedPerson.grants));
  }, [selectedPerson]);

  useEffect(() => {
    if (!savedMessage) return;
    const timer = setTimeout(() => setSavedMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [savedMessage]);

  async function save() {
    const email = draftEmail.trim().toLowerCase();
    if (!email) return;
    setSaving(true);
    setSavedMessage(null);
    try {
      if (draftRole === "client") {
        // Aucun accès : on retire l'enregistrement Convex s'il existe.
        if (selectedPerson?.grants.length || selectedPerson?.role) {
          if (!(await confirmPermanentDelete("Êtes-vous sûr(e) de vouloir supprimer définitivement les droits de cet utilisateur ?"))) return;
          await remove({ email });
        }
        setSavedMessage("Droits modifiés avec succès");
        return;
      }

      await upsert({
        email,
        name: draftName.trim() || undefined,
        role: draftRole,
        // L'admin a un accès total (les grants sont ignorés côté serveur).
        active: draftRole === "admin" ? true : active,
        grants:
          draftRole === "admin"
            ? unknownGrants
            : [
                ...grants
                  .map((grant) => ({ pageKey: grant.pageKey, actions: grant.actions }))
                  .filter((grant) => grant.actions.length > 0),
                ...unknownGrants,
              ],
      });
      setSavedMessage("Droits modifiés avec succès");
    } finally {
      setSaving(false);
    }
  }

  async function removeAccess() {
    if (!selectedPerson) return;
    if (!(await confirmPermanentDelete("Êtes-vous sûr(e) de vouloir supprimer définitivement les droits de cet utilisateur ?"))) return;
    setSaving(true);
    setSavedMessage(null);
    try {
      await remove({ email: selectedPerson.email });
      setSavedMessage("Droits modifiés avec succès");
    } finally {
      setSaving(false);
    }
  }

  if (permissionsData === undefined || clerkData === null) {
    return <FullSpinner label="Chargement des utilisateurs..." />;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--muted-foreground)]">
        {people.length} utilisateurs · {ALL_PERMISSION_PAGES.length} pages suivies
      </p>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="glass-card overflow-hidden rounded-lg border border-[var(--border)]">
          <div className="border-b border-[var(--border)] p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher un utilisateur..."
                className="pl-9"
              />
            </div>
            <div className="mt-3 inline-flex w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
              {([
                { key: "all", label: `Tous (${counts.all})` },
                { key: "admins", label: `Admins (${counts.admins})` },
                { key: "clients", label: `Clients (${counts.clients})` },
              ] as const).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setKindFilter(option.key)}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition",
                    kindFilter === option.key
                      ? "bg-brand-500 text-white"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {clerkData.setupError ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {clerkData.setupError === "missing_clerk_secret_key"
                  ? "Ajoute CLERK_SECRET_KEY dans Convex pour lister tous les utilisateurs Clerk."
                  : "Le chargement Clerk a rencontre une erreur."}
              </p>
            ) : null}
          </div>
          <div className="max-h-[720px] overflow-y-auto p-2">
            {filteredPeople.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={<Mail className="h-8 w-8" />}
                  title="Aucun utilisateur"
                  description="Les utilisateurs Clerk et les entrees manuelles apparaissent ici."
                />
              </div>
            ) : (
              filteredPeople.map((person) => (
                <button
                  key={person.email}
                  type="button"
                  onClick={() => setSelectedEmail(person.email)}
                  className={cn(
                    "mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition",
                    selectedEmail === person.email
                      ? "bg-brand-500 text-white"
                      : "text-[var(--foreground)] hover:bg-[var(--accent)]",
                  )}
                >
                  <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-[var(--accent)] text-sm font-semibold text-[var(--foreground)]">
                    {person.imageUrl ? (
                      <img src={person.imageUrl} alt={person.name ?? person.email} className="h-full w-full object-cover" />
                    ) : (
                      (person.name ?? person.email).slice(0, 2).toUpperCase()
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {person.name || person.email}
                    </span>
                    <span className={cn("block truncate text-xs", selectedEmail === person.email ? "text-white/75" : "text-[var(--muted-foreground)]")}>
                      {person.email}
                    </span>
                    {signupSourceLabel(signupSources[person.email.toLowerCase()]) ? (
                      <span className={cn("mt-0.5 block truncate text-[11px]", selectedEmail === person.email ? "text-white/70" : "text-[var(--muted-foreground)]")}>
                        Inscrit via {signupSourceLabel(signupSources[person.email.toLowerCase()])}
                      </span>
                    ) : null}
                  </span>
                  {person.permissionActive === false ? (
                    <ShieldOff className="h-4 w-4" />
                  ) : person.grants.length > 0 ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <CircleDashed className="h-4 w-4" />
                  )}
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="glass-card overflow-hidden rounded-lg border border-[var(--border)]">
          <div className="border-b border-[var(--border)] p-5">
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_180px_auto] lg:items-end">
              <Field label="Nom affiché">
                <Input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
              </Field>
              <Field label="Email" required>
                <Input type="email" value={draftEmail} onChange={(event) => setDraftEmail(event.target.value)} />
              </Field>
              <Field label="Rôle">
                <Select
                  value={draftRole}
                  onChange={(event) => setDraftRole(event.target.value as CrmRole)}
                >
                  <option value="client">Client</option>
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </Select>
              </Field>
              <button
                type="button"
                onClick={() => setActive((current) => !current)}
                disabled={draftRole !== "staff"}
                className={cn(
                  "flex h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition",
                  draftRole !== "staff"
                    ? "cursor-not-allowed border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]"
                    : active
                      ? "border-brand-200 bg-[var(--selected)] text-[var(--selected-foreground)]"
                      : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300",
                )}
              >
                {active ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
                {draftRole === "staff" ? (active ? "Acces actif" : "Acces coupe") : draftRole === "admin" ? "Acces total" : "Aucun acces"}
              </button>
            </div>
          </div>

          <div className="border-b border-[var(--border)] px-5 pt-3">
            <UnderlineTabs
              items={[
                { key: "access", label: "Accès", icon: ShieldCheck },
                { key: "info", label: "Informations", icon: Info },
              ]}
              value={detailTab}
              onChange={setDetailTab}
            />
          </div>

          {detailTab === "info" ? (
            <PersonInfo person={selectedPerson} signupSource={signupSources[(selectedPerson?.email ?? "").toLowerCase()]} groups={groups} />
          ) : (
          <>
          {draftRole === "admin" ? (
            <div className="p-5">
              <div className="flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-brand-700" />
                <div>
                  <p className="font-semibold text-brand-900">Accès total</p>
                  <p className="text-sm text-brand-800/80">
                    Un administrateur a tous les droits sur Mes Outils, la Recyclerie et Klyde.
                    Les permissions fines ci-dessous ne sont pas nécessaires.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className={cn("space-y-5 p-5", draftRole !== "staff" && "opacity-50")}>
              <div className="grid gap-4 sm:grid-cols-[260px_minmax(0,1fr)] sm:items-end">
                <Field label="Application">
                  <Select
                    value={selectedApp}
                    onChange={(event) => setSelectedApp(event.target.value)}
                  >
                    {groups.map((group) => {
                      const count = group.pages.filter((page) =>
                        page.actions.some((action) => hasAction(grants, page.key, action)),
                      ).length;
                      return (
                        <option key={group.key} value={group.key}>
                          {group.label}
                          {count > 0 ? ` — ${count} page${count > 1 ? "s" : ""} activée${count > 1 ? "s" : ""}` : ""}
                        </option>
                      );
                    })}
                  </Select>
                </Field>
                <div className="flex flex-wrap gap-2">
                  {groups.map((group) => {
                    const count = group.pages.filter((page) =>
                      page.actions.some((action) => hasAction(grants, page.key, action)),
                    ).length;
                    return (
                      <button
                        key={group.key}
                        type="button"
                        onClick={() => setSelectedApp(group.key)}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                          selectedApp === group.key
                            ? "border-brand-500 bg-brand-500 text-white"
                            : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--accent)]",
                        )}
                      >
                        {group.label}
                        {count > 0 ? (
                          <span
                            className={cn(
                              "rounded-full px-1.5 text-[10px] font-semibold",
                              selectedApp === group.key ? "bg-white/25 text-white" : "bg-brand-50 text-brand-800",
                            )}
                          >
                            {count}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                {currentGroup.pages.map((page) => {
                  const enabledActions = page.actions.filter((action) => hasAction(grants, page.key, action));
                  const allChecked = enabledActions.length === page.actions.length;
                  return (
                    <div key={page.key} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--foreground)]">{page.label}</p>
                          <p className="text-sm text-[var(--muted-foreground)]">{page.description}</p>
                        </div>
                        <button
                          type="button"
                          disabled={draftRole !== "staff"}
                          onClick={() => setGrants((current) => setPageAll(current, page.key, page.actions, !allChecked))}
                          className="rounded-full bg-[var(--selected)] px-3 py-1 text-xs font-medium text-[var(--selected-foreground)] disabled:opacity-50"
                        >
                          {allChecked ? "Tout retire" : "Tout activer"}
                        </button>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {page.actions.map((action) => {
                          const checked = hasAction(grants, page.key, action);
                          return (
                            <button
                              key={action}
                              type="button"
                              disabled={draftRole !== "staff"}
                              onClick={() => setGrants((current) => toggleAction(current, page.key, action))}
                              className={cn(
                                "rounded-full px-3 py-2 text-sm font-medium transition",
                                checked
                                  ? "bg-brand-500 text-white"
                                  : "bg-[var(--selected)] text-[var(--selected-foreground)]",
                              )}
                            >
                              {ACTION_LABELS[action]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-[var(--border)] bg-[var(--accent)] p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-[var(--muted-foreground)]">
              Les grants inconnus sont preserves au moment de la sauvegarde pour ne rien ecraser.
            </p>
            <div className="flex items-center gap-3">
              {savedMessage ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1.5 text-sm font-medium text-green-800">
                  <Check className="h-4 w-4" />
                  {savedMessage}
                </span>
              ) : null}
              {selectedPerson?.grants.length ? (
                <Button variant="danger" onClick={removeAccess} disabled={saving}>
                  <Trash2 className="h-4 w-4" />
                  Reinitialiser
                </Button>
              ) : null}
              <Button onClick={save} disabled={saving || !draftEmail.trim()}>
                <Save className="h-4 w-4" />
                {saving ? "Enregistrement..." : "Enregistrer"}
              </Button>
            </div>
          </div>
          </>
          )}
        </section>
      </div>
    </div>
  );
}

/* ─── Onglet « Informations » d'un utilisateur ───────────────────────────── */

function InfoRow({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: string | null;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--muted-foreground)]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
        <p className="mt-0.5 break-words text-sm font-medium text-[var(--foreground)]">{value}</p>
        {hint ? <p className="text-xs text-[var(--muted-foreground)]">{hint}</p> : null}
      </div>
    </div>
  );
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="section-kicker">{title}</p>
      <div className="mt-1 divide-y divide-[var(--border)]">{children}</div>
    </div>
  );
}

function PersonInfo({
  person,
  signupSource,
  groups,
}: {
  person: ManagedPerson | null;
  signupSource?: { app?: string; path?: string; at?: number };
  groups: ReturnType<typeof groupPagesByApp>;
}) {
  if (!person) {
    return (
      <div className="p-5">
        <EmptyState
          icon={<UserRound className="h-8 w-8" />}
          title="Aucun utilisateur sélectionné"
          description="Sélectionnez un utilisateur pour consulter ses informations."
        />
      </div>
    );
  }

  const granted = new Set(
    person.grants.filter((grant) => grant.actions.length > 0).map((grant) => grant.pageKey),
  );
  const appsWithAccess = groups.filter((group) => group.pages.some((page) => granted.has(page.key)));
  const pageCount = groups.reduce(
    (total, group) => total + group.pages.filter((page) => granted.has(page.key)).length,
    0,
  );

  const roleLabel =
    person.role === "admin" ? "Administrateur" : person.role === "staff" ? "Staff" : "Client";
  const originLabel = signupSourceLabel(signupSource);
  const signupDate = formatDate(signupSource?.at);
  const createdDate = formatDate(person.createdAt);
  const lastSignIn = formatDate(person.lastSignInAt, true);

  const accessValue =
    person.role === "admin"
      ? "Accès total (toutes les applications)"
      : appsWithAccess.length === 0
        ? "Aucune application"
        : appsWithAccess.map((group) => group.label).join(", ");

  return (
    <div className="grid gap-8 p-5 lg:grid-cols-2">
      <InfoSection title="Provenance">
        <InfoRow
          icon={<MapPin className="h-4 w-4" />}
          label="Origine d'inscription"
          value={originLabel ?? "Origine inconnue"}
        />
        <InfoRow
          icon={<CalendarDays className="h-4 w-4" />}
          label="Première inscription"
          value={signupDate ?? "—"}
          hint={relativeTime(signupSource?.at)}
        />
        <InfoRow
          icon={<Mail className="h-4 w-4" />}
          label="Type de compte"
          value={person.source === "clerk" ? "Compte Clerk (connexion)" : "Entrée manuelle (droits)"}
        />
      </InfoSection>

      <InfoSection title="Activité">
        <InfoRow
          icon={<CalendarDays className="h-4 w-4" />}
          label="Compte créé"
          value={createdDate ?? "—"}
          hint={relativeTime(person.createdAt)}
        />
        <InfoRow
          icon={<LogIn className="h-4 w-4" />}
          label="Dernière connexion"
          value={lastSignIn ?? "Jamais connecté"}
          hint={relativeTime(person.lastSignInAt)}
        />
        <InfoRow
          icon={<Clock className="h-4 w-4" />}
          label="Dernière modification des droits"
          value={formatDate(person.updatedAt, true) ?? "—"}
          hint={relativeTime(person.updatedAt)}
        />
      </InfoSection>

      <InfoSection title="Accès">
        <InfoRow
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Rôle"
          value={roleLabel}
          hint={
            person.role === "staff"
              ? person.permissionActive === false
                ? "Accès coupé"
                : "Accès actif"
              : null
          }
        />
        <InfoRow
          icon={<Layers className="h-4 w-4" />}
          label="Applications accessibles"
          value={accessValue}
        />
        {person.role === "staff" ? (
          <InfoRow
            icon={<Check className="h-4 w-4" />}
            label="Pages activées"
            value={`${pageCount} page${pageCount > 1 ? "s" : ""}`}
          />
        ) : null}
      </InfoSection>

      <InfoSection title="Identité">
        <InfoRow icon={<UserRound className="h-4 w-4" />} label="Nom affiché" value={person.name || "—"} />
        <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={person.email} />
      </InfoSection>
    </div>
  );
}

/* ─── Tableau de bord global (maison mère) ───────────────────────────────── */

const eurFmt = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const numFmt = new Intl.NumberFormat("fr-FR");
const eur = (value: number) => eurFmt.format(value);
const num = (value: number) => numFmt.format(value);

type AppLine = { label: string; detail: string; value: string };

function AppBlock({
  logo,
  label,
  caption,
  revenue,
  lines,
}: {
  logo: string;
  label: string;
  caption: string;
  revenue: number;
  lines: AppLine[];
}) {
  return (
    <section className="py-6 first:pt-0 last:pb-0">
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-white">
            <img src={logo} alt={label} className="h-8 w-8 object-contain" />
          </span>
          <div>
            <h3 className="text-lg font-semibold leading-tight text-[var(--foreground)]">{label}</h3>
            <p className="text-xs text-[var(--muted-foreground)]">{caption}</p>
          </div>
        </div>
        <p className="text-2xl font-bold tracking-tight text-[var(--foreground)]">{eur(revenue)}</p>
      </div>
      <dl className="mt-4 divide-y divide-[var(--border)]">
        {lines.map((line) => (
          <div key={line.label} className="grid grid-cols-[1fr_auto] items-baseline gap-4 py-2.5 sm:grid-cols-[170px_1fr_auto]">
            <dt className="text-sm font-medium text-[var(--foreground)]">{line.label}</dt>
            <dd className="order-last col-span-2 text-xs text-[var(--muted-foreground)] sm:order-none sm:col-span-1 sm:text-sm">{line.detail}</dd>
            <dd className="text-right text-sm font-semibold tabular-nums text-[var(--foreground)]">{line.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Logo de chaque app (Mes Outils et Feedback n'ont pas d'entrée dans `APPS`). */
const APP_LOGOS: Record<string, string | undefined> = {
  mesoutils: "/mesoutils-light.png",
  recycapp: "/recyclerie-logo.png",
  klyde: "/klyd-logo.png",
  cycleenbray: "/cycle-en-bray-logo.webp",
  bennespro: "/bennespro-logo.png",
  pointeuse: "/logo-lsdb.png",
  feedback: undefined,
};

/** Page (droit) → application, pour rattacher un droit à son app. */
const APP_BY_PAGE_KEY = new Map(ALL_PERMISSION_PAGES.map((page) => [page.key, page.app]));

/** Grande valeur mise en avant en tête du tableau de bord. */
function KpiTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-[var(--foreground)]">{value}</p>
      {detail ? <p className="mt-1 text-xs text-[var(--muted-foreground)]">{detail}</p> : null}
    </div>
  );
}

type AudienceMember = { email: string; name?: string; detail?: string };

type AudienceGroup = {
  /** Libellé au singulier/pluriel déjà résolu, ex. « 4 admins ». */
  label: string;
  members: AudienceMember[];
};

type AppAudience = {
  key: string;
  label: string;
  clients: AudienceMember[];
  staff: AudienceMember[];
  admins: AudienceMember[];
  record: { label: string; count: number } | null;
};

/** Liste nominative derrière un compteur cliqué. */
function MembersModal({
  open,
  onClose,
  title,
  members,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  members: AudienceMember[];
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} className="sm:h-auto sm:max-h-[80vh] sm:w-[34rem] sm:max-w-[34rem]">
      {members.length === 0 ? (
        <EmptyState icon={<UserRound className="h-8 w-8" />} title="Personne pour l'instant" />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {members.map((member) => (
            <li key={member.email} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">
                  {member.name?.trim() || member.email}
                </p>
                {member.name?.trim() ? (
                  <p className="truncate text-xs text-[var(--muted-foreground)]">{member.email}</p>
                ) : null}
              </div>
              {member.detail ? (
                <p className="text-xs text-[var(--muted-foreground)]">{member.detail}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Carte « Recyclerie : X clients, X staff » ; chaque compteur ouvre sa liste. */
function AudienceCard({
  app,
  onOpenGroup,
}: {
  app: AppAudience;
  onOpenGroup: (group: AudienceGroup) => void;
}) {
  const logo = APP_LOGOS[app.key];
  const cells: Array<{ label: string; plural: string; members: AudienceMember[] }> = [
    { label: "Clients", plural: "clients", members: app.clients },
    { label: "Staff", plural: "staff", members: app.staff },
    { label: "Admins", plural: "admins", members: app.admins },
  ];

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-white">
          {logo ? (
            <img src={logo} alt="" className="h-7 w-7 object-contain" />
          ) : (
            <Layers className="h-5 w-5 text-[var(--muted-foreground)]" />
          )}
        </span>
        <h3 className="text-base font-semibold leading-tight text-[var(--foreground)]">{app.label}</h3>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {cells.map((cell) => (
          <button
            key={cell.label}
            type="button"
            disabled={cell.members.length === 0}
            onClick={() =>
              onOpenGroup({
                label: `${app.label} · ${cell.members.length} ${cell.plural}`,
                members: cell.members,
              })
            }
            className={cn(
              "rounded-xl bg-[var(--accent)] px-2 py-2.5 transition",
              cell.members.length > 0
                ? "hover:bg-[var(--border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
                : "cursor-default opacity-70",
            )}
          >
            <p className="text-xl font-bold tabular-nums text-[var(--foreground)]">{num(cell.members.length)}</p>
            <p className="text-[11px] font-medium text-[var(--muted-foreground)]">{cell.label}</p>
          </button>
        ))}
      </div>

      {app.record ? (
        <dl className="mt-3 flex items-baseline justify-between gap-3 text-xs">
          <dt className="text-[var(--muted-foreground)]">{app.record.label}</dt>
          <dd className="font-semibold tabular-nums text-[var(--foreground)]">{num(app.record.count)}</dd>
        </dl>
      ) : null}
    </div>
  );
}

function GlobalDashboard() {
  const audience = useQuery(api.dashboard.appAudience);
  const permissionsData = useQuery(api.permissions.listManaged);
  const [openGroup, setOpenGroup] = useState<AudienceGroup | null>(null);

  /**
   * Staff et admins par app, déduits des droits : une personne compte pour une
   * app dès qu'un de ses droits porte sur une page de cette app. Les admins ont
   * accès à tout, donc ils apparaissent dans chaque app.
   */
  const apps = useMemo<AppAudience[] | undefined>(() => {
    if (!audience || !permissionsData) return undefined;
    const active = permissionsData.people.filter((person) => person.permissionActive !== false);
    const admins: AudienceMember[] = active
      .filter((person) => person.role === "admin")
      .map((person) => ({ email: person.email, name: person.name, detail: "Accès à toutes les applications" }));
    const records = audience.records as Record<string, { label: string; count: number }>;
    const clientsByApp = audience.clientsByApp as Record<
      string,
      Array<{ email: string; name: string; createdAt: number }>
    >;

    return groupPagesByApp().map((group) => {
      const staff: AudienceMember[] = [];
      for (const person of active) {
        if (person.role === "admin") continue;
        const granted = person.grants.filter(
          (grant) => grant.actions.length > 0 && APP_BY_PAGE_KEY.get(grant.pageKey) === group.key,
        );
        if (granted.length > 0) {
          staff.push({
            email: person.email,
            name: person.name,
            detail: `${granted.length} page${granted.length > 1 ? "s" : ""}`,
          });
        }
      }

      return {
        key: group.key,
        label: group.label,
        clients: (clientsByApp[group.key] ?? []).map((client) => ({
          email: client.email,
          name: client.name,
          detail: formatDate(client.createdAt) ?? undefined,
        })),
        staff,
        admins,
        record: records[group.key] ?? null,
      };
    });
  }, [audience, permissionsData]);

  if (audience === undefined || apps === undefined) {
    return <FullSpinner label="Chargement du tableau de bord..." />;
  }

  return (
    <div className="space-y-9">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile
          label="Comptes clients"
          value={num(audience.accounts.clients)}
          detail={`${num(audience.accounts.newClientsLast30Days)} inscrits sur 30 jours`}
        />
        <KpiTile
          label="Comptes internes"
          value={num(audience.accounts.internal)}
          detail="Adresses @eco-solidaire.fr"
        />
        <KpiTile
          label="Origine inconnue"
          value={num(audience.accounts.unknownOrigin)}
          detail="Comptes clients rattachés à aucune app"
        />
      </div>

      <div>
        <h3 className="text-lg font-semibold text-[var(--foreground)]">Clients et équipe par application</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {apps.map((app) => (
            <AudienceCard key={app.key} app={app} onOpenGroup={setOpenGroup} />
          ))}
        </div>
      </div>

      <MembersModal
        open={openGroup !== null}
        onClose={() => setOpenGroup(null)}
        title={openGroup?.label ?? ""}
        members={openGroup?.members ?? []}
      />
    </div>
  );
}

function RevenueDashboard() {
  const stats = useQuery(api.dashboard.globalStats);
  if (stats === undefined) return <FullSpinner label="Chargement du chiffre d'affaires..." />;

  const shares = [
    { key: "recyclerie", label: "Recyclerie", revenue: stats.recyclerie.revenue, tint: "bg-brand-500" },
    { key: "klyde", label: "Klyde", revenue: stats.klyde.revenue, tint: "bg-indigo-500" },
    { key: "cycle", label: "Cycle en Bray", revenue: stats.cycle.revenue, tint: "bg-emerald-500" },
  ];
  const denom = stats.totalRevenue || 1;

  return (
    <div className="space-y-9">
      {/* Chiffre d'affaires total + répartition par application. */}
      <div>
        <p className="text-sm font-medium text-[var(--muted-foreground)]">Chiffre d'affaires total · toutes applications</p>
        <p className="mt-1 text-5xl font-bold tracking-tight text-[var(--foreground)]">{eur(stats.totalRevenue)}</p>
        <div className="mt-6 flex h-2.5 overflow-hidden rounded-full bg-[var(--accent)]">
          {shares.map((share) =>
            share.revenue > 0 ? (
              <div
                key={share.key}
                className={cn("h-full", share.tint)}
                style={{ width: `${(share.revenue / denom) * 100}%` }}
              />
            ) : null,
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {shares.map((share) => (
            <div key={share.key} className="flex items-center gap-2 text-sm">
              <span className={cn("h-2.5 w-2.5 rounded-full", share.tint)} />
              <span className="font-medium text-[var(--foreground)]">{share.label}</span>
              <span className="text-[var(--muted-foreground)]">{eur(share.revenue)}</span>
              <span className="text-xs text-[var(--muted-foreground)]">· {Math.round((share.revenue / denom) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Détail par application. */}
      <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
        <AppBlock
          logo="/recyclerie-logo.png"
          label="Recyclerie"
          caption={`${num(stats.recyclerie.requests)} demandes · ${num(stats.recyclerie.open)} ouvertes`}
          revenue={stats.recyclerie.revenue}
          lines={[
            { label: "Collecte", detail: `${num(stats.recyclerie.collecte.requests)} demandes · ${num(stats.recyclerie.collecte.won)} gagnées`, value: eur(stats.recyclerie.collecte.revenue) },
            { label: "Aérogommage", detail: `${num(stats.recyclerie.aerogommage.requests)} demandes · ${num(stats.recyclerie.aerogommage.won)} gagnées`, value: eur(stats.recyclerie.aerogommage.revenue) },
            { label: "Boutique", detail: `${num(stats.recyclerie.boutique.sales)} ventes en caisse`, value: eur(stats.recyclerie.boutique.revenue) },
          ]}
        />
        <AppBlock
          logo="/klyd-logo.png"
          label="Klyde"
          caption={`${num(stats.klyde.orders)} commandes · ${num(stats.klyde.items)} articles`}
          revenue={stats.klyde.revenue}
          lines={[
            { label: "Commandes payées", detail: `${num(stats.klyde.pendingOrders)} en attente de paiement`, value: num(stats.klyde.paidOrders) },
            { label: "Catalogue", detail: "articles en ligne", value: num(stats.klyde.items) },
          ]}
        />
        <AppBlock
          logo="/cycle-en-bray-logo.webp"
          label="Cycle en Bray"
          caption={`${num(stats.cycle.bikes)} vélos au catalogue`}
          revenue={stats.cycle.revenue}
          lines={[
            { label: "Vélos vendus", detail: `${num(stats.cycle.bikesAvailable)} disponibles`, value: num(stats.cycle.bikesSold) },
            { label: "Demandes", detail: `${num(stats.cycle.open)} en cours · ${num(stats.cycle.won)} gagnées`, value: num(stats.cycle.requests) },
          ]}
        />
      </div>
    </div>
  );
}
