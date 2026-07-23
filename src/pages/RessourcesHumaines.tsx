import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { FileText, Search, Sparkles, UserPlus, Users } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SectionHeader } from "../components/SectionHeader";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select } from "../components/ui/Field";
import { FullSpinner } from "../components/ui/Spinner";
import { UnderlineTabs } from "../components/ui/UnderlineTabs";
import { cn } from "../lib/cn";

type Employee = {
  _id: Id<"hrEmployees">;
  firstName: string;
  lastName: string;
  fullName: string;
  gender: "homme" | "femme";
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
  webhookStatus: "pending" | "success" | "error";
  webhookResponseCode?: number;
  requestedAt: number;
  requestedBy: string;
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
  { value: "homme", label: "Homme" },
  { value: "femme", label: "Femme" },
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
  gender: "homme" as "homme" | "femme",
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
  remuneration_brute_horaire: "",
  duree_mensuel_travail: "",
  salaire_brut_mensuel: "",
  PREMIER_CONTRAT: "",
};

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDateTime(value: number) {
  return dateTimeFormatter.format(new Date(value));
}

function structureWebhookLabel(
  structure: Employee["structure"] | undefined,
) {
  switch (structure) {
    case "Recyclerie 60":
      return "Recyclerie60";
    case "Pays de Bray Services 60":
      return "Recyclaide";
    case "Pays de Bray Services 76":
      return "Materiosol";
    case "Les Sens du Bray":
      return "LSDB";
    case "Recyclerie 76":
      return "Recyclerie76";
    case "Pays de Bray Emploi":
      return "PBE";
    case "Maison d'Economie Solidaire":
      return "MES";
    default:
      return "—";
  }
}

export function RessourcesHumaines() {
  const employees = useQuery(api.rh.listEmployees) as Employee[] | undefined;
  const contracts = useQuery(api.rh.listContracts) as ContractHistoryItem[] | undefined;
  const upsertEmployee = useMutation(api.rh.upsertEmployee);
  const generateContract = useAction(api.rh.generateContract);

  const [tab, setTab] = useState<"employees" | "contracts">("employees");
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm);
  const [contractForm, setContractForm] = useState(emptyContractForm);
  const [employeeError, setEmployeeError] = useState<string | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);
  const [employeeMessage, setEmployeeMessage] = useState<string | null>(null);
  const [contractMessage, setContractMessage] = useState<string | null>(null);
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [sendingContract, setSendingContract] = useState(false);

  const selectedContractEmployee = useMemo(
    () =>
      employees?.find((employee) => employee._id === contractForm.employeeId) ?? null,
    [employees, contractForm.employeeId],
  );

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
  }

  async function handleContractSubmit() {
    if (!contractForm.employeeId) {
      setContractError("Sélectionnez un salarié.");
      return;
    }
    setSendingContract(true);
    setContractError(null);
    setContractMessage(null);
    try {
      await generateContract({
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
      setContractMessage("Contrat envoyé au scénario Make.");
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
        subtitle="Gérez les salariés et déclenchez les contrats depuis Mes Outils."
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
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="premium-panel rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--muted-foreground)]" />
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                Salariés importés et actifs
              </h2>
            </div>

            <div className="mt-4 grid gap-3">
              {employees.length === 0 ? (
                <EmptyState
                  icon={<Users className="h-8 w-8" />}
                  title="Aucun salarié"
                  description="Ajoutez votre premier salarié pour démarrer la gestion RH."
                />
              ) : (
                employees.map((employee) => (
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
                        {employee.gender === "homme" ? "Homme" : "Femme"}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-1 text-sm text-[var(--muted-foreground)]">
                      <p>{employee.address || "Adresse à compléter"}</p>
                      <p>
                        NIR : {employee.socialSecurityNumber || "Non renseigné"}
                      </p>
                      <p>
                        Premier contrat : {employee.firstContractDate || "Non renseigné"}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="premium-panel rounded-2xl p-5">
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
                        gender: event.target.value as "homme" | "femme",
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
                  <Input
                    type="date"
                    value={employeeForm.firstContractDate}
                    onChange={(event) =>
                      setEmployeeForm((current) => ({
                        ...current,
                        firstContractDate: event.target.value,
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
        <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <section className="premium-panel rounded-2xl p-5">
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
                  <Select
                    value={contractForm.employeeId}
                    onChange={(event) =>
                      setContractForm((current) => ({
                        ...current,
                        employeeId: event.target.value as Id<"hrEmployees">,
                        PREMIER_CONTRAT:
                          employees.find((employee) => employee._id === event.target.value)
                            ?.firstContractDate || "",
                      }))
                    }
                  >
                    {employees.map((employee) => (
                      <option key={employee._id} value={employee._id}>
                        {employee.fullName}
                      </option>
                    ))}
                  </Select>
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
                    <p className="mt-1 text-[var(--muted-foreground)]">
                      Structure webhook : {structureWebhookLabel(selectedContractEmployee.structure)}
                    </p>
                    <p className="mt-1 text-[var(--muted-foreground)]">
                      NIR : {selectedContractEmployee.socialSecurityNumber}
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
                      placeholder="Ex. CDDI-2026-001"
                    />
                  </Field>
                  <Field label="Type de contrat" required>
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
                  <Field label="Document" required>
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
                    <Input
                      type="date"
                      value={contractForm.date_debut_contrat}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          date_debut_contrat: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Date de fin du contrat" required>
                    <Input
                      type="date"
                      value={contractForm.date_fin_contrat}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          date_fin_contrat: event.target.value,
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
                    <Input
                      type="date"
                      value={contractForm.date_debut_periode_essai}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          date_debut_periode_essai: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Fin période d'essai">
                    <Input
                      type="date"
                      value={contractForm.date_fin_periode_essai}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          date_fin_periode_essai: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Rémunération brute horaire" required>
                    <Input
                      value={contractForm.remuneration_brute_horaire}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          remuneration_brute_horaire: event.target.value,
                        }))
                      }
                      placeholder="Ex. 11.88"
                    />
                  </Field>
                  <Field label="Durée mensuelle de travail" required>
                    <Input
                      value={contractForm.duree_mensuel_travail}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          duree_mensuel_travail: event.target.value,
                        }))
                      }
                      placeholder="Ex. 151.67 h"
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Salaire brut mensuel" required>
                    <Input
                      value={contractForm.salaire_brut_mensuel}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          salaire_brut_mensuel: event.target.value,
                        }))
                      }
                      placeholder="Ex. 1802.25"
                    />
                  </Field>
                  <Field label="PREMIER_CONTRAT" required>
                    <Input
                      type="date"
                      value={contractForm.PREMIER_CONTRAT}
                      onChange={(event) =>
                        setContractForm((current) => ({
                          ...current,
                          PREMIER_CONTRAT: event.target.value,
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

          <section className="premium-panel rounded-2xl p-5">
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
                  description="Les envois au webhook Make apparaîtront ici."
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
                      <StatusBadge status={contract.webhookStatus} />
                    </div>
                    <div className="mt-3 grid gap-1 text-sm text-[var(--muted-foreground)]">
                      <p>
                        {contract.payload.type_contrat} ·{" "}
                        {contract.payload.type_document === "contrat_initial"
                          ? "Contrat initial"
                          : "Avenant prolongation"}
                      </p>
                      <p>Structure webhook : {contract.payload.structure}</p>
                      {contract.payload.numero_contrat ? (
                        <p>Numéro de contrat : {contract.payload.numero_contrat}</p>
                      ) : null}
                      <p>
                        Contrat : {contract.payload.date_debut_contrat} →{" "}
                        {contract.payload.date_fin_contrat}
                      </p>
                      <p>Demandé par : {contract.requestedBy}</p>
                      <p>Envoyé le : {formatDateTime(contract.requestedAt)}</p>
                      {contract.webhookResponseCode ? (
                        <p>Code retour webhook : {contract.webhookResponseCode}</p>
                      ) : null}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      )}
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

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < 3) {
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
  }, [value, searchAddresses]);

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

function StatusBadge({ status }: { status: ContractHistoryItem["webhookStatus"] }) {
  const label =
    status === "success" ? "Envoyé" : status === "error" ? "Erreur" : "En attente";
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium",
        status === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        status === "error" && "bg-red-500/10 text-red-700 dark:text-red-300",
        status === "pending" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
    >
      {label}
    </span>
  );
}
