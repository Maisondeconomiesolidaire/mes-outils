import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { captureLanding, rememberAnonymousPath, signupSource } from "../lib/signupOrigin";

/**
 * Crée le profil Convex à la connexion et lui attache l'origine de
 * l'inscription. À monter une fois, à la racine de l'application, HORS de
 * `<SignedIn>` : c'est pendant la visite déconnectée que la trace se
 * constitue.
 *
 * Composant identique dans les applications de l'écosystème.
 */
export function ProfileSync({ app }: { app: string }) {
  const { isSignedIn } = useAuth();
  const syncProfile = useMutation(api.users.syncProfile);
  const synced = useRef(false);

  // Sans tableau de dépendances : la trace suit la navigation, qu'elle passe
  // par un routeur ou par un simple état d'écran.
  useEffect(() => {
    captureLanding();
    if (!isSignedIn) rememberAnonymousPath();
  });

  useEffect(() => {
    if (!isSignedIn || synced.current) return;
    synced.current = true;
    void syncProfile({ source: signupSource(app) });
  }, [app, isSignedIn, syncProfile]);

  return null;
}
