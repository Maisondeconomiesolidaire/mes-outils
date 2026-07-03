import { internalAction } from "./_generated/server";
import { v } from "convex/values";

// Adresse d'expédition. Domaine `mesoutils.eco-solidaire.fr` vérifié sur Resend
// (partagé par toutes les apps de l'écosystème) — meilleure délivrabilité que
// l'ancienne adresse de test onboarding@resend.dev.
const FROM = "Cycle en Bray <no-reply@mesoutils.eco-solidaire.fr>";

/** URL publique de l'app (liens des emails). À régler via `npx convex env set APP_URL`. */
function appUrl() {
  return (process.env.APP_URL ?? "https://recycapp.vercel.app").replace(/\/$/, "");
}

/** URL du déploiement Convex (HTTP actions), pour servir les images d'emails. */
function siteUrl() {
  return (
    process.env.CONVEX_SITE_URL ??
    "https://sensible-gull-961.eu-west-1.convex.site"
  ).replace(/\/$/, "");
}

/** URL directe (octets, sans redirection) d'un fichier du stockage Convex. */
export function storageImageUrl(storageId: string) {
  return `${siteUrl()}/email/image?id=${encodeURIComponent(storageId)}`;
}

/** URL du logo (servi depuis le stockage Convex via EMAIL_LOGO_ID). */
function logoUrl() {
  const id = process.env.EMAIL_LOGO_ID;
  return id ? storageImageUrl(id) : `${appUrl()}/recyclerie-logo.png`;
}

const BRAND = "#f1104f";

const TYPE_LABELS: Record<string, string> = {
  aerogommage: "Aérogommage",
  collecte: "Collecte",
  article: "Boutique",
  velo: "Cycle en Bray",
  livraison: "Livraison",
};

function typeLabel(type: string) {
  return TYPE_LABELS[type] ?? "Demande";
}

export function esc(value: string) {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

function euro(n: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

function formatDay(timestamp: number) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  }).format(new Date(timestamp));
}

// ─── Briques de mise en page (bulletproof email HTML) ────────────────────────

/** Bouton « à toute épreuve » (table + lien). */
function button(href: string, label: string, primary = true) {
  const bg = primary ? BRAND : "#ffffff";
  const color = primary ? "#ffffff" : BRAND;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
    <tr><td style="border-radius:12px;background:${bg};border:1.5px solid ${BRAND};">
      <a href="${href}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;color:${color};text-decoration:none;border-radius:12px;">${esc(label)}</a>
    </td></tr>
  </table>`;
}

/** Rangée de liens raccourcis vers l'espace client. */
function quickLinks() {
  const base = appUrl();
  const links: Array<[string, string]> = [
    ["Mon compte", `${base}/compte`],
    ["Mes commandes", `${base}/compte/commandes`],
    ["Messagerie", `${base}/compte/messagerie`],
  ];
  const cells = links
    .map(
      ([label, href]) =>
        `<td style="padding:0 6px 8px 0;">${button(href, label, false)}</td>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`;
}

type ArticlePreview = {
  title: string;
  price?: number;
  condition?: string;
  imageUrl?: string;
  href?: string;
};

/** Carte d'aperçu d'un article (image + titre + prix + lien). */
function articleCard(article: ArticlePreview) {
  const img = article.imageUrl
    ? `<td width="120" valign="top" style="width:120px;">
         <img src="${article.imageUrl}" width="120" height="120" alt="" style="display:block;width:120px;height:120px;object-fit:cover;border-radius:14px 0 0 14px;" />
       </td>`
    : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #ece9e4;border-radius:16px;overflow:hidden;background:#fffdfb;">
    <tr>
      ${img}
      <td valign="top" style="padding:16px 18px;">
        <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#18181b;">${esc(article.title)}</p>
        ${article.condition ? `<p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#a1a1aa;">${esc(article.condition)}</p>` : ""}
        ${article.price != null ? `<p style="margin:0 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:800;color:${BRAND};">${euro(article.price)}</p>` : ""}
        ${article.href ? button(article.href, "Voir l'article", false) : ""}
      </td>
    </tr>
  </table>`;
}

/** Gabarit complet : préheader, en-tête (logo), contenu, pied de page. */
function shell(opts: {
  preheader: string;
  heading: string;
  intro: string;
  contentHtml?: string;
}) {
  const base = appUrl();
  return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <style>
      @media (max-width:600px){
        .container{width:100% !important;}
        .px{padding-left:20px !important;padding-right:20px !important;}
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#f4f1ec;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(opts.preheader)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f1ec;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" class="container" style="width:600px;max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #ece9e4;box-shadow:0 10px 40px rgba(24,24,27,0.06);">
          <!-- En-tête -->
          <tr>
            <td style="background:linear-gradient(135deg,#ffffff,#fff7ef,#ffe9d6);padding:22px 28px;border-bottom:1px solid #f1ece5;">
              <a href="${base}/boutique" target="_blank" style="text-decoration:none;">
                <img src="${logoUrl()}" height="40" alt="Cycle en Bray" style="display:block;height:40px;" />
              </a>
            </td>
          </tr>
          <!-- Contenu -->
          <tr>
            <td class="px" style="padding:30px 32px;">
              <h1 style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:22px;line-height:1.25;color:#18181b;">${esc(opts.heading)}</h1>
              <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#3f3f46;">${opts.intro}</p>
              ${opts.contentHtml ?? ""}
            </td>
          </tr>
          <!-- Pied de page -->
          <tr>
            <td class="px" style="padding:22px 32px;background:#faf8f5;border-top:1px solid #f1ece5;">
              <p style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:#52525b;">Recyclerie Cycle en Bray</p>
              <p style="margin:0 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#a1a1aa;">
                4 rue de la prairie, 60650 Lachapelle-aux-Pots<br/>
                Réemploi, collecte, aérogommage &amp; atelier vélo
              </p>
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#c4c0b8;">
                Message automatique — merci de ne pas répondre à cet email. Pour nous écrire, utilisez votre <a href="${base}/compte/messagerie" style="color:${BRAND};text-decoration:none;">messagerie</a>.
              </p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export async function resendSend(
  to: string,
  subject: string,
  html: string,
  from: string = FROM,
) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY non configurée — email ignoré.");
    return;
  }
  const email = to.trim();
  if (!email) return;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to: [email], subject, html }),
  });

  if (!response.ok) {
    console.error(
      `Resend (${response.status}) :`,
      (await response.text()).slice(0, 300),
    );
  }
}

const articleArg = v.optional(
  v.object({
    title: v.string(),
    price: v.optional(v.number()),
    condition: v.optional(v.string()),
    imageStorageId: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    articleId: v.optional(v.string()),
  }),
);

function buildArticleCard(
  article:
    | {
        title: string;
        price?: number;
        condition?: string;
        imageStorageId?: string;
        imageUrl?: string;
        articleId?: string;
      }
    | undefined,
) {
  if (!article) return "";
  const href = article.articleId
    ? `${appUrl()}/boutique/${article.articleId}`
    : undefined;
  const imageUrl = article.imageStorageId
    ? storageImageUrl(article.imageStorageId)
    : article.imageUrl;
  return `<div style="margin:0 0 22px;">${articleCard({
    title: article.title,
    price: article.price,
    condition: article.condition,
    imageUrl,
    href,
  })}</div>`;
}

// ─── Emails transactionnels ──────────────────────────────────────────────────

/** Confirmation à la réception d'une nouvelle demande. */
export const sendRequestConfirmation = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    reference: v.string(),
    type: v.string(),
    requestId: v.string(),
    article: articleArg,
  },
  handler: async (_ctx, { email, name, reference, type, requestId, article }) => {
    const label = typeLabel(type);
    const orderUrl = `${appUrl()}/compte/commandes/${requestId}`;
    const html = shell({
      preheader: `Votre demande ${label} #${reference} est bien enregistrée.`,
      heading: "Votre demande est bien enregistrée 🎉",
      intro: `Bonjour ${esc(name)},<br/><br/>Nous avons bien reçu votre demande <strong>${esc(label)}</strong> (référence <strong>#${esc(reference)}</strong>). Notre équipe la traite et revient vers vous très prochainement.`,
      contentHtml: `
        ${buildArticleCard(article)}
        <div style="margin:0 0 22px;">${button(orderUrl, "Suivre ma demande")}</div>
        <p style="margin:0 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#71717a;">Accès rapides :</p>
        ${quickLinks()}
      `,
    });
    await resendSend(email, `Demande bien reçue · ${label} #${reference}`, html);
  },
});

/** Notification au client d'un nouveau message du staff. */
export const sendNewMessage = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    reference: v.string(),
    type: v.string(),
    requestId: v.string(),
    snippet: v.string(),
  },
  handler: async (_ctx, { email, name, reference, type, requestId, snippet }) => {
    const label = typeLabel(type);
    const conversationUrl = `${appUrl()}/compte/messagerie`;
    void requestId;
    const html = shell({
      preheader: `Nouveau message concernant votre demande ${label} #${reference}.`,
      heading: "Vous avez reçu un nouveau message 💬",
      intro: `Bonjour ${esc(name)},<br/><br/>L'équipe Cycle en Bray vous a écrit au sujet de votre demande <strong>${esc(label)}</strong> (référence <strong>#${esc(reference)}</strong>).`,
      contentHtml: `
        <blockquote style="margin:0 0 22px;padding:14px 18px;background:#faf8f5;border-left:3px solid ${BRAND};border-radius:10px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3f3f46;">${esc(snippet)}</blockquote>
        <div style="margin:0 0 22px;">${button(conversationUrl, "Répondre au message")}</div>
        <p style="margin:0 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#71717a;">Accès rapides :</p>
        ${quickLinks()}
      `,
    });
    await resendSend(email, `Nouveau message · ${label} #${reference}`, html);
  },
});

/** Demande de photos au client (déclenchée par le staff depuis le CRM). */
export const sendPhotoRequest = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    reference: v.string(),
    type: v.string(),
    requestId: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (_ctx, { email, name, reference, type, requestId, note }) => {
    const label = typeLabel(type);
    const url = `${appUrl()}/compte/commandes/${requestId}`;
    const html = shell({
      preheader: `Nous avons besoin de photos pour votre demande ${label} #${reference}.`,
      heading: "Pouvez-vous nous envoyer des photos ? 📸",
      intro: `Bonjour ${esc(name)},<br/><br/>Pour avancer sur votre demande <strong>${esc(label)}</strong> (référence <strong>#${esc(reference)}</strong>), notre équipe a besoin de quelques photos.`,
      contentHtml: `
        ${note ? `<blockquote style="margin:0 0 20px;padding:14px 18px;background:#faf8f5;border-left:3px solid ${BRAND};border-radius:10px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3f3f46;">${esc(note)}</blockquote>` : ""}
        <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3f3f46;">Cliquez ci-dessous pour importer vos photos directement dans votre demande, dans l'onglet <strong>Documents</strong> :</p>
        <div style="margin:0 0 22px;">${button(url, "Ajouter mes photos")}</div>
        <p style="margin:0 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#71717a;">Accès rapides :</p>
        ${quickLinks()}
      `,
    });
    await resendSend(email, `Photos demandées · ${label} #${reference}`, html);
  },
});

/** Notification au client qu'un document a été ajouté à sa demande. */
export const sendNewDocument = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    reference: v.string(),
    type: v.string(),
    requestId: v.string(),
    docName: v.string(),
  },
  handler: async (_ctx, { email, name, reference, type, requestId, docName }) => {
    const label = typeLabel(type);
    const url = `${appUrl()}/compte/commandes/${requestId}`;
    const html = shell({
      preheader: `Un nouveau document est disponible pour votre demande ${label} #${reference}.`,
      heading: "Un nouveau document est disponible 📄",
      intro: `Bonjour ${esc(name)},<br/><br/>L'équipe Cycle en Bray a ajouté un document à votre demande <strong>${esc(label)}</strong> (référence <strong>#${esc(reference)}</strong>).`,
      contentHtml: `
        <div style="margin:0 0 20px;padding:14px 18px;background:#faf8f5;border:1px solid #ece9e4;border-radius:12px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#3f3f46;">📎 ${esc(docName)}</div>
        <div style="margin:0 0 22px;">${button(url, "Voir mes documents")}</div>
        <p style="margin:0 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#71717a;">Accès rapides :</p>
        ${quickLinks()}
      `,
    });
    await resendSend(email, `Nouveau document · ${label} #${reference}`, html);
  },
});

/** Notification au client que sa demande a été programmée à une date. */
export const sendScheduled = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    reference: v.string(),
    type: v.string(),
    requestId: v.string(),
    date: v.number(),
    article: articleArg,
  },
  handler: async (
    _ctx,
    { email, name, reference, type, requestId, date, article },
  ) => {
    const label = typeLabel(type);
    const day = formatDay(date);
    const orderUrl = `${appUrl()}/compte/commandes/${requestId}`;
    const html = shell({
      preheader: `Votre demande ${label} #${reference} est programmée pour le ${day}.`,
      heading: "Votre demande est programmée 📅",
      intro: `Bonjour ${esc(name)},<br/><br/>Bonne nouvelle : votre demande <strong>${esc(label)}</strong> (référence <strong>#${esc(reference)}</strong>) est programmée.`,
      contentHtml: `
        <div style="margin:0 0 22px;padding:16px 18px;background:linear-gradient(135deg,#fff7ef,#ffe9d6);border:1px solid #ffe0c4;border-radius:14px;text-align:center;">
          <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#b45309;">Date d'intervention</p>
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;color:${BRAND};text-transform:capitalize;">${esc(day)}</p>
        </div>
        ${buildArticleCard(article)}
        <div style="margin:0 0 22px;">${button(orderUrl, "Voir ma demande")}</div>
        <p style="margin:0 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#71717a;">Accès rapides :</p>
        ${quickLinks()}
      `,
    });
    await resendSend(email, `Intervention programmée · ${label} #${reference}`, html);
  },
});
