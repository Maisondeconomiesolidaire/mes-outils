import { useRef, useState } from "react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { Camera, Check, LogOut } from "lucide-react";
import { SectionHeader } from "../components/SectionHeader";
import { Button } from "../components/ui/Button";
import { Field, Input } from "../components/ui/Field";
import { FullSpinner } from "../components/ui/Spinner";
import { MyAppsGrid } from "../components/MyApps";
import { cn } from "../lib/cn";

export function Compte() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<"infos" | "apps">("infos");
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [savingInfo, setSavingInfo] = useState(false);
  const [savedInfo, setSavedInfo] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isLoaded) return <FullSpinner label="Chargement de votre compte..." />;
  if (!user) return <FullSpinner label="Chargement de votre compte..." />;

  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim() || email || "Moi";
  const dirty = firstName !== (user.firstName ?? "") || lastName !== (user.lastName ?? "");

  async function onPickPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user) return;
    setError(null);
    setUploadingPhoto(true);
    try {
      await user.setProfileImage({ file });
      await user.reload();
    } catch {
      setError("Impossible de mettre à jour la photo. Réessayez avec une image plus légère.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function removePhoto() {
    if (!user) return;
    setError(null);
    setUploadingPhoto(true);
    try {
      await user.setProfileImage({ file: null });
      await user.reload();
    } catch {
      setError("Impossible de retirer la photo.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function saveInfo() {
    if (!user || !dirty) return;
    setError(null);
    setSavingInfo(true);
    setSavedInfo(false);
    try {
      await user.update({ firstName: firstName.trim(), lastName: lastName.trim() });
      await user.reload();
      setSavedInfo(true);
      setTimeout(() => setSavedInfo(false), 2500);
    } catch {
      setError("Impossible d'enregistrer vos informations.");
    } finally {
      setSavingInfo(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <SectionHeader title="Mon compte" />

      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--border)]">
        {([{ key: "infos", label: "Informations" }, { key: "apps", label: "Mes applications" }] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold transition",
              tab === t.key
                ? "border-brand-500 text-brand-600"
                : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "apps" ? (
        <MyAppsGrid current="mesoutils" />
      ) : (
      <>
      <section className="premium-panel rounded-2xl p-5">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
          <span className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-600 text-2xl font-semibold text-white">
            {user.imageUrl ? (
              <img src={user.imageUrl} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              displayName.slice(0, 2).toUpperCase()
            )}
          </span>
          <div className="flex-1 text-center sm:text-left">
            <p className="text-lg font-bold text-[var(--foreground)]">{displayName}</p>
            <p className="text-sm text-[var(--muted-foreground)]">{email}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
              <Button variant="secondary" size="sm" disabled={uploadingPhoto} onClick={() => fileRef.current?.click()}>
                <Camera className="h-4 w-4" /> {uploadingPhoto ? "Envoi..." : "Changer la photo"}
              </Button>
              {user.hasImage ? (
                <Button variant="ghost" size="sm" disabled={uploadingPhoto} onClick={removePhoto}>
                  Retirer
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="premium-panel rounded-2xl p-5">
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prénom"><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
            <Field label="Nom"><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
          </div>
          <Field label="Adresse e-mail" hint="L'adresse e-mail est gérée par votre administrateur.">
            <Input value={email} disabled />
          </Field>
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
          <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] pt-4">
            {savedInfo ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600">
                <Check className="h-4 w-4" /> Enregistré
              </span>
            ) : null}
            <Button onClick={saveInfo} disabled={!dirty || savingInfo}>
              {savingInfo ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>
        </div>
      </section>

      <section className="premium-panel rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-[var(--foreground)]">Session</p>
            <p className="text-sm text-[var(--muted-foreground)]">Déconnectez-vous de cet appareil.</p>
          </div>
          <Button variant="outline" onClick={() => void signOut({ redirectUrl: "/" })}>
            <LogOut className="h-4 w-4" /> Se déconnecter
          </Button>
        </div>
      </section>
      </>
      )}
    </div>
  );
}
