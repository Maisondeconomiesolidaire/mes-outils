import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignIn, SignUp, useAuth } from "@clerk/clerk-react";
import { ArrowLeft, Loader2 } from "lucide-react";

type Mode = "signin" | "signup";
type AuthSwitchProps = {
  initialMode?: Mode;
  appName?: string;
  welcomeTitle?: string;
  signinSubtitle?: string;
  memberPanelDescription?: string;
  logoSrc?: string;
  redirectUrl?: string;
  homeHref?: string;
  homeLabel?: string;
  termsHref?: string;
  privacyHref?: string;
};

/** Only return to a page in this app; never redirect to a URL supplied by another site. */
export function authReturnUrl(value: string | null | undefined, origin: string) {
  if (!value) return "/";
  try {
    const target = new URL(value, origin);
    if (target.origin !== origin || target.username || target.password || target.pathname.startsWith("//")) return "/";
    if (/^\/(connexion|inscription|sign-in|sign-up)(\/|$)/i.test(decodeURIComponent(target.pathname))) return "/";
    target.searchParams.delete("auth");
    target.searchParams.delete("redirect_url");
    return target.pathname + target.search + target.hash;
  } catch {
    return "/";
  }
}

/** Canonical shared portal. Clerk owns verification, captcha, recovery and session tasks.
 * Keep ONE mounted auth component and hash routing: step changes must not remount it.
 * No app router dependency: Klyde also uses this component without react-router.
 */
export function AuthSwitch({
  initialMode = "signin", appName = "Votre espace", welcomeTitle, signinSubtitle,
  memberPanelDescription, logoSrc = "/logo-lsdb.png", redirectUrl,
  homeHref, homeLabel = "Retour à l'accueil", termsHref, privacyHref,
}: AuthSwitchProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const readMode = (): Mode => {
    const requested = new URLSearchParams(window.location.search).get("auth");
    return requested === "signin" || requested === "signup" ? requested : initialMode;
  };
  const [mode, setMode] = useState<Mode>(readMode);
  const [hash, setHash] = useState(window.location.hash);
  const container = useRef<HTMLElement>(null);
  const form = useRef<HTMLDivElement>(null);
  const entry = !hash || hash === "#/" || hash === "#";
  const returnTo = authReturnUrl(redirectUrl ?? new URLSearchParams(window.location.search).get("redirect_url") ?? window.location.pathname + window.location.search, window.location.origin);

  // Both links point to a real local portal even in apps without dedicated auth routes.
  const modeUrl = (next: Mode) => {
    const target = new URL(window.location.href);
    target.hash = "";
    target.searchParams.set("auth", next);
    target.searchParams.set("redirect_url", returnTo);
    return target.pathname + target.search;
  };
  const switchMode = (next: Mode) => {
    window.history.replaceState(window.history.state, "", modeUrl(next));
    setHash("");
    setMode(next);
  };

  useEffect(() => {
    if (isLoaded && isSignedIn) window.location.replace(returnTo);
  }, [isLoaded, isSignedIn, returnTo]);

  useEffect(() => {
    const update = () => { setHash(window.location.hash); setMode(readMode()); };
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, [initialMode]);

  useEffect(() => {
    if (!form.current || !container.current) return;
    const resize = new ResizeObserver(([entry]) => {
      // offsetHeight includes padding, unlike contentRect. Long verification/error
      // screens must expand the desktop card instead of being clipped at 700px.
      if (entry && form.current) container.current?.style.setProperty("--auth-content-height", `${form.current.offsetHeight + 32}px`);
    });
    resize.observe(form.current);
    return () => resize.disconnect();
  }, []);

  const appearance: ComponentProps<typeof SignIn>["appearance"] = {
    layout: { termsPageUrl: termsHref, privacyPageUrl: privacyHref },
    variables: { fontFamily: "inherit", borderRadius: "0.75rem", colorText: "#18181b", colorBackground: "#ffffff" },
    elements: {
      rootBox: { width: "100%" },
      cardBox: { width: "100%", boxShadow: "none", border: "none", borderRadius: "0", overflow: "visible" },
      card: { padding: "0", boxShadow: "none", border: "none", background: "transparent", borderRadius: "0", overflow: "visible" },
      header: entry ? { display: "none" } : {},
      logoBox: { display: "none" },
      // Keep footerAction visible: Clerk also uses it for MFA recovery links.
      footer: { background: "transparent", padding: "1rem 0 0" },
      formButtonPrimary: { background: "var(--auth-accent, var(--color-brand-600))", minHeight: "2.75rem" },
      formFieldInput: { minHeight: "2.75rem" },
    },
  };
  const backLink = homeHref ? <a href={homeHref} className="auth-switch-back-link"><ArrowLeft className="h-4 w-4" />{homeLabel}</a> : null;

  return <main className="auth-switch-page">
    <section ref={container} className={`auth-switch-container ${mode === "signup" ? "sign-up-mode" : ""}`}>
      <div ref={form} className="auth-switch-form">
        <div className="auth-switch-compact">
          {backLink}
          <p>{mode === "signup" ? "Déjà un compte ?" : "Pas de compte ?"}{" "}
            <button type="button" onClick={() => switchMode(mode === "signup" ? "signin" : "signup")}>{mode === "signup" ? "Se connecter" : "Je m'inscris"}</button>
          </p>
        </div>
        <img src={logoSrc} alt={appName} className="mb-6 h-16 w-auto object-contain" />
        {entry ? <div className="mb-6">
          <h1 className="text-3xl font-black tracking-tight text-zinc-950">{mode === "signup" ? "Créer votre compte" : welcomeTitle ?? `Bienvenue sur ${appName}`}</h1>
          <p className="mt-2 text-sm text-zinc-600">{mode === "signup" ? "Créez votre espace en quelques instants." : signinSubtitle ?? `Connectez-vous pour retrouver votre espace ${appName}.`}</p>
        </div> : null}
        <ClerkLoading><AuthLoading /></ClerkLoading>
        <ClerkFailed><AuthUnavailable /></ClerkFailed>
        <ClerkLoaded>
          {isSignedIn ? <AuthLoading /> : mode === "signup" ? <SignUp
            routing="hash" signInUrl={modeUrl("signin")}
            forceRedirectUrl={returnTo} signInForceRedirectUrl={returnTo}
            appearance={appearance} fallback={<AuthLoading />}
          /> : <SignIn
            routing="hash" withSignUp={false} signUpUrl={modeUrl("signup")}
            forceRedirectUrl={returnTo} signUpForceRedirectUrl={returnTo}
            appearance={appearance} fallback={<AuthLoading />}
          />}
        </ClerkLoaded>
      </div>
      <div className="auth-switch-panels">
        <aside className="auth-switch-panel left-panel" aria-hidden={mode === "signup"} inert={mode === "signup"}>
          <div className="auth-switch-panel-content">
            <h2>Nouveau ici ?</h2><p>Créez votre espace en quelques instants pour suivre vos démarches.</p>
            <button type="button" onClick={() => switchMode("signup")}>Créer un compte</button>{backLink}
          </div>
        </aside>
        <aside className="auth-switch-panel right-panel" aria-hidden={mode !== "signup"} inert={mode !== "signup"}>
          <div className="auth-switch-panel-content">
            <h2>Déjà membre ?</h2><p>{memberPanelDescription ?? `Retrouvez votre espace ${appName} et vos démarches en cours.`}</p>
            <button type="button" onClick={() => switchMode("signin")}>Se connecter</button>{backLink}
          </div>
        </aside>
      </div>
    </section>
  </main>;
}

/** Render outside SignedOut: otherwise Clerk failures leave an empty page. */
export function AuthServiceFallback() {
  const frame = (failed: boolean) => <main className="auth-switch-page">
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
      {failed ? <AuthUnavailable /> : <AuthLoading />}
    </div>
  </main>;
  return <><ClerkLoading>{frame(false)}</ClerkLoading><ClerkFailed>{frame(true)}</ClerkFailed></>;
}

function AuthUnavailable() {
  return <div role="alert" className="space-y-3 rounded-xl bg-red-50 p-4 text-sm text-red-800">
    <p>Le service de connexion ne répond pas. Vérifiez votre connexion internet puis réessayez.</p>
    <button type="button" className="font-semibold underline" onClick={() => window.location.reload()}>Réessayer</button>
  </div>;
}

function AuthLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setSlow(true), 12000); return () => window.clearTimeout(timer); }, []);
  if (slow) return <AuthUnavailable />;
  return <p role="status" className="flex items-center gap-2 py-6 text-sm text-zinc-600"><Loader2 className="h-4 w-4 animate-spin" />Chargement du formulaire sécurisé…</p>;
}

export default AuthSwitch;
