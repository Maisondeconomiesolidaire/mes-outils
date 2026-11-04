import { afterEach, expect, test, vi } from "vitest";
import { generateContract } from "./rh";

const message = "Le modèle de contrat CDD n’a pas encore été créé. La génération du contrat est momentanément indisponible.";
const args = {
  employeeId: "employee", numero_contrat: "1", type_contrat: "CDD",
  type_document: "contrat_initial", date_fin_contrat: "2026-12-31",
  duree_contrat: "2 mois", date_debut_contrat: "2026-11-01", poste: "Agent",
  remuneration_brute_horaire: "12.31", duree_mensuel_travail: "100",
  salaire_brut_mensuel: "1231", PREMIER_CONTRAT: "2026-11-01",
};
function context() {
  return {
    runQuery: vi.fn().mockResolvedValueOnce("user").mockResolvedValueOnce({
      firstName: "Salarié", lastName: "Test", fullName: "Salarié Test", structure: "Recyclerie 60", gender: "Monsieur",
      address: "Adresse de test", socialSecurityNumber: "test",
    }),
    runMutation: vi.fn().mockResolvedValue(null),
  };
}
// Invoke only the handler with mocked services: no production calls or writes.
const handler = (generateContract as unknown as {
  _handler: (ctx: ReturnType<typeof context>, input: typeof args) => Promise<unknown>;
})._handler;
afterEach(() => vi.unstubAllGlobals());

test("CDD: HTTP webhook failure shows the template message and records the failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Failure", { status: 500 })));
  const ctx = context();
  await expect(handler(ctx, args)).rejects.toMatchObject({ data: message });
  expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ webhookStatus: "error" }));
});

test("CDD: network failure shows the template message", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
  await expect(handler(context(), args)).rejects.toMatchObject({ data: message });
});

test("CDI: webhook failure keeps its existing error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Failure", { status: 500 })));
  await expect(handler(context(), { ...args, type_contrat: "CDI" })).rejects.toThrow("Webhook Make en échec (500).");
});

test("CDD: successful webhook remains successful and receives CDD", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("OK"));
  vi.stubGlobal("fetch", fetchMock);
  await expect(handler(context(), args)).resolves.toMatchObject({ ok: true });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).type_contrat).toBe("CDD");
});
