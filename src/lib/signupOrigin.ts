/**
 * Origine d'une inscription, capturée dans le navigateur AVANT la redirection
 * vers Clerk. Le chemin relevé au retour de connexion est presque toujours
 * l'accueil : seul ce qui est mémorisé pendant la visite dit de quel écran
 * part réellement l'inscription.
 *
 * Fichier identique dans les applications de l'écosystème.
 */
const LANDING_KEY = "signup-origin:landing";
const ENTRY_KEY = "signup-origin:entry";
const REFERRER_KEY = "signup-origin:referrer";
const UTM_KEY = "signup-origin:utm";

/** La navigation privée et les navigateurs verrouillés lèvent : on s'en passe. */
function read(key: string) {
  try {
    return window.sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : la trace sera simplement moins précise */
  }
}

export function currentPath() {
  return window.location.pathname + window.location.search + window.location.hash;
}

/** Première page de la visite, provenance externe et campagne : une seule fois. */
export function captureLanding() {
  if (read(LANDING_KEY)) return;
  write(LANDING_KEY, currentPath());

  const referrer = document.referrer;
  // Une navigation interne n'est pas une provenance : elle dirait « le site
  // vient du site ».
  if (referrer && !referrer.startsWith(window.location.origin)) write(REFERRER_KEY, referrer);

  const utm = [...new URLSearchParams(window.location.search)]
    .filter(([key]) => key.startsWith("utm_"))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  if (utm) write(UTM_KEY, utm);
}

/** Dernier écran vu en étant déconnecté : le point de départ de l'inscription. */
export function rememberAnonymousPath() {
  write(ENTRY_KEY, currentPath());
}

/** Ce qui part à `users.syncProfile`. */
export function signupSource(app: string) {
  return {
    app,
    path: currentPath(),
    entryPath: read(ENTRY_KEY),
    landingPath: read(LANDING_KEY),
    referrer: read(REFERRER_KEY),
    utm: read(UTM_KEY),
  };
}
