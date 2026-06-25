import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, CircleDashed, Mail, Save, Search, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select } from "../components/ui/Field";
import { FullSpinner } from "../components/ui/Spinner";
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
      role: user.role,
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
      role: existing?.role ?? "staff",
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
  const permissionsData = useQuery(api.permissions.listManaged);
  const listClerkUsers = useAction(api.permissions.listClerkUsers);
  const updateClerkRole = useAction(api.permissions.updateClerkRole);
  const upsert = useMutation(api.permissions.upsert);
  const remove = useMutation(api.permissions.remove);

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

  async function save() {
    const email = draftEmail.trim().toLowerCase();
    if (!email) return;
    setSaving(true);
    try {
      if (selectedPerson?.clerkId && selectedPerson.role !== draftRole) {
        const roleResult = await updateClerkRole({ clerkId: selectedPerson.clerkId, role: draftRole });
        if (!roleResult.ok) {
          throw new Error(
            roleResult.setupError === "missing_clerk_secret_key"
              ? "CLERK_SECRET_KEY est manquante cote Convex."
              : "Impossible de modifier le role Clerk.",
          );
        }
      }

      if (draftRole === "staff") {
        await upsert({
          email,
          name: draftName.trim() || undefined,
          active,
          grants: [
            ...grants
              .map((grant) => ({ pageKey: grant.pageKey, actions: grant.actions }))
              .filter((grant) => grant.actions.length > 0),
            ...unknownGrants,
          ],
        });
      } else if (selectedPerson?.grants.length) {
        await remove({ email });
      }
    } finally {
      setSaving(false);
    }
  }

  async function removeAccess() {
    if (!selectedPerson) return;
    setSaving(true);
    try {
      await remove({ email: selectedPerson.email });
    } finally {
      setSaving(false);
    }
  }

  if (permissionsData === undefined || clerkData === null) {
    return <FullSpinner label="Chargement des utilisateurs..." />;
  }

  return (
    <div className="space-y-6">
      <section className="border-b border-[var(--border)] pb-5">
        <p className="section-kicker">Administration</p>
        <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">Acces Mes Outils et recycapp</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {people.length} utilisateurs · {ALL_PERMISSION_PAGES.length} pages suivies
        </p>
      </section>

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
                  disabled={!selectedPerson?.clerkId}
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
                    ? "cursor-not-allowed border-[var(--border)] bg-zinc-100 text-zinc-500"
                    : active
                      ? "border-brand-200 bg-brand-50 text-brand-800"
                      : "border-red-200 bg-red-50 text-red-700",
                )}
              >
                {active ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
                {draftRole === "staff" ? (active ? "Acces actif" : "Acces coupe") : draftRole === "admin" ? "Acces total" : "Aucun acces"}
              </button>
            </div>
          </div>

          <div className={cn("space-y-6 p-5", draftRole !== "staff" && "opacity-50")}>
            {groupPagesByApp().map((group) => (
              <div key={group.key}>
                <div className="mb-3">
                  <h3 className="text-lg font-semibold text-[var(--foreground)]">{group.label}</h3>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Permissions fines par page et par action.
                  </p>
                </div>
                <div className="space-y-3">
                  {group.pages.map((page) => {
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
                            className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800"
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
                                    : "bg-brand-50 text-[var(--foreground)]",
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
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t border-[var(--border)] bg-[var(--accent)] p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-[var(--muted-foreground)]">
              Les grants inconnus sont preserves au moment de la sauvegarde pour ne rien ecraser.
            </p>
            <div className="flex gap-2">
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
