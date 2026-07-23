import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronDown, ExternalLink, FileText, Loader2, Search, Sparkles, UserPlus, Users, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SectionHeader } from "../components/SectionHeader";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { DatePicker } from "../components/ui/DatePicker";
import { Field, Input, Select } from "../components/ui/Field";
import { FullSpinner } from "../components/ui/Spinner";
import { UnderlineTabs } from "../components/ui/UnderlineTabs";
import { cn } from "../lib/cn";

type Employee = {
  _id: Id<"hrEmployees">;
  firstName: string;
  lastName: string;
  fullName: string;
  gender: "Monsieur" | "Madame";
  address: string;
  structure:
    | "Pays de Bray Services 60"
    | "Pays de Bray Services 76"
    | "Recyclerie 60"
    | "Recyclerie 76"
    | "Les Sens du Bray"
    | "Maison d'Economie Solidaire"
    | "Pays de Bray Emploi";
  socialSecurityNumber: string;
  firstContractDate?: string;
  active: boolean;
  _creationTime: number;
};

type ContractHistoryItem = {
  _id: Id<"hrContracts">;
  employeeId: Id<"hrEmployees">;
  employeeName: string;
  payload: {
    structure: string;
    numero_contrat?: string;
    type_contrat: "CDDI" | "CDI-Inclusion" | "CDD-Pec" | "CDI";
    type_document: "contrat_initial" | "avenant_prolong";
    poste: string;
    date_debut_contrat: string;
    date_fin_contrat: string;
  };
};

const STRUCTURES = [
  "Pays de Bray Services 60",
  "Pays de Bray Services 76",
  "Recyclerie 60",
  "Recyclerie 76",
  "Les Sens du Bray",
  "Maison d'Economie Solidaire",
  "Pays de Bray Emploi",
] as const;

const GENDERS = [
  { value: "Monsieur", label: "Monsieur" },
  { value: "Madame", label: "Madame" },
] as const;

const CONTRACT_TYPES = [
  "CDDI",
  "CDI-Inclusion",
  "CDD-Pec",
  "CDI",
] as const;

const DOCUMENT_TYPES = [
  { value: "contrat_initial", label: "Contrat initial" },
  { value: "avenant_prolong", label: "Avenant prolongation" },
] as const;

const emptyEmployeeForm = {
  employeeId: null as Id<"hrEmployees"> | null,
  firstName: "",
  lastName: "",
  socialSecurityNumber: "",
  gender: "Monsieur" as "Monsieur" | "Madame",
  address: "",
  structure: "Recyclerie 60" as Employee["structure"],
  firstContractDate: "",
};

const emptyContractForm = {
  employeeId: "" as Id<"hrEmployees"> | "",
  numero_contrat: "",
  type_contrat: "CDDI" as (typeof CONTRACT_TYPES)[number],
  type_document: "contrat_initial" as
    | "contrat_initial"
    | "avenant_prolong",
  date_fin_contrat: "",
  duree_contrat: "",
  date_debut_contrat: "",
  poste: "",
  duree_periode_essai: "",
  date_debut_periode_essai: "",
  date_fin_periode_essai: "",
  remuneration_brute_horaire: "12.31",
  duree_mensuel_travail: "",
  salaire_brut_mensuel: "",
  PREMIER_CONTRAT: "",
};

function parseFrenchNumber(value: string) {
  const number = Number(value.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function RessourcesHumaines() {
  const employees = useQuery(api.rh.listEmployees) as Employee[] | undefined;
  const contracts = useQuery(api.rh.listContracts) as ContractHistoryItem[] | undefined;
  const upsertEmployee = useMutation(api.rh.upsertEmployee);
  const generateContract = useAction(api.rh.generateContract);

  const [tab, setTab] = useState<"employees" | "contracts">("employees");
  const [employeeSection, setEmployeeSection] = useState<"new" | "list">("list");
  const [contractSection, setContractSection] = useState<"new" | "history">("new");
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm);
  const [contractForm, setContractForm] = useState(emptyContractForm);
  const [employeeError, setEmployeeError] = useState<string | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);
  const [employeeMessage, setEmployeeMessage] = useState<string | null>(null);
  const [contractMessage, setContractMessage] = useState<string | null>(null);
  const [contractDocumentUrl, setContractDocumentUrl] = useState<string | null>(null);
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [sendingContract, setSendingContract] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const employeeFormRef = useRef<HTMLElement>(null);

  const selectedContractEmployee = useMemo(
    () =>
      employees?.find((employee) => employee._id === contractForm.employeeId) ?? null,
    [employees, contractForm.employeeId],
  );
  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLocaleLowerCase("fr");
    if (!query) return employees ?? [];
    return (employees ?? []).filter((employee) =>
      employee.fullName.toLocaleLowerCase("fr").includes(query),
    );
  }, [employeeSearch, employees]);

  useEffect(() => {
    if (!employees?.length) return;
    if (!contractForm.employeeId) {
      const first = employees[0];
      setContractForm((current) => ({
        ...current,
        employeeId: first._id,
        PREMIER_CONTRAT: current.PREMIER_CONTRAT || first.firstContractDate || "",
      }));
    }
  }, [employees, contractForm.employeeId]);

  useEffect(() => {
    if (!selectedContractEmployee) return;
    setContractForm((current) => ({
      ...current,
      PREMIER_CONTRAT: current.PREMIER_CONTRAT || selectedContractEmployee.firstContractDate || "",
    }));
  }, [selectedContractEmployee]);

  if (employees === undefined || contracts === undefined) {
    return <FullSpinner label="Chargement des ressources humaines..." />;
  }

  async function handleEmployeeSubmit() {
    setSavingEmployee(true);
    setEmployeeError(null);
    setEmployeeMessage(null);
    try {
      await upsertEmployee({
        employeeId: employeeForm.employeeId ?? undefined,
        firstName: employeeForm.firstName,
        lastName: employeeForm.lastName,
        socialSecurityNumber: employeeForm.socialSecurityNumber,
        gender: employeeForm.gender,
        address: employeeForm.address,
        structure: employeeForm.structure,
        firstContractDate: employeeForm.firstContractDate || undefined,
        active: true,
      });
      setEmployeeMessage(
        employeeForm.employeeId ? "Fiche salarié mise à jour." : "Salarié ajouté.",
      );
      setEmployeeForm(emptyEmployeeForm);
    } catch (error) {
      setEmployeeError(
        error instanceof Error ? error.message : "Enregistrement impossible.",
      );
    } finally {
      setSavingEmployee(false);
    }
  }

  function loadEmployee(employee: Employee) {
    setEmployeeForm({
      employeeId: employee._id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      socialSecurityNumber: employee.socialSecurityNumber,
      gender: employee.gender,
      address: employee.address,
      structure: employee.structure,
      firstContractDate: employee.firstContractDate ?? "",
    });
    setEmployeeMessage(null);
    setEmployeeError(null);
    setTab("employees");
    setEmployeeSection("new");
    window.requestAnimationFrame(() =>
      employeeFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  function updateContractCompensation(
    updates: Partial<Pick<typeof emptyContractForm, "remuneration_brute_horaire" | "duree_mensuel_travail">>,
  ) {
    setContractForm((current) => {
      const next = { ...current, ...updates };
      const hourlyRate = parseFrenchNumber(next.remuneration_brute_horaire);
      const monthlyHours = parseFrenchNumber(next.duree_mensuel_travail);
      return {
        ...next,
        salaire_brut_mensuel:
          hourlyRate !== null && monthlyHours !== null
            ? (hourlyRate * monthlyHours).toFixed(2)
            : "",
      };
    });
  }

  async function handleContractSubmit() {
    if (!contractForm.employeeId) {
      setContractError("Sélectionnez un salarié.");
      return;
    }
    setSendingContract(true);
    setContractError(null);
    setContractMessage(null);
    setContractDocumentUrl(null);
    try {
      const result = await generateContract({
        employeeId: contractForm.employeeId,
        numero_contrat: contractForm.numero_contrat,
        type_contrat: contractForm.type_contrat,
        type_document: contractForm.type_document,
        date_fin_contrat: contractForm.date_fin_contrat,
        duree_contrat: contractForm.duree_contrat,
        date_debut_contrat: contractForm.date_debut_contrat,
        poste: contractForm.poste,
        duree_periode_essai: contractForm.duree_periode_essai || undefined,
        date_debut_periode_essai: contractForm.date_debut_periode_essai || undefined,
        date_fin_periode_essai: contractForm.date_fin_periode_essai || undefined,
        remuneration_brute_horaire: contractForm.remuneration_brute_horaire,
        duree_mensuel_travail: contractForm.duree_mensuel_travail,
        salaire_brut_mensuel: contractForm.salaire_brut_mensuel,
        PREMIER_CONTRAT:
          contractForm.PREMIER_CONTRAT ||
          selectedContractEmployee?.firstContractDate ||
          "",
      });
      setContractDocumentUrl(result.contractUrl ?? null);
      if (!result.contractUrl) {
        setContractMessage("Contrat généré, mais le lien SharePoint n'a pas été reçu.");
      }
      setContractForm((current) => ({
        ...emptyContractForm,
        employeeId: current.employeeId,
        PREMIER_CONTRAT:
          selectedContractEmployee?.firstContractDate ||
          current.PREMIER_CONTRAT ||
          "",
      }));
    } catch (error) {
      setContractError(
        error instanceof Error ? error.message : "Envoi du contrat impossible.",
      );
    } finally {
      setSendingContract(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Ressources Humaines"
        subtitle="Gérez les salariés et leurs contrats."
      />

      <UnderlineTabs
        value={tab}
        onChange={setTab}
        items={[
          { key: "employees", label: "Salariés", icon: Users },
          { key: "contracts", label: "Contrats", icon: FileText },
        ]}
      />

      {tab === "employees" ? (
        <div className="space-y-5">
          <SegmentedTabs
            value={employeeSection}
            onChange={setEmployeeSection}
            items={[
              { key: "new", label: "Nouveau salarié" },
              { key: "list", label: "Salariés" },
            ]}
          />
          <section className={cn("premium-panel rounded-2xl p-5", employeeSection !== "list" && "hidden")}>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--muted-foreground)]" />
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                Salariés
              </h2>
            </div>

            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                className="pl-9"
                value={employeeSearch}
                onChange={(event) => setEmployeeSearch(event.target.value)}
                placeholder="Rechercher un salarié…"
              />
            </div>

            <div className="mt-4 grid gap-3">
              {employees.length === 0 ? (
                <EmptyState
                  icon={<Users className="h-8 w-8" />}
                  title="Aucun salarié"
                  description="Ajoutez votre premier salarié pour démarrer la gestion RH."
                />
              ) : filteredEmployees.length === 0 ? (
                <EmptyState
                  icon={<Search className="h-8 w-8" />}
                  title="Aucun salarié trouvé"
                  description="Essayez avec un autre nom."
                />
              ) : (
                filteredEmployees.map((employee) => (
                  <button
                    key={employee._id}
                    type="button"
                    onClick={() => loadEmployee(employee)}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-left transition hover:border-brand-500/50 hover:bg-[var(--accent)]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-base font-semibold text-[var(--foreground)]">
                          {employee.fullName}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                          {employee.structure}
                        </p>
                      </div>
                      <span className="rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300">
                        {employee.gender}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-1 text-sm text-[var(--muted-foreground)]">
                      <p>{employee.address || "Adresse à compléter"}</p>
                      <p>
                        Premier contrat : {employee.firstContractDate || "Non renseigné"}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section ref={employeeFormRef} className={cn("premium-panel rounded-2xl p-5", employeeSection !== "new" && "hidden")}>
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-[var(--muted-foreground)]" />
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                {employeeForm.employeeId ? "Modifier un salarié" : "Ajouter un salarié"}
              </h2>
            </div>

            <div className="mt-4 grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nom" required>
                  <Input
                    value={employeeForm.lastName}
                    onChange={(event) =>
                      setEmployeeForm((current) => ({
                        ...current,
                        lastName: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Prénom" required>
                  <Input
                    value={employeeForm.firstName}
                    onChange={(event) =>
                      setEmployeeForm((current) => ({
                        ...current,
                        firstName: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Numéro de sécurité sociale" required>
                  <Input
                    value={employeeForm.socialSecurityNumber}
                    onChange={(event) =>
                      setEmployeeForm((current) => ({
                        ...current,
                        socialSecurityNumber: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Genre" required>
                  <Select
                    value={employeeForm.gender}
                    onChange={(event) =>
                      setEmployeeForm((current) => ({
                        ...current,
                        gender: event.target.value as "Monsieur" | "Madame",
                      }))
                    }
                  >
                    {GENDERS.map((gender) => (
                      <option key={gender.value} value={gender.value}>
                        {gender.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <AddressField
                value={employeeForm.address}
                onChange={(value) =>
                  setEmployeeForm((current) => ({ ...current, address: value }))
                }
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Structure" required>
                  <Select
                    value={employeeForm.structure}
                    onChange={(event) =>
                      setEmployeeForm((current) => ({
                        ...current,
                        structure: event.target.value as Employee["structure"],
                      }))
                    }
                  >
                    {STRUCTURES.map((structure) => (
                      <option key={structure} value={structure}>
                        {structure}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Date du premier contrat"
                  hint="Valeur reprise par défaut lors de la génération du contrat."
                >
                  <DatePicker
                    value={employeeForm.firstContractDate}
                    onChange={(value) =>
                      setEmployeeForm((current) => ({
                        ...current,
                        firstContractDate: value,
                      }))
                    }
                  />
                </Field>
              </div>

              {employeeError ? (
                <MessageBox tone="error">{employeeError}</MessageBox>
              ) : null}
              {employeeMessage ? (
                <MessageBox tone="success">{employeeMessage}</MessageBox>
              ) : null}

              <div className="flex flex-wrap justify-between gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEmployeeForm(emptyEmployeeForm);
                    setEmployeeError(null);
                    setEmployeeMessage(null);
                  }}
                >
                  Réinitialiser
                </Button>
                <Button
                  onClick={handleEmployeeSubmit}
                  disabled={
                    savingEmployee ||
                    !employeeForm.firstName.trim() ||
                    !employeeForm.lastName.trim() ||
                    !employeeForm.socialSecurityNumber.trim() ||
                    !employeeForm.address.trim()
                  }
                >
                  {savingEmployee
                    ? "Enregistrement..."
                    : employeeForm.employeeId
                      ? "Enregistrer les modifications"
                      : "Ajouter le salarié"}
                </Button>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="space-y-5">
          <SegmentedTabs
            value={contractSection}
            onChange={setContractSection}
            items={[
              { key: "new", label: "Nouveau contrat" },
              { key: "history", label: "Historique" },
            ]}
          />
          <section className={cn("premium-panel rounded-2xl p-5", contractSection !== "new" && "hidden")}>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--muted-foreground)]" />
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                Génération d'un contrat
              </h2>
            </div>

            {employees.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon={<FileText className="h-8 w-8" />}
                  title="Aucun salarié disponible"
                  description="Ajoutez ou importez d'abord les salariés avant de générer un contrat."
                />
              </div>
            ) : (
              <div className="mt-4 grid gap-4">
                <Field label="Salarié" required>
                  <EmployeeCombobox
                    employees={employees}
                    value={contractForm.employeeId}
                    onChange={(employee) =>
                      setContractForm((current) => ({
                        ...current,
                        employeeId: employee._id,
                        PREMIER_CONTRAT: employee.firstContractDate || "",
                      }))
                    }
                  />
                </Field>

                {selectedContractEmployee ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--accent)]/50 p-4 text-sm">
                    <p className="font-semibold text-[var(--foreground)]">
                      {selectedContractEmployee.fullName}
                    </p>
                    <p className="mt-1 text-[var(--muted-foreground)]">
                      {selectedContractEmployee.address}
                    </p>
                    <p className="mt-1 text-[var(--muted-foreground)]">
                      {selectedContractEmployee.structure}
                    </p>
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Numéro de contrat" required>
                    <Input
                      value={contractForm.numero_contrat}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          numero_contrat: event.target.value,
                        }))
                      }
                      placeholder="Exemple : 2"
                    />
                  </Field>
                  <Field label="Contrat" required>
                    <Select
                      value={contractForm.type_contrat}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          type_contrat: event.target.value as (typeof CONTRACT_TYPES)[number],
                        }))
                      }
                    >
                      {CONTRACT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Type de contrat" required>
                    <Select
                      value={contractForm.type_document}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          type_document: event.target.value as "contrat_initial" | "avenant_prolong",
                        }))
                      }
                    >
                      {DOCUMENT_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Date de début du contrat" required>
                    <DatePicker
                      value={contractForm.date_debut_contrat}
                      onChange={(value) =>
                        setContractForm((current) => ({
                          ...current,
                          date_debut_contrat: value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Date de fin du contrat" required>
                    <DatePicker
                      value={contractForm.date_fin_contrat}
                      onChange={(value) =>
                        setContractForm((current) => ({
                          ...current,
                          date_fin_contrat: value,
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Durée du contrat" required>
                    <Input
                      value={contractForm.duree_contrat}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          duree_contrat: event.target.value,
                        }))
                      }
                      placeholder="Ex. 4 mois"
                    />
                  </Field>
                  <Field label="Poste" required>
                    <Input
                      value={contractForm.poste}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          poste: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Durée période d'essai">
                    <Input
                      value={contractForm.duree_periode_essai}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          duree_periode_essai: event.target.value,
                        }))
                      }
                      placeholder="Ex. 15 jours"
                    />
                  </Field>
                  <Field label="Début période d'essai">
                    <DatePicker
                      value={contractForm.date_debut_periode_essai}
                      onChange={(value) =>
                        setContractForm((current) => ({
                          ...current,
                          date_debut_periode_essai: value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Fin période d'essai">
                    <DatePicker
                      value={contractForm.date_fin_periode_essai}
                      onChange={(value) =>
                        setContractForm((current) => ({
                          ...current,
                          date_fin_periode_essai: value,
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Rémunération brute horaire" required>
                    <Input
                      value={contractForm.remuneration_brute_horaire}
                      onChange={(event) => updateContractCompensation({ remuneration_brute_horaire: event.target.value })}
                      inputMode="decimal"
                      placeholder="12.31"
                    />
                  </Field>
                  <Field label="Durée mensuelle de travail" required>
                    <Input
                      value={contractForm.duree_mensuel_travail}
                      onChange={(event) => updateContractCompensation({ duree_mensuel_travail: event.target.value })}
                      inputMode="decimal"
                      placeholder="Ex. 151.67 h"
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Salaire brut mensuel" required>
                    <Input
                      value={contractForm.salaire_brut_mensuel}
                      readOnly
                      className="cursor-not-allowed bg-[var(--accent)]"
                      placeholder="Calculé automatiquement"
                    />
                  </Field>
                  <Field label="PREMIER_CONTRAT" required>
                    <DatePicker
                      value={contractForm.PREMIER_CONTRAT}
                      onChange={(value) =>
                        setContractForm((current) => ({
                          ...current,
                          PREMIER_CONTRAT: value,
                        }))
                      }
                    />
                  </Field>
                </div>

                {contractError ? (
                  <MessageBox tone="error">{contractError}</MessageBox>
                ) : null}
                {contractMessage ? (
                  <MessageBox tone="success">{contractMessage}</MessageBox>
                ) : null}

                <div className="flex justify-end">
                  <Button
                    onClick={handleContractSubmit}
                    disabled={
                      sendingContract ||
                      !contractForm.employeeId ||
                      !contractForm.numero_contrat.trim() ||
                      !contractForm.date_debut_contrat ||
                      !contractForm.date_fin_contrat ||
                      !contractForm.duree_contrat.trim() ||
                      !contractForm.poste.trim() ||
                      !contractForm.remuneration_brute_horaire.trim() ||
                      !contractForm.duree_mensuel_travail.trim() ||
                      !contractForm.salaire_brut_mensuel.trim() ||
                      !(
                        contractForm.PREMIER_CONTRAT ||
                        selectedContractEmployee?.firstContractDate
                      )
                    }
                  >
                    {sendingContract
                      ? "Envoi au scénario Make..."
                      : "Générer le contrat"}
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className={cn("premium-panel rounded-2xl p-5", contractSection !== "history" && "hidden")}>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-[var(--muted-foreground)]" />
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                Historique récent
              </h2>
            </div>

            <div className="mt-4 grid gap-3">
              {contracts.length === 0 ? (
                <EmptyState
                  icon={<FileText className="h-8 w-8" />}
                  title="Aucun contrat généré"
                  description="Les contrats générés apparaîtront ici."
                />
              ) : (
                contracts.map((contract) => (
                  <article
                    key={contract._id}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--foreground)]">
                          {contract.employeeName}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                          {contract.payload.poste}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-1 text-sm text-[var(--muted-foreground)]">
                      <p>
                        {contract.payload.type_contrat} ·{" "}
                        {contract.payload.type_document === "contrat_initial"
                          ? "Contrat initial"
                          : "Avenant prolongation"}
                      </p>
                      {contract.payload.numero_contrat ? (
                        <p>Numéro de contrat : {contract.payload.numero_contrat}</p>
                      ) : null}
                      <p>
                        Contrat : {contract.payload.date_debut_contrat} →{" "}
                        {contract.payload.date_fin_contrat}
                      </p>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      )}
      {sendingContract ? <ContractGenerationOverlay /> : null}
      {contractDocumentUrl ? (
        <ContractReadyOverlay
          url={contractDocumentUrl}
          onClose={() => setContractDocumentUrl(null)}
        />
      ) : null}
    </div>
  );
}

function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ key: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex max-w-full gap-1 overflow-x-auto overflow-y-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold transition",
              active
                ? "bg-brand-500 text-white"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function ContractGenerationOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/35 p-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl border border-white/60 bg-[var(--card)] p-8 text-center shadow-[var(--shadow-strong)]">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600">
          <Loader2 className="h-7 w-7 animate-spin" />
        </span>
        <h2 className="mt-5 text-xl font-bold text-[var(--foreground)]">Génération du contrat</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
          Le document est en cours de création et d’enregistrement dans SharePoint.
        </p>
      </div>
    </div>
  );
}

function ContractReadyOverlay({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/35 p-5 backdrop-blur-sm">
      <div className="relative w-full max-w-sm rounded-3xl border border-white/60 bg-[var(--card)] p-8 text-center shadow-[var(--shadow-strong)]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="absolute right-4 top-4 rounded-full p-2 text-[var(--muted-foreground)] transition hover:bg-[var(--accent)]"
        >
          <X className="h-4 w-4" />
        </button>
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
          <CheckCircle2 className="h-7 w-7" />
        </span>
        <h2 className="mt-5 text-xl font-bold text-[var(--foreground)]">Contrat généré</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
          Le contrat est bien enregistré dans SharePoint.
        </p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-600"
        >
          Cliquez pour le voir
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}

function EmployeeCombobox({
  employees,
  value,
  onChange,
}: {
  employees: Employee[];
  value: Id<"hrEmployees"> | "";
  onChange: (employee: Employee) => void;
}) {
  const selectedEmployee = employees.find((employee) => employee._id === value) ?? null;
  const [query, setQuery] = useState(selectedEmployee?.fullName ?? "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) setQuery(selectedEmployee?.fullName ?? "");
  }, [open, selectedEmployee]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("fr");
    if (!normalizedQuery) return employees;
    return employees.filter((employee) =>
      [employee.fullName, employee.structure, employee.address]
        .some((value) => value.toLocaleLowerCase("fr").includes(normalizedQuery)),
    );
  }, [employees, query]);

  function closeLater() {
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }

  function choose(employee: Employee) {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    onChange(employee);
    setQuery(employee.fullName);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
      <Input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="employee-search-results"
        className="pl-9 pr-10"
        value={query}
        onFocus={() => {
          if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
          setQuery((current) => current === selectedEmployee?.fullName ? "" : current);
          setOpen(true);
        }}
        onBlur={closeLater}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        placeholder="Rechercher un salarié…"
      />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
      {open ? (
        <div
          id="employee-search-results"
          role="listbox"
          className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-[var(--shadow-strong)]"
        >
          {results.length > 0 ? results.map((employee) => {
            const isSelected = employee._id === value;
            return (
              <button
                key={employee._id}
                role="option"
                aria-selected={isSelected}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(employee)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-[var(--accent)]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-sm font-bold text-brand-700 dark:text-brand-300">
                  {employee.firstName.slice(0, 1)}{employee.lastName.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--foreground)]">{employee.fullName}</span>
                  <span className="block truncate text-xs text-[var(--muted-foreground)]">{employee.structure} · {employee.address}</span>
                </span>
                {isSelected ? <Check className="h-4 w-4 shrink-0 text-brand-600" /> : null}
              </button>
            );
          }) : (
            <p className="px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">Aucun salarié ne correspond à cette recherche.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AddressField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const searchAddresses = useAction(api.rh.searchAddresses);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const trimmed = value.trim();
    if (!isFocused || trimmed.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchAddresses({ query: trimmed })
        .then((results) => setSuggestions(results as string[]))
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false));
    }, 250);

    return () => window.clearTimeout(timer);
  }, [isFocused, value, searchAddresses]);

  return (
    <Field
      label="Adresse postale"
      required
      hint="Saisie libre avec suggestions d'adresses géographiques si disponibles."
    >
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            className="pl-9"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => window.setTimeout(() => setIsFocused(false), 120)}
            placeholder="Ex. 14 rue du 9 juin 60220 Formerie"
          />
        </div>
        {loading ? (
          <p className="text-xs text-[var(--muted-foreground)]">Recherche d'adresses…</p>
        ) : null}
        {suggestions.length > 0 ? (
          <div className="grid gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(suggestion);
                  setSuggestions([]);
                }}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-left text-sm transition hover:border-brand-500/50 hover:bg-[var(--accent)]"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Field>
  );
}

function MessageBox({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl px-3 py-2 text-sm",
        tone === "success"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "bg-red-500/10 text-red-700 dark:text-red-300",
      )}
    >
      {children}
    </div>
  );
}
