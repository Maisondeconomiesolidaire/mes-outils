/**
 * Générateur de PDF minimal, sans dépendance.
 *
 * Le backend est partagé par les 7 apps de l'écosystème : y ajouter une
 * librairie PDF alourdirait chacun de leurs déploiements pour un besoin qui se
 * limite à poser du texte sur une page A4. On écrit donc directement le format,
 * qui pour ce cas se réduit à un catalogue, une page, deux polices standard et
 * un flux de contenu.
 *
 * Limites assumées : polices Helvetica uniquement (aucune police à embarquer),
 * encodage WinAnsi (couvre le français), pas d'images ni de tableaux.
 */

export type PdfLine = {
  text: string;
  /** Taille en points (défaut 11). */
  size?: number;
  bold?: boolean;
  /** Espace vertical ajouté AVANT la ligne, en points. */
  spaceBefore?: number;
  /** Aligné à droite de la zone de texte plutôt qu'à gauche. */
  alignRight?: boolean;
  /** Second texte posé sur la même ligne, calé à droite (montant d'un poste). */
  right?: string;
};

const PAGE_WIDTH = 595; // A4 à 72 dpi
const PAGE_HEIGHT = 842;
const MARGIN = 56;

/**
 * WinAnsi (CP1252) diffère de Latin-1 sur la plage 0x80-0x9F, où vivent les
 * caractères que produit un traitement de texte français : l'euro et les
 * apostrophes typographiques. Sans cette table, une facture affiche « ? »
 * à la place du symbole monétaire.
 */
const WINANSI_EXTRA: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  "ƒ": 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  "ˆ": 0x88,
  "‰": 0x89,
  "Š": 0x8a,
  "‹": 0x8b,
  "Œ": 0x8c,
  "Ž": 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  "š": 0x9a,
  "›": 0x9b,
  "œ": 0x9c,
  "ž": 0x9e,
  "Ÿ": 0x9f,
};

/** Un caractère → son octet WinAnsi, ou « ? » s'il n'est pas représentable. */
function winAnsiByte(char: string): number {
  const extra = WINANSI_EXTRA[char];
  if (extra !== undefined) return extra;
  const code = char.charCodeAt(0);
  return code <= 0xff ? code : 0x3f;
}

/** Échappe les caractères réservés d'une chaîne littérale PDF. */
function escapePdfText(value: string): string {
  return value.replace(/([\\()])/g, "\\$1").replace(/[\r\n]+/g, " ");
}

/**
 * Largeur approximative d'un texte, pour l'alignement à droite. Les métriques
 * exactes d'Helvetica demanderaient une table par caractère ; 0,5 em suffit
 * ici, où seul un montant en fin de ligne est concerné.
 */
function approximateWidth(text: string, size: number): number {
  return text.length * size * 0.5;
}

/** Convertit la chaîne du fichier PDF en octets WinAnsi. */
function toBytes(source: string): Uint8Array {
  const bytes = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i += 1) bytes[i] = winAnsiByte(source[i]);
  return bytes;
}

/**
 * Compose un PDF d'une page à partir de lignes de texte.
 * Renvoie les octets prêts à être stockés ou téléchargés.
 */
export function buildSimplePdf(lines: PdfLine[]): Uint8Array {
  const contentWidth = PAGE_WIDTH - MARGIN * 2;
  let cursorY = PAGE_HEIGHT - MARGIN;
  const parts: string[] = ["BT"];
  let currentFont = "";
  let currentSize = 0;

  for (const line of lines) {
    const size = line.size ?? 11;
    const font = line.bold ? "/F2" : "/F1";
    cursorY -= (line.spaceBefore ?? 0) + size * 1.35;
    if (font !== currentFont || size !== currentSize) {
      parts.push(`${font} ${size} Tf`);
      currentFont = font;
      currentSize = size;
    }
    const x = line.alignRight
      ? MARGIN + contentWidth - approximateWidth(line.text, size)
      : MARGIN;
    parts.push(`1 0 0 1 ${x.toFixed(2)} ${cursorY.toFixed(2)} Tm`);
    parts.push(`(${escapePdfText(line.text)}) Tj`);

    if (line.right) {
      const rightX = MARGIN + contentWidth - approximateWidth(line.right, size);
      parts.push(`1 0 0 1 ${rightX.toFixed(2)} ${cursorY.toFixed(2)} Tm`);
      parts.push(`(${escapePdfText(line.right)}) Tj`);
    }
  }
  parts.push("ET");
  const content = parts.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      "/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${toBytes(content).length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];

  // La table xref indexe les objets par position exacte en octets : elle doit
  // donc être construite au fur et à mesure de l'écriture du fichier.
  let file = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(toBytes(file).length);
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = toBytes(file).length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    file += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  file +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return toBytes(file);
}
