export type RemotePost = { id: string; message?: string; createdAt?: number; scheduledFor?: number; permalink?: string; withPhoto?: boolean };
export type Snapshot = { posts: RemotePost[]; complete: boolean };

/** Never treat a failed/partial page as an authoritative empty account. */
export async function fetchSocialSnapshot(url: string, token: string, network: "facebook" | "instagram", scheduled = false): Promise<Snapshot> {
  const posts = new Map<string, RemotePost>();
  let next: string | undefined = url;
  const visited = new Set<string>();
  for (let page = 0; next && page < 20; page++) {
    const target = new URL(next);
    if (target.protocol !== "https:" || target.hostname !== "graph.facebook.com" || visited.has(next)) throw new Error("Pagination Meta invalide.");
    visited.add(next);
    const response = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    const result = await response.json() as { data?: Array<{ id?: string; message?: string; caption?: string; created_time?: string; timestamp?: string; scheduled_publish_time?: number; permalink_url?: string; permalink?: string; full_picture?: string }>; paging?: { next?: string }; error?: { code?: number } };
    if (!response.ok || result.error || !Array.isArray(result.data)) throw new Error(result.error?.code === 190 ? "Connexion expirée : reconnectez la page." : "Lecture Meta indisponible : aucune suppression effectuée.");
    for (const row of result.data) {
      if (typeof row.id !== "string") throw new Error("Réponse Meta incomplète.");
      const createdAt = Date.parse(row.created_time ?? row.timestamp ?? "");
      posts.set(row.id, { id: row.id, message: network === "instagram" ? row.caption ?? "" : row.message ?? "", createdAt: Number.isFinite(createdAt) ? createdAt : undefined, scheduledFor: scheduled && row.scheduled_publish_time ? row.scheduled_publish_time * 1000 : undefined, permalink: row.permalink_url ?? row.permalink, withPhoto: network === "instagram" || Boolean(row.full_picture) });
    }
    next = result.paging?.next;
  }
  return { posts: [...posts.values()], complete: !next };
}

export function deletionDecision(post: { createdAt: number; _creationTime: number; scheduledFor?: number }, startedAt: number, complete: boolean): "keep" | "remove" {
  if (post.scheduledFor !== undefined && Math.abs(startedAt - post.scheduledFor) < 120_000) return "keep";
  if (!complete || post._creationTime > startedAt || post.createdAt > startedAt - 120_000) return "keep";
  return "remove";
}
