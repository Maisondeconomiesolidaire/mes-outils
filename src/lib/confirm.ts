const DEFAULT_DELETE_MESSAGE =
  "Êtes-vous sûr(e) ? Cette action supprimera définitivement cet élément.";

export function confirmPermanentDelete(message = DEFAULT_DELETE_MESSAGE) {
  return window.confirm(message);
}
