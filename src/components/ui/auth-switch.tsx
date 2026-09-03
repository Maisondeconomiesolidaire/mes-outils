import { useEffect, useRef, useState, type FormEvent, type HTMLAttributes, type ReactNode } from "react";
import { useSignIn, useSignUp } from "@clerk/clerk-react";
import { KeyRound, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

type Mode = "signin" | "signup" | "code" | "reset-request" | "reset" | "mfa";

function message(error: unknown) {
  if (typeof error === "object" && error && "errors" in error) {
    const errors = (error as { errors?: Array<{ longMessage?: string; message?: string }> }).errors;
    return errors?.[0]?.longMessage ?? errors?.[0]?.message ?? "Une erreur est survenue.";
  }
  return error instanceof Error ? error.message : "Une erreur est survenue.";
}

/** Écran Clerk entièrement personnalisé : les mots de passe et sessions restent gérés par Clerk. */
export function AuthSwitch({ initialMode = "signin" }: { initialMode?: "signin" | "signup" }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { isLoaded: signInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [signUpSide, setSignUpSide] = useState(initialMode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [code, setCode] = useState("");
  const [mfaStrategy, setMfaStrategy] = useState<"email_code" | "phone_code" | "totp" | "backup_code">("totp");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const actionInProgress = useRef(false);
  const switchTimer = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const returnTo = params.get("redirect_url") || "/";

  useEffect(() => () => {
    if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
  }, []);

  const go = async (sessionId: string | null, setActive: (args: { session: string | null }) => Promise<void>) => {
    if (!sessionId) throw new Error("Session de connexion introuvable.");
    await setActive({ session: sessionId });
    navigate(returnTo, { replace: true });
  };
  const run = (action: () => Promise<void>) => async (event?: FormEvent) => {
    event?.preventDefault();
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setBusy(true); setError(null);
    try { await action(); } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
    actionInProgress.current = false;
  };
  const switchForm = (nextMode: "signin" | "signup") => {
    if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
    setSignUpSide(nextMode === "signup");
    setError(null);
    switchTimer.current = window.setTimeout(() => {
      setMode(nextMode);
      switchTimer.current = null;
    }, 600);
  };
  const sendLoginCode = async () => {
    if (!signInLoaded || !signIn) return;
    if (!email.trim()) throw new Error("Renseignez votre adresse email avant de demander un code de connexion.");
    const result = await signIn.create({ identifier: email.trim() });
    const factor = result.supportedFirstFactors?.find((item) => item.strategy === "email_code");
    if (!factor || factor.strategy !== "email_code") throw new Error("La connexion par code n'est pas disponible pour cette adresse.");
    await result.prepareFirstFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId });
    setMode("code");
  };
  const loginWithPassword = async () => {
    if (!signInLoaded || !signIn) return;
    const result = await signIn.create({ strategy: "password", identifier: email.trim(), password });
    if (result.status === "complete") return go(result.createdSessionId, setSignInActive);
    if (result.status === "needs_second_factor") return prepareMfa(result);
    throw new Error("Cette connexion nécessite une étape supplémentaire.");
  };
  const prepareMfa = async (result: NonNullable<typeof signIn>) => {
    const factor = result.supportedSecondFactors?.[0];
    if (!factor) throw new Error("Aucune méthode de vérification supplémentaire n'est disponible.");
    if (factor.strategy === "email_code" || factor.strategy === "phone_code") await result.prepareSecondFactor({ strategy: factor.strategy });
    if (!["email_code", "phone_code", "totp", "backup_code"].includes(factor.strategy)) throw new Error("Méthode de sécurité non prise en charge par cet écran.");
    setMfaStrategy(factor.strategy as typeof mfaStrategy); setMode("mfa");
  };
  const completeLoginCode = async () => {
    if (!signIn) return;
    const result = await signIn.attemptFirstFactor({ strategy: "email_code", code: code.replace(/\s/g, "") });
    if (result.status === "complete") return go(result.createdSessionId, setSignInActive);
    if (result.status === "needs_second_factor") return prepareMfa(result);
    throw new Error("Code incorrect ou expiré.");
  };
  const resetPassword = async () => {
    if (!signInLoaded || !signIn) return;
    if (!email.trim()) throw new Error("Renseignez votre adresse email avant de demander la réinitialisation.");
    await signIn.create({ strategy: "reset_password_email_code", identifier: email.trim() });
    setMode("reset");
  };
  const completeReset = async () => {
    if (!signIn) return;
    const result = await signIn.attemptFirstFactor({ strategy: "reset_password_email_code", code: code.replace(/\s/g, ""), password: newPassword });
    if (result.status === "complete") return go(result.createdSessionId, setSignInActive);
    throw new Error("Le code ou le nouveau mot de passe est invalide.");
  };
  const createAccount = async () => {
    if (!signUpLoaded || !signUp) return;
    if (!termsAccepted) throw new Error("Vous devez accepter les conditions d'utilisation pour créer un compte.");
    const result = await signUp.create({ emailAddress: email.trim(), password, firstName, lastName, legalAccepted: termsAccepted });
    if (result.status === "complete") return go(result.createdSessionId, setSignUpActive);
    throw new Error("L'inscription n'a pas pu être finalisée. Vérifiez les informations saisies.");
  };
  const completeMfa = async () => {
    if (!signIn) return;
    const result = await signIn.attemptSecondFactor({ strategy: mfaStrategy, code: code.replace(/\s/g, "") } as never);
    if (result.status === "complete") return go(result.createdSessionId, setSignInActive);
    throw new Error("Code incorrect ou expiré.");
  };
  const title = mode === "signup" ? "Créer votre compte" : mode === "reset" ? "Nouveau mot de passe" : mode === "reset-request" ? "Réinitialiser le mot de passe" : "Bienvenue sur Mes Outils";
  const subtitle = mode === "signup" ? "Créez votre espace en quelques instants." : mode === "reset" ? "Saisissez le code reçu et choisissez un nouveau mot de passe." : mode === "reset-request" ? "Nous vous enverrons un code de réinitialisation." : mode === "code" || mode === "mfa" ? "Saisissez le code de sécurité reçu par email." : "Connectez-vous pour accéder aux outils du groupe.";
  const needsCode = mode === "code" || mode === "mfa";
  return <main className="auth-switch-page"><section className={`auth-switch-container ${signUpSide ? "sign-up-mode" : ""}`}>
    <div className="auth-switch-form">
    <img src="/mesoutils-light.png" alt="Mes Outils" className="mb-6 h-16 w-auto object-contain" />
    <h1 className="text-3xl font-black tracking-tight text-zinc-950">{title}</h1><p className="mt-2 text-sm text-zinc-600">{subtitle}</p>
    <form className="mt-7 space-y-4" onSubmit={run(needsCode ? mode === "mfa" ? completeMfa : completeLoginCode : mode === "reset-request" ? resetPassword : mode === "reset" ? completeReset : mode === "signup" ? createAccount : loginWithPassword)}>
      {mode === "signup" ? <div className="grid gap-4 sm:grid-cols-2"><Field label="Prénom" value={firstName} onChange={setFirstName} /><Field label="Nom" value={lastName} onChange={setLastName} /></div> : null}
      {!needsCode && mode !== "reset" ? <Field label="Adresse email" value={email} onChange={setEmail} type="email" icon={<Mail className="h-4 w-4" />} /> : null}
      {(mode === "signin" || mode === "signup") ? <Field label="Mot de passe" value={password} onChange={setPassword} type="password" icon={<LockKeyhole className="h-4 w-4" />} /> : null}
      {mode === "signup" ? <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm leading-5 text-zinc-700"><input id="terms-acceptance" required checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" /><label htmlFor="terms-acceptance">J'accepte les conditions générales d'utilisation et la politique de confidentialité du groupe.</label></div> : null}
      {needsCode || mode === "reset" ? <Field label="Code de confirmation" value={code} onChange={setCode} inputMode="numeric" icon={<KeyRound className="h-4 w-4" />} /> : null}
      {mode === "reset" ? <Field label="Nouveau mot de passe" value={newPassword} onChange={setNewPassword} type="password" icon={<LockKeyhole className="h-4 w-4" />} /> : null}
      {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      <button disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}{needsCode || mode === "reset" ? "Confirmer" : mode === "reset-request" ? "Envoyer le code" : mode === "signup" ? "Créer mon compte" : "Se connecter"}</button>
    </form>
    {mode === "signin" ? <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-brand-700"><button type="button" onClick={() => void run(sendLoginCode)()} disabled={busy}>Recevoir un code de connexion</button><button type="button" onClick={() => { setMode("reset-request"); setError(null); }}>Mot de passe oublié ?</button></div> : null}
    </div>
    <div className="auth-switch-panels">
      <aside className="auth-switch-panel left-panel">
        <div className="auth-switch-panel-content">
          <h2>Nouveau ici ?</h2>
          <p>Créez votre espace pour accéder au portail et aux outils du groupe.</p>
          <button type="button" onClick={() => switchForm("signup")}>Créer un compte</button>
        </div>
      </aside>
      <aside className="auth-switch-panel right-panel">
        <div className="auth-switch-panel-content">
          <h2>Déjà membre ?</h2>
          <p>Retrouvez votre espace Mes Outils et vos démarches en cours.</p>
          <button type="button" onClick={() => switchForm("signin")}>Se connecter</button>
        </div>
      </aside>
    </div>
  </section></main>;
}

function Field({ label, value, onChange, type = "text", inputMode, icon }: { label: string; value: string; onChange: (value: string) => void; type?: string; inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"]; icon?: ReactNode }) {
  return <label className="block text-sm font-semibold text-zinc-800"><span>{label}</span><span className="relative mt-1.5 block">{icon ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-600">{icon}</span> : null}<input required value={value} type={type} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} className={`h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100 ${icon ? "pl-10" : ""}`} /></span></label>;
}

export default AuthSwitch;
