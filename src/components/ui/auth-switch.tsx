import { useRef, useState } from "react";
import { useSignIn, useSignUp } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";

type Mode = "signin" | "signup" | "code" | "reset-request" | "reset";

export function AuthSwitch({ initialMode = "signin" }: { initialMode?: "signin" | "signup" }) {
  const navigate = useNavigate();
  const { signIn, setActive: setSignInActive } = useSignIn();
  const { signUp, setActive: setSignUpActive } = useSignUp();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const sendCode = async () => { if (!email.trim()) throw new Error("Renseignez votre adresse email avant de demander un code."); const attempt = await signIn?.create({ identifier: email.trim() }); if (!attempt) throw new Error("Connexion indisponible, réessayez dans un instant."); const factor = attempt.supportedFirstFactors?.find((item) => item.strategy === "email_code"); if (!factor || factor.strategy !== "email_code") throw new Error("La connexion par code n'est pas disponible pour cette adresse."); await attempt.prepareFirstFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId }); setMode("code"); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (locked.current) return; locked.current = true; setBusy(true); setError("");
    try {
      if (mode === "signup") { const result = await signUp?.create({ emailAddress: email.trim(), password, firstName, lastName, legalAccepted: true }); if (result?.status === "complete") await setSignUpActive?.({ session: result.createdSessionId }); else throw new Error("Inscription incomplète."); }
      else if (mode === "signin") { const result = await signIn?.create({ strategy: "password", identifier: email.trim(), password }); if (result?.status === "complete") await setSignInActive?.({ session: result.createdSessionId }); else throw new Error("Une étape supplémentaire est requise."); }
      else if (mode === "code") { const result = await signIn?.attemptFirstFactor({ strategy: "email_code", code: code.replace(/\s/g, "") }); if (result?.status === "complete") await setSignInActive?.({ session: result.createdSessionId }); else throw new Error("Code incorrect ou expiré."); }
      else if (mode === "reset-request") { if (!email.trim()) throw new Error("Renseignez votre adresse email avant de demander la réinitialisation."); await signIn?.create({ strategy: "reset_password_email_code", identifier: email.trim() }); setMode("reset"); return; }
      else { const result = await signIn?.attemptFirstFactor({ strategy: "reset_password_email_code", code: code.replace(/\s/g, ""), password: newPassword }); if (result?.status === "complete") await setSignInActive?.({ session: result.createdSessionId }); else throw new Error("Code ou mot de passe invalide."); }
      navigate("/", { replace: true });
    } catch (caught) { setError((caught as { errors?: Array<{ longMessage?: string }> }).errors?.[0]?.longMessage ?? (caught as Error).message ?? "Une erreur est survenue."); } finally { locked.current = false; setBusy(false); }
  };
  const codeMode = mode === "code" || mode === "reset";
  return <main className="min-h-screen bg-gradient-to-br from-brand-50 to-brand-200 p-4"><section className="mx-auto grid min-h-[700px] max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl lg:grid-cols-2"><aside className="order-2 flex flex-col items-center justify-center gap-5 bg-brand-600 p-10 text-center text-white lg:order-none"><img src="/mesoutils-light.png" alt="Mes Outils" className="h-20 w-auto" /><h2 className="text-3xl font-black">{mode === "signup" ? "Déjà membre ?" : "Nouveau ici ?"}</h2><p>{mode === "signup" ? "Connectez-vous à votre espace Mes Outils." : "Créez votre espace pour accéder aux outils du groupe."}</p><button type="button" className="rounded-full border border-white px-6 py-3 font-bold" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>{mode === "signup" ? "Se connecter" : "Créer un compte"}</button></aside><div className="flex items-center justify-center p-8 sm:p-14"><div className="w-full max-w-md"><img src="/mesoutils-light.png" alt="Mes Outils" className="mb-8 h-16 w-auto" /><h1 className="text-3xl font-black">{mode === "signup" ? "Créer votre compte" : mode === "reset" ? "Nouveau mot de passe" : mode === "reset-request" ? "Réinitialiser le mot de passe" : "Bienvenue sur Mes Outils"}</h1><p className="mt-2 text-sm text-zinc-600">{codeMode ? "Saisissez le code reçu par email." : "Connectez-vous pour accéder au portail."}</p><form className="mt-7 space-y-4" onSubmit={submit}>{mode === "signup" ? <div className="grid gap-4 sm:grid-cols-2"><input required placeholder="Prénom" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="h-12 rounded-xl border p-3" /><input required placeholder="Nom" value={lastName} onChange={(e) => setLastName(e.target.value)} className="h-12 rounded-xl border p-3" /></div> : null}{!codeMode ? <input required type="email" placeholder="Adresse email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 w-full rounded-xl border p-3" /> : null}{mode === "signin" || mode === "signup" ? <input required type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 w-full rounded-xl border p-3" /> : null}{codeMode ? <input required inputMode="numeric" placeholder="Code de confirmation" value={code} onChange={(e) => setCode(e.target.value)} className="h-12 w-full rounded-xl border p-3" /> : null}{mode === "reset" ? <input required type="password" placeholder="Nouveau mot de passe" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-12 w-full rounded-xl border p-3" /> : null}{mode === "signup" ? <label className="flex gap-2 text-sm"><input required type="checkbox" />J’accepte les conditions d’utilisation.</label> : null}{error ? <p className="text-sm text-red-600">{error}</p> : null}<button disabled={busy} className="h-12 w-full rounded-xl bg-brand-600 font-bold text-white disabled:opacity-60">{busy ? "Chargement…" : codeMode ? "Confirmer" : mode === "reset-request" ? "Envoyer le code" : mode === "signup" ? "Créer mon compte" : "Se connecter"}</button></form>{mode === "signin" ? <div className="mt-5 flex gap-5 text-sm font-semibold text-brand-700"><button type="button" onClick={() => void sendCode()}>Recevoir un code de connexion</button><button type="button" onClick={() => setMode("reset-request")}>Mot de passe oublié ?</button></div> : null}</div></div></section></main>;
}
