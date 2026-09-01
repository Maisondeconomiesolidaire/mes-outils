/**
 * Emails Bâtire.
 *
 * Gabarit et expéditeur propres à Bâtire : un donateur qui reçoit la réponse à
 * son don ne doit pas lire une lettre de la Recyclerie.
 */
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { esc, resendSend } from "./emails";

const FROM = "Bâtire <no-reply@mesoutils.eco-solidaire.fr>";

/** Ocre de marque Bâtire (`brand-500` / `brand-700` de l'app). */
const BRAND = "#c9741f";
const BRAND_DARK = "#834717";

function appUrl() {
  return (process.env.BATIRE_APP_URL ?? "https://batire.groupemes.fr").replace(/\/$/, "");
}

function button(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:4px 0 22px;">
    <tr><td style="border-radius:12px;background:${BRAND_DARK};">
      <a href="${href}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(label)}</a>
    </td></tr>
  </table>`;
}

/** Encart de citation : motif de refus, consignes de dépôt. */
function note(title: string, body: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 22px;background:#faf7f2;border:1px solid #efe6d9;border-left:4px solid ${BRAND};border-radius:12px;">
    <tr><td style="padding:14px 18px;font-family:Helvetica,Arial,sans-serif;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8a7259;">${esc(title)}</p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#3f3f46;white-space:pre-line;">${esc(body)}</p>
    </td></tr>
  </table>`;
}

function shell(opts: { preheader: string; heading: string; intro: string; contentHtml?: string }) {
  return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <style>@media (max-width:600px){.container{width:100% !important;}.px{padding-left:20px !important;padding-right:20px !important;}}</style>
  </head>
  <body style="margin:0;padding:0;background:#f6f2ec;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(opts.preheader)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f2ec;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" class="container" style="width:600px;max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #ece4d8;box-shadow:0 10px 40px rgba(24,24,27,0.06);">
          <tr>
            <td class="px" style="padding:22px 32px;border-bottom:1px solid #f1e9dd;border-top:4px solid ${BRAND};">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-.02em;color:#18181b;">Bâtire<span style="color:${BRAND};">.</span></p>
              <p style="margin:2px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#a1a1aa;">Matériaux de réemploi</p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:30px 32px;">
              <h1 style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:22px;line-height:1.25;color:#18181b;">${esc(opts.heading)}</h1>
              <p style="margin:0 0 20px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#3f3f46;">${opts.intro}</p>
              ${opts.contentHtml ?? ""}
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:20px 32px;background:#faf7f2;border-top:1px solid #f1e9dd;">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#b8b0a4;">
                Message automatique — merci de ne pas y répondre. Écrivez-nous depuis la messagerie de votre espace client.
              </p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** Réponse de l'équipe à un don proposé depuis la boutique. */
export const sendDonationDecision = internalAction({
  args: {
    to: v.string(),
    firstName: v.string(),
    reference: v.string(),
    title: v.string(),
    accepted: v.boolean(),
    /** Consignes de dépôt si accepté, motif si refusé. */
    message: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const lot = `<strong>${esc(args.title)}</strong> (${esc(args.reference)})`;
    const html = args.accepted
      ? shell({
          preheader: `Votre don ${args.reference} est accepté.`,
          heading: "Don accepté",
          intro:
            `Bonjour ${esc(args.firstName)},<br/><br/>` +
            `Votre don ${lot} est accepté. Vous pouvez le déposer au dépôt pendant les horaires d'ouverture.`,
          contentHtml:
            (args.message ? note("Conditions de dépôt", args.message) : "") +
            button(`${appUrl()}/mon-compte`, "Suivre mon don") +
            `<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#71717a;">Merci de garder la référence ${esc(args.reference)} à portée de main lors du dépôt.</p>`,
        })
      : shell({
          preheader: `Votre don ${args.reference} n'a pas été retenu.`,
          heading: "Don non retenu",
          intro:
            `Bonjour ${esc(args.firstName)},<br/><br/>` +
            `Malheureusement, votre don ${lot} n'a pas été accepté.`,
          contentHtml:
            (args.message ? note("Motif", args.message) : "") +
            button(`${appUrl()}/don/nouveau`, "Proposer un autre don"),
        });

    await resendSend(
      args.to,
      args.accepted
        ? `Don accepté — ${args.title}`
        : `Don non retenu — ${args.title}`,
      html,
      FROM,
    );
  },
});
