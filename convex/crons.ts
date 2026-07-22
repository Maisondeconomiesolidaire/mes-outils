import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Rappels contrôle technique / pollution des véhicules (J-30, J-15, J-5, J-1),
// tous les jours à 05:00 UTC (06h/07h à Paris selon la saison).
crons.daily(
  "rappels controles vehicules",
  { hourUTC: 5, minuteUTC: 0 },
  internal.vehicleControlReminders.sendControlReminders,
);

crons.hourly(
  "emails retour reservations vehicules",
  { minuteUTC: 10 },
  internal.reservations.requestVehicleFeedbackForPastReservations,
);

crons.hourly(
  "emails retour reservations salles",
  { minuteUTC: 25 },
  internal.reservations.requestRoomFeedbackForPastReservations,
);

// Alerte Klyd : article sur Vinted depuis 3 semaines et toujours non gagné.
crons.daily(
  "alerte klyd vinted 3 semaines",
  { hourUTC: 6, minuteUTC: 0 },
  internal.klyde.sendVintedAlerts,
);

export default crons;
