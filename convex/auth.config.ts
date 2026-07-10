// Migration Clerk dev -> prod (domaine groupemes.fr). On accepte pendant la
// bascule les JWT des DEUX instances Clerk (dev + prod) pour ne casser ni les
// sessions en cours ni les nouvelles. Chaque issuer devient un provider valide.
//
// - `CLERK_JWT_ISSUER_DOMAIN`      : issuer dev (epic-monkey-68.clerk.accounts.dev).
// - `CLERK_JWT_ISSUER_DOMAIN_PROD` : issuer prod (sinon fallback clerk.groupemes.fr).
const PROD_ISSUER_FALLBACK = "https://clerk.groupemes.fr";

const issuerDomains = [
  process.env.CLERK_JWT_ISSUER_DOMAIN,
  process.env.CLERK_JWT_ISSUER_DOMAIN_PROD ?? PROD_ISSUER_FALLBACK,
]
  .map((domain) => domain?.trim())
  .filter((domain): domain is string => Boolean(domain))
  .filter((domain, index, all) => all.indexOf(domain) === index);

export default {
  providers: issuerDomains.map((domain) => ({
    domain,
    applicationID: "convex",
  })),
};
