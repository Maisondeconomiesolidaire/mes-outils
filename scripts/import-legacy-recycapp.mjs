#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CLIENTS_CSV = "/Users/salem/Downloads/All Clients Export July 5 2026.csv";
const COLLECTES_CSV = "/Users/salem/Downloads/All Demands Debarras Export Jul 5 2026.csv";
const AEROGOMMAGES_CSV = "/Users/salem/Downloads/All Demand Requests Aerogommages Jul 5 2026.csv";

const IMAGE_COLUMNS = new Set(["Photo", "Photos", "Photos_Apres", "Photos_Avant"]);

function parseCsv(path) {
  const input = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [headers, ...body] = rows;
  return body
    .filter((values) => values.some((value) => value.trim()))
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    );
}

function clean(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : undefined;
}

function yesNo(value) {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (["oui", "yes", "true", "1"].includes(normalized)) return true;
  if (["non", "no", "false", "0"].includes(normalized)) return false;
  return undefined;
}

function numberValue(value) {
  const normalized = clean(value)?.replace(/\s/g, "").replace(",", ".");
  if (!normalized) return undefined;
  const n = Number(normalized.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function moneyValue(value) {
  const n = numberValue(value);
  return n === undefined ? undefined : Math.round(n * 100) / 100;
}

function dateValue(value) {
  const text = clean(value);
  if (!text) return undefined;
  const parsed = Date.parse(`${text} GMT+0200`);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rawFields(row) {
  return Object.entries(row)
    .filter(([key, value]) => !IMAGE_COLUMNS.has(key) && clean(value))
    .map(([key, value]) => ({ key, value: String(value).trim() }));
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function splitList(value) {
  return (clean(value) ?? "")
    .split(/\s*,\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function postalFromAddress(address) {
  return clean(address)?.match(/\b\d{5}\b/)?.[0];
}

function siteFromPostal(postalCode) {
  return clean(postalCode)?.startsWith("76") ? "76" : "60";
}

function parseTtc(details) {
  const match = clean(details)?.match(/TTC\s*:\s*([0-9\s,.]+)/i);
  return match ? moneyValue(match[1]) : undefined;
}

function comment(parts) {
  const lines = parts.filter(Boolean);
  return lines.length ? lines.join("\n\n") : undefined;
}

function customerFromRow(row, clientsById, fallback = {}) {
  const linked = clean(row.Client) ? clientsById.get(clean(row.Client)) : undefined;
  if (linked) return linked;
  return {
    firstName: clean(fallback.firstName) ?? "Client",
    lastName: clean(fallback.lastName) ?? "Importé",
    email: clean(fallback.email) ?? "",
    phone: clean(fallback.phone) ?? "",
    address: clean(fallback.address),
    postalCode: clean(fallback.postalCode),
    city: clean(fallback.city),
  };
}

const clientRows = parseCsv(CLIENTS_CSV);
const collecteRows = parseCsv(COLLECTES_CSV);
const aeroRows = parseCsv(AEROGOMMAGES_CSV);

const customers = clientRows.map((row) =>
  withoutUndefined({
    sourceId: clean(row["unique id"]),
    firstName: clean(row.Prenom) ?? "Client",
    lastName: clean(row.Nom) ?? "Importé",
    email: (clean(row.Email) ?? "").toLowerCase(),
    phone: clean(row.Telephone) ?? "",
    address: clean(row.Adresse_facturation),
    postalCode: clean(row["Code postal"]),
    city: clean(row.Ville),
    customerType: clean(row.Type),
    streetNumber: clean(row["Numero rue"]),
    street: clean(row.Rue),
    legacyCreatedAt: dateValue(row["Creation Date"]),
    legacyModifiedAt: dateValue(row["Modified Date"]),
    raw: rawFields(row),
  }),
);

const clientsById = new Map(
  customers.map((customer) => [
    customer.sourceId,
    {
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      postalCode: customer.postalCode,
      city: customer.city,
    },
  ]),
);

const collectes = collecteRows.map((row) => {
  const collectAddress = withoutUndefined({
    address: clean(row.Adresse_Logement),
    postalCode: postalFromAddress(row.Adresse_Logement),
    city: clean(row.Ville),
  });
  const customer = customerFromRow(row, clientsById, {
    address: clean(row.Adresse_Logement),
    postalCode: collectAddress.postalCode,
    city: clean(row.Ville),
  });
  const createdAt = dateValue(row["Creation Date"]) ?? Date.now();
  const updatedAt = dateValue(row["Modified Date"]) ?? createdAt;
  const collecteType = ["C1", "C2", "C3"].includes(clean(row.Type_Collecte) ?? "")
    ? clean(row.Type_Collecte)
    : "indefini";
  return withoutUndefined({
    sourceId: clean(row["unique id"]),
    reference: clean(row.REF) ?? clean(row["unique id"]),
    customer,
    createdAt,
    updatedAt,
    complete: true,
    outcome: yesNo(row.Collectable) === false ? "perdue" : "open",
    site: siteFromPostal(customer.postalCode ?? collectAddress.postalCode),
    visitNeeded: yesNo(row.Visite),
    collecteType,
    comment: comment([
      clean(row.Commentaire_Adresse) && `Commentaire adresse : ${clean(row.Commentaire_Adresse)}`,
      clean(row.Creator) && `Créateur Bubble : ${clean(row.Creator)}`,
    ]),
    quoteDetails: clean(row.Commentaire_Interne),
    quoteAmount: parseTtc(row.Commentaire_Interne),
    details: withoutUndefined({
      dismountable: yesNo(row.Demontage),
      reusableGoodCondition: yesNo(row.Bon_etat_Reemployable),
      sorted: yesNo(row.Trié),
      noWaste: yesNo(row.Deposable_RDC),
      objectCategories: splitList(row.Objets).length ? splitList(row.Objets) : undefined,
      housingType: clean(row.Type_Logement),
      floors: numberValue(row.Etage),
      dedicatedParking: yesNo(row.Parking_Proximite),
      parkingDistance: numberValue(row.Distance_Parking),
      parkingNearby: yesNo(row.Parking_Proximite),
      collectAddress,
    }),
    raw: {
      sourceId: clean(row["unique id"]),
      fields: rawFields(row),
    },
  });
});

const aeroGroups = new Map();
for (const row of aeroRows) {
  const reference = clean(row.REF) ?? clean(row["unique id"]);
  if (!aeroGroups.has(reference)) aeroGroups.set(reference, []);
  aeroGroups.get(reference).push(row);
}

const aerogommages = [...aeroGroups.entries()].map(([reference, rows]) => {
  const first = rows[0];
  const customer = customerFromRow(first, clientsById);
  const createdAt = Math.min(...rows.map((row) => dateValue(row["Creation Date"]) ?? Date.now()));
  const updatedAt = Math.max(...rows.map((row) => dateValue(row["Modified Date"]) ?? createdAt));
  const comments = [...new Set(rows.map((row) => clean(row["Commentaire / Remarque"])).filter(Boolean))];
  const estimated = rows.map((row) => numberValue(row.Temps_estime)).find((value) => value !== undefined);
  const actual = rows.map((row) => numberValue(row.Temps_Passe_Reel)).find((value) => value !== undefined);
  const pickupAtHome = rows.some((row) => yesNo(row.Retrait));
  const deliveryAtHome = rows.some((row) => yesNo(row.Livraison));
  const address = withoutUndefined({
    address: customer.address,
    postalCode: customer.postalCode,
    city: customer.city,
  });
  return withoutUndefined({
    reference,
    sourceIds: rows.map((row) => clean(row["unique id"])).filter(Boolean),
    customer,
    createdAt,
    updatedAt,
    complete: rows.every((row) => yesNo(row.Complete) !== false),
    site: siteFromPostal(customer.postalCode),
    comment: comment(comments),
    quoteAmount: rows.map((row) => moneyValue(row.Montant)).find((value) => value !== undefined),
    estimatedHours: estimated,
    actualHours: actual,
    aerogommageOptions:
      pickupAtHome || deliveryAtHome
        ? withoutUndefined({
            pickupAtHome,
            deliveryAtHome,
            pickupAddress: pickupAtHome ? address : undefined,
            deliveryAddress: deliveryAtHome ? address : undefined,
          })
        : undefined,
    items: rows.map((row) =>
      withoutUndefined({
        sourceId: clean(row["unique id"]),
        objectType: clean(row.Type_objet),
        height: numberValue(row["Hauteur (cm)"]),
        width: numberValue(row["Largeur (cm)"]),
        depth: numberValue(row.Profondeur),
        quantity: numberValue(row.Quantite),
        woodType: clean(row.Nature_Bois),
        stripping: clean(row.Decapage),
        coating: clean(row.Revetement),
        delivery: yesNo(row.Livraison),
        retrieval: yesNo(row.Retrait),
        comment: clean(row["Commentaire / Remarque"]),
        raw: {
          sourceId: clean(row["unique id"]),
          fields: rawFields(row),
        },
      }),
    ),
  });
});

const payload = { customers, collectes, aerogommages };
console.log(
  `Prepared ${customers.length} customers, ${collectes.length} collectes, ${aerogommages.length} aerogommage requests (${aeroRows.length} items).`,
);

if (process.argv.includes("--dry-run")) {
  console.log("Dry run only; no Convex mutation called.");
  process.exit(0);
}

const args = JSON.stringify(payload);
const commandArgs = ["convex", "run", "--prod", "importLegacy:importRecycappLegacy", args];
execFileSync("npx", commandArgs, { cwd: "/Users/salem/mesoutils", stdio: "inherit" });
