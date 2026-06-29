import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, CircleDashed, LayoutDashboard, Mail, Save, Search, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select } from "../components/ui/Field";
import { FullSpinner } from "../components/ui/Spinner";
import { UnderlineTabs } from "../components/ui/UnderlineTabs";
import { ACTION_LABELS, ALL_PERMISSION_PAGES, type Action, type Grant, KNOWN_PAGE_KEYS, groupPagesByApp } from "../lib/permissions";
import { cn } from "../lib/cn";

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
    });
  }

  return Array.from(people.values()).sort((a, b) =>
    (a.name ?? a.email).localeCompare(b.name ?? b.email, "fr"),
  );
}

export function Admin() {
  const [tab, setTab] = useState<"dashboard" | "access">("dashboard");
  return (
    <div className="space-y-6">
      <div>
        <p className="section-kicker">Administration</p>
        <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">Tableau de bord</h2>
      </div>
      <UnderlineTabs
        items={[
          { key: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
          { key: "access", label: "Accès", icon: ShieldCheck },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "dashboard" ? <GlobalDashboard /> : <AccessManager />}
    </div>
  );
}

function AccessManager() {
  const permissionsData = useQuery(api.permissions.listManaged);
  const listClerkUsers = useAction(api.permissions.listClerkUsers);
  const upsert = useMutation(api.permissions.upsert);
  const remove = useMutation(api.permissions.remove);

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
    if (!needle) return people;
    return people.filter((person) =>
      [person.name, person.email]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle)),
    );
  }, [people, search]);

  const selectedPerson = people.find((person) => person.email === selectedEmail) ?? null;

  useEffect(() => {
    if (!permissionsData || clerkData === null) return;
    if (selectedEmail && people.some((person) => person.email === selectedEmail)) return;
    setSelectedEmail(people[0]?.email ?? null);
  }, [permissionsData, clerkData, people, selectedEmail]);

  useEffect(() => {
    setSavedMessage(null);
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
        </section>
      </div>
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

function GlobalDashboard() {
  const stats = useQuery(api.dashboard.globalStats);
  if (stats === undefined) return <FullSpinner label="Chargement du tableau de bord..." />;

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
