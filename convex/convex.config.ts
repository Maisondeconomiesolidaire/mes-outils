import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    STRIPE_SECRET_KEY: v.optional(v.string()),
    BENNESPRO_STRIPE_SECRET_KEY: v.optional(v.string()),
    BENNESPRO_EMAIL_LOGO_ID: v.optional(v.string()),
    MAPBOX_ACCESS_TOKEN: v.optional(v.string()),
    STAFF_EMAILS: v.optional(v.string()),
    ADMIN_EMAILS: v.optional(v.string()),
    CLERK_SECRET_KEY: v.optional(v.string()),
    APP_URL: v.optional(v.string()),
    MESOUTILS_APP_URL: v.optional(v.string()),
    CONVEX_SITE_URL: v.optional(v.string()),
    EMAIL_LOGO_ID: v.optional(v.string()),
    OPENAI_API_KEY: v.optional(v.string()),
    OPENAI_REQUEST_ANALYSIS_MODEL: v.optional(v.string()),
  },
});
