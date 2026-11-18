"use node";
/**
 * QR code d'une navette Meslogistic finalisée : PNG généré ici (runtime Node,
 * paquet `qrcode`), rangé dans le stockage Convex puis envoyé au conducteur.
 * Il ouvre la page de ramassage /scan/<id> de Meslogistic.
 */
import QRCode from "qrcode";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const sendShuttleQr = internalAction({
  args: { shuttleId: v.id("mlShuttles"), email: v.string(), name: v.string() },
  handler: async (ctx, { shuttleId, email, name }) => {
    const data = await ctx.runQuery(internal.meslogisticShuttles.qrEmailData, { shuttleId });
    if (!data) return;
    const base = (process.env.MESLOGISTIC_APP_URL ?? "https://meslogistic.groupemes.fr").replace(/\/$/, "");
    const url = `${base}/scan/${shuttleId}`;
    const png = await QRCode.toBuffer(url, { type: "png", width: 480, margin: 2, errorCorrectionLevel: "M" });
    const qrStorageId = await ctx.storage.store(new Blob([new Uint8Array(png)], { type: "image/png" }));
    await ctx.runMutation(internal.meslogisticShuttles.saveShuttleQr, { shuttleId, qrStorageId });
    await ctx.scheduler.runAfter(0, internal.mesoutilsEmails.sendShuttleQrEmail, {
      email, name, url, qrStorageId, qrBase64: png.toString("base64"), ...data,
    });
  },
});
