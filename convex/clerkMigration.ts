import { action, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireUser } from "./lib";

/**
 * Migration Clerk dev -> prod (domaine groupemes.fr).
 *
 * On « exporte » les utilisateurs vers l'instance Clerk PROD en les recréant par
 * email (sans mot de passe) : ils n'auront qu'à faire « mot de passe oublié ».
 * Leurs données restent rattachées automatiquement : à la première connexion
 * prod, `users.syncProfile` retrouve le profil par email et remplace l'ancien
 * clerkId dev par le nouveau clerkId prod (remapClerkIdEverywhere).
 *
 * Prérequis : `npx convex env set --prod CLERK_PROD_SECRET_KEY sk_live_...`
 * (clé secrète de l'instance PROD). On utilise une variable dédiée pour ne pas
 * perturber `CLERK_SECRET_KEY` (encore en dev pendant la bascule).
 */

export const usersForClerkExport = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users
      .map((user) => ({
        email: user.email.trim().toLowerCase(),
        firstName: user.firstName?.trim() || undefined,
        lastName: user.lastName?.trim() || undefined,
      }))
      .filter((user) => Boolean(user.email));
  },
});

type ClerkErrorBody = { errors?: Array<{ code?: string; message?: string }> };

export const exportUsersToProdClerk = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ total: number; created: number; skipped: number; failed: number; errors: string[] }> => {
    await requireUser(ctx);
    const access = await ctx.runQuery(api.permissions.myAccess, {});
    if (!access.isAdmin) throw new Error("Réservé aux administrateurs.");

    const secret = process.env.CLERK_PROD_SECRET_KEY;
    if (!secret) {
      throw new Error(
        "CLERK_PROD_SECRET_KEY manquante. Fais : npx convex env set --prod CLERK_PROD_SECRET_KEY sk_live_...",
      );
    }

    const users = await ctx.runQuery(internal.clerkMigration.usersForClerkExport, {});
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const user of users) {
      try {
        const response = await fetch("https://api.clerk.com/v1/users", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email_address: [user.email],
            ...(user.firstName ? { first_name: user.firstName } : {}),
            ...(user.lastName ? { last_name: user.lastName } : {}),
            skip_password_requirement: true,
          }),
        });
        if (response.ok) {
          created += 1;
        } else {
          const body = (await response.json().catch(() => ({}))) as ClerkErrorBody;
          const code = body.errors?.[0]?.code ?? "";
          // Email déjà présent côté prod : on considère l'utilisateur exporté.
          if (
            response.status === 422 ||
            code.includes("already_exists") ||
            code.includes("identifier_exists") ||
            code.includes("duplicate")
          ) {
            skipped += 1;
          } else {
            failed += 1;
            if (errors.length < 25) {
              errors.push(`${user.email}: ${response.status} ${body.errors?.[0]?.message ?? ""}`.trim());
            }
          }
        }
      } catch (error) {
        failed += 1;
        if (errors.length < 25) {
          errors.push(`${user.email}: ${error instanceof Error ? error.message : "erreur réseau"}`);
        }
      }
      // Respect du rate limit Clerk (~20 req/s) : petite pause.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    return { total: users.length, created, skipped, failed, errors };
  },
});
