import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { esc, resendSend, storageImageUrl } from "./emails";

// Emails internes de l'application Mes Outils (équipe), distincts des emails
// clients de la recyclerie (cf. `emails.ts`). Expéditeur et gabarit dédiés.
const FROM = "Mes Outils <no-reply@mesoutils.eco-solidaire.fr>";
// Vert de marque Mes Outils (identique au `brand-500` de l'app).
const BRAND = "#47c667";
const BRAND_DARK = "#2fa855";

/** Adresses des responsables notifiés des demandes de réservation de véhicule. */
export const VEHICLE_REQUEST_MANAGER_EMAILS = [
  "f.henry@eco-solidaire.fr",
  "y.prata@eco-solidaire.fr",
];

/** URL publique de l'app Mes Outils, pour les liens et le logo des emails. */
function appUrl() {
  return (process.env.MESOUTILS_APP_URL ?? "https://mesoutils.groupemes.fr").replace(/\/$/, "");
}

/** URL absolue du logo Mes Outils (version détourée pour email, servie par l'app). */
function logoUrl() {
  return `${appUrl()}/mesoutils-email-logo.png`;
}

/** Lien absolu vers une route de l'app. */
function appLink(path: string) {
  return `${appUrl()}${path}`;
}

/** Bouton « à toute épreuve » (table + lien). Rien si `href` est nul. */
function button(href: string | null, label: string) {
  if (!href) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 22px;">
    <tr><td style="border-radius:12px;background:${BRAND_DARK};">
      <a href="${href}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(label)}</a>
    </td></tr>
  </table>`;
}

/** Gabarit complet : préheader, titre, intro, contenu, pied de page neutre. */
function shell(opts: {
  preheader: string;
  heading: string;
  intro: string;
  contentHtml?: string;
  heroUrl?: string;
}) {
  return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
  </head>
  <body style="margin:0;padding:0;background:#eef4f1;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(opts.preheader)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef4f1;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e6efe9;box-shadow:0 10px 40px rgba(24,24,27,0.06);">
          <tr>
            <td style="background:linear-gradient(135deg,#ffffff,#f0faf3,#e6f6ec);padding:20px 28px;border-bottom:1px solid #e6efe9;border-top:4px solid ${BRAND};">
              <img src="${logoUrl()}" alt="Mes Outils" width="150" height="62" style="width:150px;height:auto;display:block;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>
          <tr>
            <td style="padding:30px 32px;">
              ${heroImage(opts.heroUrl)}
              <h1 style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:22px;line-height:1.25;color:#18181b;">${esc(opts.heading)}</h1>
              <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#3f3f46;">${opts.intro}</p>
              ${opts.contentHtml ?? ""}
            </td>
          </tr>
          <tr>
            <td style="padding:22px 32px;background:#f4faf6;border-top:1px solid #e2ede7;">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#9fb0a6;">
                Message automatique de l'espace Mes Outils — merci de ne pas répondre à cet email.
              </p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** URL d'image utilisable en email, depuis une URL directe ou un id de stockage. */
function resolveImageUrl(opts: { imageUrl?: string; imageStorageId?: string }) {
  if (opts.imageUrl) return opts.imageUrl;
  if (opts.imageStorageId) return storageImageUrl(opts.imageStorageId);
  return undefined;
}

/** Grande image d'illustration (photo du véhicule / de la salle / de l'annonce). */
function heroImage(url: string | undefined) {
  if (!url) return "";
  return `<img src="${url}" alt="" style="display:block;width:100%;max-width:536px;height:auto;max-height:260px;object-fit:cover;border-radius:14px;border:1px solid #e6efe9;margin:0 0 22px;" />`;
}

function initials(name: string) {
  const clean = name.trim();
  return (clean ? clean.slice(0, 2) : "?").toUpperCase();
}

/** Ligne « avatar + nom » pour présenter un utilisateur (avec photo de profil). */
function userChip(name: string, photoUrl?: string, sublabel?: string) {
  const avatar = photoUrl
    ? `<img src="${photoUrl}" alt="" width="44" height="44" style="width:44px;height:44px;border-radius:50%;object-fit:cover;display:block;border:0;" />`
    : `<div style="width:44px;height:44px;border-radius:50%;background:${BRAND};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;text-align:center;line-height:44px;">${esc(initials(name))}</div>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>
    <td style="vertical-align:middle;padding-right:12px;">${avatar}</td>
    <td style="vertical-align:middle;">
      <div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#18181b;">${esc(name)}</div>
      ${sublabel ? `<div style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#a1a1aa;">${esc(sublabel)}</div>` : ""}
    </td>
  </tr></table>`;
}

/** Encart mettant en avant le détail d'une réservation (créneau). */
function detailCard(rows: Array<[string, string]>) {
  const cells = rows
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding:6px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#a1a1aa;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
          <td style="padding:6px 0 6px 16px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#3f3f46;">${esc(value)}</td>
        </tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 22px;padding:16px 18px;background:#f4faf6;border:1px solid #e2ede7;border-radius:14px;">${cells}</table>`;
}

const dayFmt = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Paris",
});
const timeFmt = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

/** Créneau lisible : « lundi 30 juin, 09:00 – 11:00 » (ou sur deux jours). */
function formatRange(start: number, end: number) {
  const startDay = dayFmt.format(new Date(start));
  const endDay = dayFmt.format(new Date(end));
  if (startDay === endDay) {
    return `${startDay}, ${timeFmt.format(new Date(start))} – ${timeFmt.format(new Date(end))}`;
  }
  return `${startDay} ${timeFmt.format(new Date(start))} → ${endDay} ${timeFmt.format(new Date(end))}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendToEachRecipient(
  recipients: readonly string[],
  subject: string,
  html: string,
) {
  for (const [index, email] of recipients.entries()) {
    if (index > 0) await sleep(700);
    await resendSend(email, subject, html, FROM);
  }
}

// ─── Réservations (salles & véhicules) ───────────────────────────────────────

type ReservationState =
  | "submitted"
  | "confirmed"
  | "approved"
  | "rejected"
  | "cancelled";

const STATE_COPY: Record<
  ReservationState,
  { heading: string; subject: string; intro: (asset: string) => string }
> = {
  submitted: {
    heading: "Votre réservation a bien été soumise",
    subject: "Réservation soumise",
    intro: (asset) =>
      `Votre demande de réservation de ${asset} a bien été enregistrée. Elle est en attente de validation par un responsable — vous serez prévenu·e dès qu'une décision est prise.`,
  },
  confirmed: {
    heading: "Votre réservation est confirmée",
    subject: "Réservation confirmée",
    intro: (asset) =>
      `Votre réservation de ${asset} est confirmée. Voici le récapitulatif du créneau réservé.`,
  },
  approved: {
    heading: "Votre réservation a été validée",
    subject: "Réservation validée",
    intro: (asset) =>
      `Bonne nouvelle : votre réservation de ${asset} a été validée par un responsable.`,
  },
  rejected: {
    heading: "Votre réservation a été refusée",
    subject: "Réservation refusée",
    intro: (asset) =>
      `Votre réservation de ${asset} n'a pas pu être validée. N'hésitez pas à proposer un autre créneau.`,
  },
  cancelled: {
    heading: "Votre réservation a été annulée",
    subject: "Réservation annulée",
    intro: (asset) => `Votre réservation de ${asset} a été annulée.`,
  },
};

export const sendReservationEmail = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    assetKind: v.union(v.literal("room"), v.literal("vehicle")),
    assetName: v.string(),
    label: v.string(),
    start: v.number(),
    end: v.number(),
    state: v.union(
      v.literal("submitted"),
      v.literal("confirmed"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("cancelled"),
    ),
    note: v.optional(v.string()),
    // Photo de profil du demandeur + photo de l'actif (véhicule / salle).
    photoUrl: v.optional(v.string()),
    assetImageUrl: v.optional(v.string()),
    assetImageStorageId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const assetWord = args.assetKind === "room" ? "salle" : "véhicule";
    const copy = STATE_COPY[args.state];
    const rows: Array<[string, string]> = [
      [args.assetKind === "room" ? "Salle" : "Véhicule", args.assetName],
      [args.assetKind === "room" ? "Objet" : "Motif", args.label],
      ["Créneau", formatRange(args.start, args.end)],
    ];
    if (args.note) rows.push(["Note", args.note]);

    const heroUrl = resolveImageUrl({
      imageUrl: args.assetImageUrl,
      imageStorageId: args.assetImageStorageId,
    });

    const html = shell({
      preheader: copy.intro(`${assetWord} « ${args.assetName} »`),
      heading: copy.heading,
      heroUrl,
      intro: esc(copy.intro(`${assetWord} « ${args.assetName} »`)),
      contentHtml: `
        ${userChip(args.name, args.photoUrl, "Demandeur")}
        ${detailCard(rows)}
        ${button(appLink("/reservations?v=mine"), "Voir mes réservations")}
      `,
    });
    await resendSend(
      args.email,
      `${copy.subject} · ${args.assetName}`,
      html,
      FROM,
    );
  },
});

export const sendVehicleFeedbackRequestEmail = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    vehicleName: v.string(),
    label: v.string(),
    start: v.number(),
    end: v.number(),
    vehicleImageUrl: v.optional(v.string()),
    vehicleImageStorageId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const heroUrl = resolveImageUrl({
      imageUrl: args.vehicleImageUrl,
      imageStorageId: args.vehicleImageStorageId,
    });
    const rows: Array<[string, string]> = [
      ["Véhicule", args.vehicleName],
      ["Motif", args.label],
      ["Créneau terminé", formatRange(args.start, args.end)],
    ];

    const html = shell({
      preheader: `Merci de compléter le retour de votre réservation du véhicule « ${args.vehicleName} ».`,
      heading: "Retour de réservation véhicule",
      heroUrl,
      intro: `Bonjour ${esc(args.name)}, votre réservation de véhicule est terminée. Merci de compléter le court formulaire de retour : kilométrage relevé, carburant, objets laissés, propreté du véhicule et éventuels incidents ou remarques.`,
      contentHtml: `
        ${detailCard(rows)}
        ${button(appLink("/reservations?v=mine"), "Faire le retour")}
      `,
    });

    await resendSend(
      args.email,
      `Retour de réservation · ${args.vehicleName}`,
      html,
      FROM,
    );
  },
});

/** Demande de retour (remarques) après une réservation de salle terminée. */
export const sendRoomFeedbackRequestEmail = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    roomName: v.string(),
    label: v.string(),
    start: v.number(),
    end: v.number(),
    roomImageUrl: v.optional(v.string()),
    roomImageStorageId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const heroUrl = resolveImageUrl({
      imageUrl: args.roomImageUrl,
      imageStorageId: args.roomImageStorageId,
    });
    const rows: Array<[string, string]> = [
      ["Salle", args.roomName],
      ["Objet", args.label],
      ["Créneau terminé", formatRange(args.start, args.end)],
    ];

    const html = shell({
      preheader: `Merci de compléter le retour de votre réservation de la salle « ${args.roomName} ».`,
      heading: "Retour de réservation salle",
      heroUrl,
      intro: `Bonjour ${esc(args.name)}, votre réservation de salle est terminée. Merci de compléter le court formulaire de retour : propreté, rangement et éventuels incidents ou remarques.`,
      contentHtml: `
        ${detailCard(rows)}
        ${button(appLink("/reservations?v=mine"), "Faire le retour")}
      `,
    });

    await resendSend(args.email, `Retour de réservation · ${args.roomName}`, html, FROM);
  },
});

/**
 * Notifie les responsables (f.henry / y.prata) d'une nouvelle demande de
 * réservation de véhicule, avec un lien direct vers la validation.
 */
export const sendVehicleRequestToManagers = internalAction({
  args: {
    requesterName: v.string(),
    vehicleName: v.string(),
    label: v.string(),
    start: v.number(),
    end: v.number(),
    note: v.optional(v.string()),
    requesterPhotoUrl: v.optional(v.string()),
    vehicleImageUrl: v.optional(v.string()),
    vehicleImageStorageId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const rows: Array<[string, string]> = [
      ["Véhicule", args.vehicleName],
      ["Motif", args.label],
      ["Créneau", formatRange(args.start, args.end)],
    ];
    if (args.note) rows.push(["Note", args.note]);

    const heroUrl = resolveImageUrl({
      imageUrl: args.vehicleImageUrl,
      imageStorageId: args.vehicleImageStorageId,
    });

    const html = shell({
      preheader: `${args.requesterName} demande le véhicule « ${args.vehicleName} ».`,
      heading: "Nouvelle demande de réservation de véhicule",
      heroUrl,
      intro: `Une nouvelle demande de réservation de véhicule vient d'être soumise. Merci de la valider ou de la refuser.`,
      contentHtml: `
        ${userChip(args.requesterName, args.requesterPhotoUrl, "Demandeur")}
        ${detailCard(rows)}
        ${button(appLink("/gotravaux?v=reservations"), "Valider la demande")}
      `,
    });

    await resendSend(
      VEHICLE_REQUEST_MANAGER_EMAILS,
      `Demande de réservation · ${args.vehicleName} (${args.requesterName})`,
      html,
      FROM,
    );
  },
});

export const sendVehicleReservationManagerUpdate = internalAction({
  args: {
    state: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("cancelled"),
    ),
    requesterName: v.string(),
    vehicleName: v.string(),
    label: v.string(),
    start: v.number(),
    end: v.number(),
    note: v.optional(v.string()),
    requesterPhotoUrl: v.optional(v.string()),
    vehicleImageUrl: v.optional(v.string()),
    vehicleImageStorageId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const heading =
      args.state === "approved"
        ? "Réservation véhicule acceptée"
        : args.state === "rejected"
          ? "Réservation véhicule refusée"
          : "Réservation véhicule annulée";
    const intro =
      args.state === "approved"
        ? "Une demande de réservation véhicule a été acceptée."
        : args.state === "rejected"
          ? "Une demande de réservation véhicule a été refusée."
          : "Une demande de réservation véhicule a été annulée.";

    const rows: Array<[string, string]> = [
      ["Véhicule", args.vehicleName],
      ["Motif", args.label],
      ["Créneau", formatRange(args.start, args.end)],
    ];
    if (args.note) rows.push(["Note", args.note]);

    const heroUrl = resolveImageUrl({
      imageUrl: args.vehicleImageUrl,
      imageStorageId: args.vehicleImageStorageId,
    });

    const html = shell({
      preheader: `${args.requesterName} · ${args.vehicleName} · ${heading}`,
      heading,
      heroUrl,
      intro,
      contentHtml: `
        ${userChip(args.requesterName, args.requesterPhotoUrl, "Demandeur")}
        ${detailCard(rows)}
        ${button(appLink("/gotravaux?v=reservations"), "Voir les réservations")}
      `,
    });

    const subject =
      args.state === "approved"
        ? `Réservation acceptée · ${args.vehicleName} (${args.requesterName})`
        : args.state === "rejected"
          ? `Réservation refusée · ${args.vehicleName} (${args.requesterName})`
          : `Réservation annulée · ${args.vehicleName} (${args.requesterName})`;

    await resendSend(VEHICLE_REQUEST_MANAGER_EMAILS, subject, html, FROM);
  },
});

/** Adresses des responsables notifiés des réservations de salle. */
export const ROOM_RESERVATION_MANAGER_EMAILS = [
  "a.still@eco-solidaire.fr",
];

/**
 * Équipe Recyclerie prévenue quand un véhicule mis à sa disposition est
 * réservé (demande soumise) puis acceptée. Sans lien : pas d'accès à Gotravaux.
 */
export const RECYCLERIE_VEHICLE_NOTICE_EMAILS = [
  "a.dargent@eco-solidaire.fr",
  "s.tiennot@eco-solidaire.fr",
];

export const sendRecyclerieVehicleNotice = internalAction({
  args: {
    state: v.union(v.literal("submitted"), v.literal("approved")),
    requesterName: v.string(),
    vehicleName: v.string(),
    label: v.string(),
    start: v.number(),
    end: v.number(),
    note: v.optional(v.string()),
    requesterPhotoUrl: v.optional(v.string()),
    vehicleImageUrl: v.optional(v.string()),
    vehicleImageStorageId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const approved = args.state === "approved";
    const intro = approved
      ? "Une réservation vient d'être acceptée pour un véhicule de la Recyclerie."
      : "Une demande de réservation vient d'être effectuée pour un véhicule de la Recyclerie.";
    const heading = approved
      ? "Réservation acceptée pour un véhicule de la Recyclerie"
      : "Demande de réservation pour un véhicule de la Recyclerie";

    const rows: Array<[string, string]> = [
      ["Véhicule", args.vehicleName],
      ["Motif", args.label],
      ["Créneau", formatRange(args.start, args.end)],
    ];
    if (args.note) rows.push(["Note", args.note]);

    const heroUrl = resolveImageUrl({
      imageUrl: args.vehicleImageUrl,
      imageStorageId: args.vehicleImageStorageId,
    });

    const html = shell({
      preheader: intro,
      heading,
      heroUrl,
      intro,
      // Pas de bouton : ces destinataires n'ont pas accès à Gotravaux.
      contentHtml: `
        ${userChip(args.requesterName, args.requesterPhotoUrl, "Demandeur")}
        ${detailCard(rows)}
      `,
    });

    const subject = approved
      ? `Réservation acceptée · ${args.vehicleName} (Recyclerie)`
      : `Demande de réservation · ${args.vehicleName} (Recyclerie)`;
    await resendSend(RECYCLERIE_VEHICLE_NOTICE_EMAILS, subject, html, FROM);
  },
});

/** Notifie les responsables d'une réservation de salle. */
export const sendRoomReservationToManagers = internalAction({
  args: {
    requesterName: v.string(),
    roomName: v.string(),
    label: v.string(),
    start: v.number(),
    end: v.number(),
    note: v.optional(v.string()),
    requesterPhotoUrl: v.optional(v.string()),
    roomImageUrl: v.optional(v.string()),
    roomImageStorageId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const rows: Array<[string, string]> = [
      ["Salle", args.roomName],
      ["Objet", args.label],
      ["Créneau", formatRange(args.start, args.end)],
    ];
    if (args.note) rows.push(["Note", args.note]);

    const heroUrl = resolveImageUrl({
      imageUrl: args.roomImageUrl,
      imageStorageId: args.roomImageStorageId,
    });

    const html = shell({
      preheader: `${args.requesterName} a réservé la salle « ${args.roomName} ».`,
      heading: "Nouvelle réservation de salle",
      heroUrl,
      intro: `Une nouvelle réservation de salle vient d'être enregistrée.`,
      contentHtml: `
        ${userChip(args.requesterName, args.requesterPhotoUrl, "Demandeur")}
        ${detailCard(rows)}
        ${button(appLink("/salles"), "Voir les réservations")}
      `,
    });

    await sendToEachRecipient(
      ROOM_RESERVATION_MANAGER_EMAILS,
      `Réservation de salle · ${args.roomName} (${args.requesterName})`,
      html,
    );
  },
});

// ─── Bons plans ──────────────────────────────────────────────────────────────

export const sendDealInterestEmail = internalAction({
  args: {
    email: v.string(),
    authorName: v.string(),
    interestedName: v.string(),
    dealTitle: v.string(),
    interestedPhotoUrl: v.optional(v.string()),
    dealImageUrl: v.optional(v.string()),
    dealImageStorageId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const { email, authorName, interestedName, dealTitle } = args;
    const heroUrl = resolveImageUrl({
      imageUrl: args.dealImageUrl,
      imageStorageId: args.dealImageStorageId,
    });
    const html = shell({
      preheader: `${interestedName} est intéressé·e par votre annonce « ${dealTitle} ».`,
      heading: `${esc(interestedName)} est intéressé·e par votre annonce`,
      heroUrl,
      intro: `Bonjour ${esc(authorName)},<br/><br/>Une personne s'intéresse à votre bon plan <strong>« ${esc(dealTitle)} »</strong>. Vous pouvez lui répondre directement depuis la messagerie de l'équipe.`,
      contentHtml: `
        ${userChip(interestedName, args.interestedPhotoUrl, "Intéressé·e")}
        ${button(appLink("/messagerie"), "Ouvrir la messagerie")}
      `,
    });
    await resendSend(
      email,
      `${interestedName} est intéressé·e par « ${dealTitle} »`,
      html,
      FROM,
    );
  },
});
