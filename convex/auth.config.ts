export default {
  providers: [
    {
      // Défini via `npx convex env set CLERK_JWT_ISSUER_DOMAIN https://...clerk.accounts.dev`
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
