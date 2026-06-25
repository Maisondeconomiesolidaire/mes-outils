import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { Id } from "./_generated/dataModel";

const http = httpRouter();

/**
 * Sert un fichier du stockage Convex en octets directs (HTTP 200, sans
 * redirection signée) — fiable pour les images d'emails (proxy Gmail, etc.).
 * Exemple : GET /email/image?id=<storageId>
 */
http.route({
  path: "/email/image",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return new Response("Missing id", { status: 400 });
    const blob = await ctx.storage.get(id as Id<"_storage">);
    if (!blob) return new Response("Not found", { status: 404 });
    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": blob.type || "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }),
});

export default http;
