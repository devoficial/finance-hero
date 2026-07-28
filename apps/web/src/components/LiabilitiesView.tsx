import type {
  CreateLiabilityRequest,
  CreatePersonalBalanceRequest,
  LiabilitiesResponse,
  Liability,
  PersonalBalance,
  UpdateLiabilityRequest,
  UpdatePersonalBalanceRequest,
} from "@finance-hero/contracts";
import { type DebtPlanStrategy, simulateDebtPlan } from "@finance-hero/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  createLiability,
  createPersonalBalance,
  undoLiabilityClear,
  updateLiability,
  updatePersonalBalance,
} from "../lib/api";

interface LiabilitiesViewProps {
  data?: LiabilitiesResponse;
  loading: boolean;
  money: (paise: number) => string;
  month: string;
}

interface LiabilityForm {
  name: string;
  productType: string;
  originalAmount: string;
  currentPrincipal: string;
  emi: string;
  annualRate: string;
  status: "active" | "cleared";
}

interface PersonalBalanceForm {
  id: string | null;
  direction: "payable" | "receivable";
  name: string;
  amount: string;
  note: string;
  status: "open" | "settled";
}

interface PlannerDebtDraft {
  currentPrincipal: string;
  emi: string;
  annualRate: string;
}

function productName(productType: string) {
  return productType.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formFromLiability(liability: Liability): LiabilityForm {
  return {
    name: liability.name,
    productType: liability.productType,
    originalAmount: String(liability.originalAmountPaise / 100),
    currentPrincipal: String(liability.currentPrincipalPaise / 100),
    emi: String(liability.emiPaise / 100),
    annualRate: liability.annualRateBps == null ? "" : String(liability.annualRateBps / 100),
    status: liability.status,
  };
}

function rupeesToPaise(value: string): number | null {
  const paise = Math.round(Number(value) * 100);
  return Number.isSafeInteger(paise) && paise >= 0 ? paise : null;
}

function monthLabel(month: string | null) {
  if (!month) {
    return "Payment change required";
  }
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

export function LiabilitiesView({ data, loading, money, month }: LiabilitiesViewProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingLiability, setCreatingLiability] = useState(false);
  const [form, setForm] = useState<LiabilityForm | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [personalForm, setPersonalForm] = useState<PersonalBalanceForm | null>(null);
  const [personalValidationError, setPersonalValidationError] = useState<string | null>(null);
  const [debtStrategy, setDebtStrategy] = useState<DebtPlanStrategy>("snowball");
  const [extraPayment, setExtraPayment] = useState("0");
  const [plannerEditing, setPlannerEditing] = useState(false);
  const [plannerDrafts, setPlannerDrafts] = useState<Record<string, PlannerDebtDraft>>({});
  const [plannerValidationError, setPlannerValidationError] = useState<string | null>(null);
  const [plannerMessage, setPlannerMessage] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateLiabilityRequest }) => updateLiability(id, input),
    onSuccess: async () => {
      setEditingId(null);
      setForm(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["liabilities"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["wealth"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  const createLiabilityMutation = useMutation({
    mutationFn: (input: CreateLiabilityRequest) => createLiability(input),
    onSuccess: async () => {
      setCreatingLiability(false);
      setForm(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["liabilities"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["wealth"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  const undoClearMutation = useMutation({
    mutationFn: (id: string) => undoLiabilityClear(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["liabilities"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["wealth"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  const personalMutation = useMutation({
    mutationFn: async (form: PersonalBalanceForm) => {
      const amountPaise = rupeesToPaise(form.amount);
      if (amountPaise == null) {
        throw new Error("Enter a valid non-negative INR amount.");
      }
      if (form.id) {
        const input: UpdatePersonalBalanceRequest = {
          name: form.name,
          amountPaise,
          note: form.note || null,
          status: form.status,
        };
        return updatePersonalBalance(form.id, input);
      }
      const input: CreatePersonalBalanceRequest = {
        name: form.name,
        direction: form.direction,
        amountPaise,
        note: form.note || undefined,
      };
      return createPersonalBalance(input);
    },
    onSuccess: async () => {
      setPersonalForm(null);
      setPersonalValidationError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["liabilities"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  const personalStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "open" | "settled" }) => updatePersonalBalance(id, { status }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["liabilities"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  const plannerMutation = useMutation({
    mutationFn: (changes: Array<{ id: string; input: UpdateLiabilityRequest }>) =>
      Promise.all(changes.map((change) => updateLiability(change.id, change.input))),
    onSuccess: async () => {
      setPlannerEditing(false);
      setPlannerValidationError(null);
      setPlannerMessage("Planner assumptions saved to your liability records.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["liabilities"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["wealth"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });

  useEffect(() => {
    const drafts = Object.fromEntries(
      (data?.liabilities ?? [])
        .filter((liability) => liability.status === "active" && liability.currentPrincipalPaise > 0)
        .map((liability) => [
          liability.id,
          {
            currentPrincipal: String(liability.currentPrincipalPaise / 100),
            emi: String(liability.emiPaise / 100),
            annualRate: liability.annualRateBps == null ? "" : String(liability.annualRateBps / 100),
          },
        ]),
    );
    setPlannerDrafts(drafts);
  }, [data]);

  const plannerDebts = useMemo(
    () =>
      (data?.liabilities ?? [])
        .filter((liability) => liability.status === "active" && liability.currentPrincipalPaise > 0)
        .map((liability) => {
          const draft = plannerDrafts[liability.id];
          const principalPaise = rupeesToPaise(draft?.currentPrincipal ?? "") ?? liability.currentPrincipalPaise;
          const emiPaise = rupeesToPaise(draft?.emi ?? "") ?? liability.emiPaise;
          const annualRateBps =
            draft?.annualRate.trim() === ""
              ? null
              : Number.isFinite(Number(draft?.annualRate))
                ? Math.round(Number(draft?.annualRate) * 100)
                : liability.annualRateBps;
          return {
            id: liability.id,
            name: liability.name,
            principalPaise,
            emiPaise,
            annualRateBps,
          };
        }),
    [data, plannerDrafts],
  );
  const extraPaymentPaise = rupeesToPaise(extraPayment) ?? 0;
  const baselinePlan = useMemo(() => simulateDebtPlan(plannerDebts, "snowball", 0, month), [month, plannerDebts]);
  const snowballPlan = useMemo(
    () => simulateDebtPlan(plannerDebts, "snowball", extraPaymentPaise, month),
    [extraPaymentPaise, month, plannerDebts],
  );
  const avalanchePlan = useMemo(
    () => simulateDebtPlan(plannerDebts, "avalanche", extraPaymentPaise, month),
    [extraPaymentPaise, month, plannerDebts],
  );
  const selectedPlan = debtStrategy === "snowball" ? snowballPlan : avalanchePlan;
  const monthsSaved =
    baselinePlan.payoffMonths != null && selectedPlan.payoffMonths != null
      ? Math.max(0, baselinePlan.payoffMonths - selectedPlan.payoffMonths)
      : 0;
  const interestSaved = Math.max(0, baselinePlan.totalInterestPaise - selectedPlan.totalInterestPaise);
  const avalancheInterestAdvantage = Math.max(0, snowballPlan.totalInterestPaise - avalanchePlan.totalInterestPaise);
  const unknownRateCount = plannerDebts.filter((debt) => debt.annualRateBps == null).length;
  const totalPlannerPrincipal = plannerDebts.reduce((sum, debt) => sum + debt.principalPaise, 0);
  const minimumMonthlyEmi = plannerDebts.reduce((sum, debt) => sum + debt.emiPaise, 0);
  const firstTarget = selectedPlan.payoffOrder[0];
  const projectedPayoffIds = new Set(selectedPlan.payoffOrder.map((payoff) => payoff.id));
  const unresolvedPlannerDebts = plannerDebts.filter((debt) => !projectedPayoffIds.has(debt.id));
  const zeroBalanceActiveAccounts = (data?.liabilities ?? []).filter(
    (liability) => liability.status === "active" && liability.currentPrincipalPaise === 0,
  );
  const principalReduction = Math.max(
    0,
    totalPlannerPrincipal - (selectedPlan.months[11]?.remainingPrincipalPaise ?? 0),
  );
  const trajectoryCheckpoints = [0, 11, 23, 35, selectedPlan.months.length - 1]
    .filter((index, position, values) => index >= 0 && values.indexOf(index) === position)
    .map((index) => selectedPlan.months[index])
    .filter((checkpoint): checkpoint is NonNullable<typeof checkpoint> => checkpoint != null);
  const plannerHasChanges = (data?.liabilities ?? []).some((liability) => {
    const draft = plannerDrafts[liability.id];
    if (!draft || liability.status !== "active") return false;
    const rate = draft.annualRate.trim() === "" ? null : Math.round(Number(draft.annualRate) * 100);
    return (
      rupeesToPaise(draft.currentPrincipal) !== liability.currentPrincipalPaise ||
      rupeesToPaise(draft.emi) !== liability.emiPaise ||
      rate !== liability.annualRateBps
    );
  });

  function updatePlannerDraft(id: string, field: keyof PlannerDebtDraft, value: string) {
    setPlannerDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? { currentPrincipal: "", emi: "", annualRate: "" }),
        [field]: value,
      },
    }));
    setPlannerValidationError(null);
    setPlannerMessage(null);
  }

  function resetPlannerDrafts() {
    setPlannerDrafts(
      Object.fromEntries(
        (data?.liabilities ?? [])
          .filter((liability) => liability.status === "active" && liability.currentPrincipalPaise > 0)
          .map((liability) => [
            liability.id,
            {
              currentPrincipal: String(liability.currentPrincipalPaise / 100),
              emi: String(liability.emiPaise / 100),
              annualRate: liability.annualRateBps == null ? "" : String(liability.annualRateBps / 100),
            },
          ]),
      ),
    );
    setPlannerEditing(false);
    setPlannerValidationError(null);
    setPlannerMessage(null);
  }

  function savePlannerAssumptions() {
    const changes: Array<{ id: string; input: UpdateLiabilityRequest }> = [];
    for (const liability of data?.liabilities ?? []) {
      if (liability.status !== "active") continue;
      const draft = plannerDrafts[liability.id];
      if (!draft) continue;
      const currentPrincipalPaise = rupeesToPaise(draft.currentPrincipal);
      const emiPaise = rupeesToPaise(draft.emi);
      const annualRateBps = draft.annualRate.trim() === "" ? null : Math.round(Number(draft.annualRate.trim()) * 100);
      if (
        currentPrincipalPaise == null ||
        emiPaise == null ||
        (annualRateBps != null && (!Number.isSafeInteger(annualRateBps) || annualRateBps < 0))
      ) {
        setPlannerValidationError(`Check the balance, EMI, and interest rate for ${liability.name}.`);
        return;
      }
      const input: UpdateLiabilityRequest = {};
      if (currentPrincipalPaise !== liability.currentPrincipalPaise)
        input.currentPrincipalPaise = currentPrincipalPaise;
      if (emiPaise !== liability.emiPaise) input.emiPaise = emiPaise;
      if (annualRateBps !== liability.annualRateBps) input.annualRateBps = annualRateBps;
      if (Object.keys(input).length > 0) changes.push({ id: liability.id, input });
    }
    if (changes.length === 0) {
      setPlannerEditing(false);
      setPlannerMessage("No assumption changes to save.");
      return;
    }
    setPlannerValidationError(null);
    plannerMutation.mutate(changes);
  }

  if (loading || !data) {
    return <section className="panel loading-panel">Reading the liability register...</section>;
  }

  function beginEdit(liability: Liability) {
    setCreatingLiability(false);
    setEditingId(liability.id);
    setForm(formFromLiability(liability));
    setValidationError(null);
  }

  function cancelEdit() {
    setCreatingLiability(false);
    setEditingId(null);
    setForm(null);
    setValidationError(null);
  }

  function beginAddLiability() {
    setCreatingLiability(true);
    setEditingId(null);
    setForm({
      name: "",
      productType: "personal_loan",
      originalAmount: "",
      currentPrincipal: "",
      emi: "",
      annualRate: "",
      status: "active",
    });
    setValidationError(null);
  }

  function markCleared(liability: Liability) {
    mutation.mutate({ id: liability.id, input: { status: "cleared" } });
  }

  function undoClear(liability: Liability) {
    undoClearMutation.mutate(liability.id);
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!editingId && !creatingLiability) || !form) {
      return;
    }

    const originalAmountPaise = rupeesToPaise(form.originalAmount);
    const currentPrincipalPaise = rupeesToPaise(form.currentPrincipal);
    const emiPaise = rupeesToPaise(form.emi);
    const annualRateBps = form.annualRate.trim() === "" ? null : Math.round(Number(form.annualRate) * 100);
    if (
      originalAmountPaise == null ||
      currentPrincipalPaise == null ||
      emiPaise == null ||
      (annualRateBps != null && (!Number.isSafeInteger(annualRateBps) || annualRateBps < 0))
    ) {
      setValidationError("Enter valid non-negative INR amounts and an optional interest percentage.");
      return;
    }

    const input: CreateLiabilityRequest = {
      name: form.name,
      productType: form.productType,
      originalAmountPaise,
      currentPrincipalPaise,
      emiPaise,
      annualRateBps,
      status: form.status,
    };
    if (creatingLiability) {
      createLiabilityMutation.mutate(input);
    } else if (editingId) {
      mutation.mutate({ id: editingId, input });
    }
  }

  function beginAddPersonal(direction: "payable" | "receivable") {
    setPersonalForm({ id: null, direction, name: "", amount: "", note: "", status: "open" });
    setPersonalValidationError(null);
  }

  function beginEditPersonal(balance: PersonalBalance) {
    setPersonalForm({
      id: balance.id,
      direction: balance.direction,
      name: balance.name,
      amount: String(balance.amountPaise / 100),
      note: balance.note ?? "",
      status: balance.status,
    });
    setPersonalValidationError(null);
  }

  function submitPersonalBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!personalForm) {
      return;
    }
    if (!personalForm.name.trim()) {
      setPersonalValidationError("Enter the person's name.");
      return;
    }
    if (rupeesToPaise(personalForm.amount) == null) {
      setPersonalValidationError("Enter a valid non-negative INR amount.");
      return;
    }
    setPersonalValidationError(null);
    personalMutation.mutate(personalForm);
  }

  function personalPanel(
    title: string,
    description: string,
    direction: "payable" | "receivable",
    balances: PersonalBalance[],
    totalPaise: number,
  ) {
    return (
      <article className={`panel personal-balance-panel ${direction}`}>
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">{direction === "payable" ? "PERSONAL PAYABLES" : "PERSONAL RECEIVABLES"}</p>
            <h2>{title}</h2>
            <small>{description}</small>
          </div>
          <div className="personal-balance-total">
            <strong>{money(totalPaise)}</strong>
            <button onClick={() => beginAddPersonal(direction)} type="button">
              + Add person
            </button>
          </div>
        </div>
        <div className="personal-balance-list">
          {balances.map((balance) => (
            <div className={balance.status} key={balance.id}>
              <span>
                <strong>{balance.name}</strong>
                <small>{balance.note || (balance.status === "open" ? "Open balance" : "Cleared")}</small>
              </span>
              <b>{money(balance.amountPaise)}</b>
              <span className={`status-pill ${balance.status}`}>
                {balance.status === "settled" ? "cleared" : "open"}
              </span>
              <div className="personal-balance-actions">
                <button
                  className="personal-clear-button"
                  disabled={personalStatusMutation.isPending}
                  onClick={() =>
                    personalStatusMutation.mutate({
                      id: balance.id,
                      status: balance.status === "open" ? "settled" : "open",
                    })
                  }
                  type="button"
                >
                  {personalStatusMutation.isPending && personalStatusMutation.variables?.id === balance.id
                    ? "Saving..."
                    : balance.status === "open"
                      ? "Mark cleared"
                      : "Reopen"}
                </button>
                <button onClick={() => beginEditPersonal(balance)} type="button">
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>
    );
  }

  return (
    <>
      <section className="personal-balance-grid" aria-label="Personal balances">
        {personalPanel(
          "Other liabilities",
          "Money you need to repay outside banks and credit cards.",
          "payable",
          data.otherLiabilities,
          data.otherLiabilityPaise,
        )}
        {personalPanel(
          "Money to get back",
          "Money other people need to return to you.",
          "receivable",
          data.receivables,
          data.receivablePaise,
        )}
      </section>

      {personalForm && (
        <article className="panel personal-balance-editor-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">UPDATE ENCRYPTED PERSONAL BALANCE</p>
              <h2>
                {personalForm.id ? "Edit" : "Add"}{" "}
                {personalForm.direction === "payable" ? "other liability" : "money to get back"}
              </h2>
            </div>
            <button className="editor-close-button" onClick={() => setPersonalForm(null)} type="button">
              Cancel
            </button>
          </div>
          <form className="personal-balance-form" onSubmit={submitPersonalBalance}>
            <label>
              <span>Name</span>
              <input
                maxLength={160}
                required
                value={personalForm.name}
                onChange={(event) => setPersonalForm({ ...personalForm, name: event.target.value })}
              />
            </label>
            <label>
              <span>Amount (INR)</span>
              <input
                inputMode="decimal"
                min="0"
                required
                step="0.01"
                type="number"
                value={personalForm.amount}
                onChange={(event) => setPersonalForm({ ...personalForm, amount: event.target.value })}
              />
            </label>
            <label>
              <span>Note</span>
              <input
                maxLength={500}
                placeholder="Optional"
                value={personalForm.note}
                onChange={(event) => setPersonalForm({ ...personalForm, note: event.target.value })}
              />
            </label>
            {personalForm.id && (
              <label>
                <span>Status</span>
                <select
                  value={personalForm.status}
                  onChange={(event) =>
                    setPersonalForm({ ...personalForm, status: event.target.value as "open" | "settled" })
                  }
                >
                  <option value="open">Open</option>
                  <option value="settled">Settled</option>
                </select>
              </label>
            )}
            <button className="save-liability-button" disabled={personalMutation.isPending} type="submit">
              {personalMutation.isPending ? "Saving..." : "Save balance"}
            </button>
            {(personalValidationError || personalMutation.error) && (
              <p className="form-error liability-editor-error">
                {personalValidationError ?? personalMutation.error?.message ?? "Update failed."}
              </p>
            )}
          </form>
        </article>
      )}

      <section className="liability-metrics" aria-label="Liability summary">
        <article className="metric-card liability-metric-card warning">
          <span>Current principal</span>
          <strong>{money(data.totalPrincipalPaise)}</strong>
          <small>{data.activeCount} active facilities</small>
        </article>
        <article className="metric-card liability-metric-card">
          <span>Total monthly EMI</span>
          <strong>{money(data.totalEmiPaise)}</strong>
          <small>Committed monthly outflow</small>
        </article>
        <article className="metric-card liability-metric-card">
          <span>Other liabilities</span>
          <strong>{money(data.otherLiabilityPaise)}</strong>
          <small>Open personal payables</small>
        </article>
        <article className="metric-card liability-metric-card positive">
          <span>Money to get back</span>
          <strong>{money(data.receivablePaise)}</strong>
          <small>Open personal receivables</small>
        </article>
        <article className="metric-card liability-metric-card warning">
          <span>Net obligations</span>
          <strong>{money(data.netObligationPaise)}</strong>
          <small>Principal + payables - receivables</small>
        </article>
        <article className="metric-card liability-metric-card positive">
          <span>Cleared accounts</span>
          <strong>{data.clearedCount}</strong>
          <small>{money(data.totalOriginalPaise)} original obligations</small>
        </article>
      </section>

      <section className="panel debt-planner">
        <div className="panel-heading debt-planner-heading">
          <div>
            <p className="eyebrow">DEBT PAYOFF LAB / LIVE LIABILITY DATA</p>
            <h2>Build a debt-free plan you can explain</h2>
            <p className="debt-planner-lede">
              Change balances, EMIs, rates, strategy, or extra payment and see exactly what happens. Nothing changes
              your records until you save the assumptions.
            </p>
          </div>
          <div className="debt-planner-heading-actions">
            <span>{plannerDebts.length} active accounts</span>
            <button
              className={plannerEditing ? "active" : ""}
              disabled={plannerEditing}
              onClick={() => {
                setPlannerEditing(true);
                setPlannerMessage(null);
              }}
              type="button"
            >
              {plannerEditing ? "Editing assumptions" : "Edit assumptions"}
            </button>
          </div>
        </div>

        <div className="debt-method-explainer">
          <article>
            <b>01</b>
            <span>Pay every minimum EMI</span>
            <small>{money(minimumMonthlyEmi)} stays committed each month.</small>
          </article>
          <article>
            <b>02</b>
            <span>Direct the extra payment</span>
            <small>
              {debtStrategy === "snowball"
                ? "Snowball targets the smallest outstanding balance."
                : "Avalanche targets the highest known interest rate."}
            </small>
          </article>
          <article>
            <b>03</b>
            <span>Roll freed EMIs forward</span>
            <small>When one account closes, its EMI attacks the next target automatically.</small>
          </article>
        </div>

        <section className="debt-assumptions" aria-label="Debt planner assumptions">
          <div className="debt-assumptions-heading">
            <div>
              <span>CALCULATION INPUTS</span>
              <strong>{money(totalPlannerPrincipal)} outstanding</strong>
              <small>
                {unknownRateCount > 0
                  ? `${unknownRateCount} missing rate${unknownRateCount === 1 ? "" : "s"} currently treated as 0%.`
                  : "Every active account has an interest rate."}
              </small>
            </div>
            {plannerEditing && (
              <div>
                <button disabled={plannerMutation.isPending} onClick={resetPlannerDrafts} type="button">
                  Cancel
                </button>
                <button
                  className="save-assumptions"
                  disabled={!plannerHasChanges || plannerMutation.isPending}
                  onClick={savePlannerAssumptions}
                  type="button"
                >
                  {plannerMutation.isPending ? "Saving..." : "Save to liabilities"}
                </button>
              </div>
            )}
          </div>
          <div className="debt-assumption-table">
            <div className="debt-assumption-header">
              <span>ACCOUNT</span>
              <span>CURRENT BALANCE</span>
              <span>MINIMUM EMI</span>
              <span>ANNUAL RATE</span>
              <span>PLANNER ROLE</span>
            </div>
            {data.liabilities
              .filter((liability) => liability.status === "active" && liability.currentPrincipalPaise > 0)
              .map((liability) => {
                const draft = plannerDrafts[liability.id] ?? {
                  currentPrincipal: String(liability.currentPrincipalPaise / 100),
                  emi: String(liability.emiPaise / 100),
                  annualRate: liability.annualRateBps == null ? "" : String(liability.annualRateBps / 100),
                };
                const snowballPosition = snowballPlan.payoffOrder.findIndex((payoff) => payoff.id === liability.id) + 1;
                const avalanchePosition =
                  avalanchePlan.payoffOrder.findIndex((payoff) => payoff.id === liability.id) + 1;
                return (
                  <article key={liability.id}>
                    <div>
                      <strong>{liability.name}</strong>
                      <small>{productName(liability.productType)}</small>
                    </div>
                    {plannerEditing ? (
                      <>
                        <label>
                          <span>Balance in INR</span>
                          <input
                            inputMode="decimal"
                            min="0"
                            onChange={(event) =>
                              updatePlannerDraft(liability.id, "currentPrincipal", event.target.value)
                            }
                            type="number"
                            value={draft.currentPrincipal}
                          />
                        </label>
                        <label>
                          <span>EMI in INR</span>
                          <input
                            inputMode="decimal"
                            min="0"
                            onChange={(event) => updatePlannerDraft(liability.id, "emi", event.target.value)}
                            type="number"
                            value={draft.emi}
                          />
                        </label>
                        <label>
                          <span>Rate percent</span>
                          <input
                            inputMode="decimal"
                            min="0"
                            onChange={(event) => updatePlannerDraft(liability.id, "annualRate", event.target.value)}
                            placeholder="Missing"
                            step="0.01"
                            type="number"
                            value={draft.annualRate}
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <strong>{money(liability.currentPrincipalPaise)}</strong>
                        <strong>{money(liability.emiPaise)}</strong>
                        <strong className={liability.annualRateBps == null ? "missing-rate" : ""}>
                          {liability.annualRateBps == null
                            ? "Rate missing"
                            : `${(liability.annualRateBps / 100).toFixed(2)}%`}
                        </strong>
                      </>
                    )}
                    <div className="debt-assumption-role">
                      <span>Snowball #{snowballPosition || "—"}</span>
                      <span>Avalanche #{avalanchePosition || "—"}</span>
                    </div>
                  </article>
                );
              })}
          </div>
          {(plannerValidationError || plannerMutation.error || plannerMessage) && (
            <p className={plannerValidationError || plannerMutation.error ? "form-error" : "planner-success"}>
              {plannerValidationError ?? plannerMutation.error?.message ?? plannerMessage}
            </p>
          )}
        </section>

        <div className="debt-scenario-bar">
          <div className="debt-extra-control">
            <label>
              <span>Extra amount you can pay every month</span>
              <div>
                <b>Rs</b>
                <input
                  inputMode="decimal"
                  min="0"
                  step="100"
                  type="number"
                  value={extraPayment}
                  onChange={(event) => setExtraPayment(event.target.value)}
                />
              </div>
            </label>
            <div className="debt-extra-presets">
              {[0, 5_000, 10_000, 25_000].map((rupees) => (
                <button
                  className={extraPaymentPaise === rupees * 100 ? "active" : ""}
                  key={rupees}
                  onClick={() => setExtraPayment(String(rupees))}
                  type="button"
                >
                  {rupees === 0 ? "Minimum only" : `+ Rs ${rupees.toLocaleString("en-IN")}`}
                </button>
              ))}
            </div>
          </div>
          <fieldset className="debt-strategy-toggle">
            <legend>Debt strategy</legend>
            <button
              className={debtStrategy === "snowball" ? "active" : ""}
              onClick={() => setDebtStrategy("snowball")}
              type="button"
            >
              Snowball · smallest first
            </button>
            <button
              className={debtStrategy === "avalanche" ? "active" : ""}
              onClick={() => setDebtStrategy("avalanche")}
              type="button"
            >
              Avalanche · highest rate first
            </button>
          </fieldset>
        </div>

        <div className="debt-outcome-summary">
          <article>
            <span>TOTAL MONTHLY DEBT BUDGET</span>
            <strong>{money(selectedPlan.monthlyBudgetPaise)}</strong>
            <small>
              {money(minimumMonthlyEmi)} minimum EMIs + {money(extraPaymentPaise)} extra
            </small>
          </article>
          <article className="primary-outcome">
            <span>ESTIMATED DEBT-FREE DATE</span>
            <strong>{monthLabel(selectedPlan.debtFreeMonth)}</strong>
            <small>
              {selectedPlan.payoffMonths == null
                ? "The current assumptions cannot fully repay every balance."
                : `${selectedPlan.payoffMonths} months from now · ${monthsSaved} months gained`}
            </small>
          </article>
          <article>
            <span>PROJECTED INTEREST FROM TODAY</span>
            <strong>{money(selectedPlan.totalInterestPaise)}</strong>
            <small>{money(interestSaved)} less than the no-extra rollover plan</small>
          </article>
          <article>
            <span>FIRST ACCOUNT TO FINISH</span>
            <strong>{firstTarget?.name ?? "No target"}</strong>
            <small>{firstTarget ? monthLabel(firstTarget.month) : "Add an EMI or reduce the balance"}</small>
          </article>
        </div>

        <div className="debt-plan-narrative">
          <strong>
            Your {debtStrategy} plan starts with {firstTarget?.name ?? "the first eligible account"}.
          </strong>
          <span>
            After 12 months, projected principal falls by {money(principalReduction)}. Keep the monthly debt budget at{" "}
            {money(selectedPlan.monthlyBudgetPaise)} even after an account clears; that rollover is what accelerates the
            finish date.
          </span>
        </div>

        <div className="debt-strategy-comparison">
          <article className={debtStrategy === "snowball" ? "selected" : ""}>
            <span>SNOWBALL</span>
            <strong>{monthLabel(snowballPlan.debtFreeMonth)}</strong>
            <small>Smallest balance first · easiest visible wins</small>
            <b>
              {snowballPlan.payoffMonths ?? "—"} months · {money(snowballPlan.totalInterestPaise)} interest
            </b>
          </article>
          <article className={debtStrategy === "avalanche" ? "selected" : ""}>
            <span>AVALANCHE</span>
            <strong>{monthLabel(avalanchePlan.debtFreeMonth)}</strong>
            <small>Highest known rate first · mathematical minimum</small>
            <b>
              {avalanchePlan.payoffMonths ?? "—"} months · {money(avalanchePlan.totalInterestPaise)} interest
            </b>
          </article>
          <div className="debt-strategy-note">
            <span>DECISION SIGNAL</span>
            <strong>
              {avalancheInterestAdvantage > 0
                ? `Avalanche saves ${money(avalancheInterestAdvantage)}`
                : "Both strategies currently cost the same"}
            </strong>
            <small>
              {unknownRateCount > 0
                ? `${unknownRateCount} account rates are missing and treated as 0% until updated.`
                : "All active account rates are included."}
            </small>
          </div>
        </div>

        <div className="debt-balance-trajectory">
          <div>
            <span>PROJECTED BALANCE PATH</span>
            <small>Outstanding principal after interest and planned payments</small>
          </div>
          <div className="debt-trajectory-bars">
            {trajectoryCheckpoints.map((checkpoint) => {
              const remainingPercent =
                totalPlannerPrincipal > 0
                  ? Math.max(0, Math.round((checkpoint.remainingPrincipalPaise / totalPlannerPrincipal) * 100))
                  : 0;
              return (
                <article key={checkpoint.month}>
                  <div>
                    <span>{monthLabel(checkpoint.month)}</span>
                    <strong>{money(checkpoint.remainingPrincipalPaise)}</strong>
                  </div>
                  <div className="debt-trajectory-track">
                    <i style={{ width: `${remainingPercent}%` }} />
                  </div>
                  <small>{remainingPercent}% remaining</small>
                </article>
              );
            })}
          </div>
        </div>

        <div className="debt-payoff-roadmap">
          <div className="debt-roadmap-heading">
            <span>COMPLETE PAYOFF ORDER</span>
            <small>
              {selectedPlan.payoffOrder.length} of {plannerDebts.length} funded accounts have a projected finish date.
              Each completed EMI rolls into the next account.
            </small>
          </div>
          <div className="debt-roadmap-grid">
            {selectedPlan.payoffOrder.map((payoff, index) => (
              <article key={payoff.id}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <span>{payoff.name}</span>
                <small>{monthLabel(payoff.month)}</small>
              </article>
            ))}
          </div>
          {(unresolvedPlannerDebts.length > 0 || zeroBalanceActiveAccounts.length > 0) && (
            <div className="debt-roadmap-exceptions">
              {unresolvedPlannerDebts.map((debt) => (
                <article key={debt.id}>
                  <span>NO FINISH DATE</span>
                  <strong>{debt.name}</strong>
                  <small>
                    This account cannot be fully repaid within the 50-year model using the current EMI and extra
                    payment.
                  </small>
                </article>
              ))}
              {zeroBalanceActiveAccounts.map((liability) => (
                <article key={liability.id}>
                  <span>ZERO BALANCE</span>
                  <strong>{liability.name}</strong>
                  <small>This account is not debt to repay. Mark it cleared in the liability register.</small>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {(editingId || creatingLiability) && form && (
        <div className="liability-editor-overlay">
          <article
            aria-labelledby="liability-editor-title"
            aria-modal="true"
            className="panel liability-editor-panel"
            role="dialog"
          >
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">
                  {creatingLiability ? "ADD ENCRYPTED LIABILITY RECORD" : "UPDATE ENCRYPTED LIABILITY RECORD"}
                </p>
                <h2 id="liability-editor-title">
                  {creatingLiability ? "Add loan or credit card" : `Edit ${form.name}`}
                </h2>
              </div>
              <button className="editor-close-button" onClick={cancelEdit} type="button">
                Cancel
              </button>
            </div>
            <form className="liability-editor-form" onSubmit={submitEdit}>
              <label>
                <span>Liability name</span>
                <input
                  maxLength={160}
                  required
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <label>
                <span>Type</span>
                <select
                  value={form.productType}
                  onChange={(event) => setForm({ ...form, productType: event.target.value })}
                >
                  <option value="personal_loan">Personal loan</option>
                  <option value="home_loan">Home loan</option>
                  <option value="credit_card">Credit card</option>
                  <option value="vehicle_loan">Vehicle loan</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                <span>Original amount (INR)</span>
                <input
                  inputMode="decimal"
                  min="0"
                  required
                  step="0.01"
                  type="number"
                  value={form.originalAmount}
                  onChange={(event) => setForm({ ...form, originalAmount: event.target.value })}
                />
              </label>
              <label>
                <span>Current principal (INR)</span>
                <input
                  inputMode="decimal"
                  min="0"
                  required
                  step="0.01"
                  type="number"
                  value={form.currentPrincipal}
                  onChange={(event) => setForm({ ...form, currentPrincipal: event.target.value })}
                />
              </label>
              <label>
                <span>EMI (INR)</span>
                <input
                  inputMode="decimal"
                  min="0"
                  required
                  step="0.01"
                  type="number"
                  value={form.emi}
                  onChange={(event) => setForm({ ...form, emi: event.target.value })}
                />
              </label>
              <label>
                <span>Interest rate (%)</span>
                <input
                  inputMode="decimal"
                  min="0"
                  placeholder="Optional"
                  step="0.01"
                  type="number"
                  value={form.annualRate}
                  onChange={(event) => setForm({ ...form, annualRate: event.target.value })}
                />
              </label>
              <label>
                <span>Status</span>
                <select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "cleared" })}
                >
                  <option value="active">Active</option>
                  <option value="cleared">Cleared</option>
                </select>
              </label>
              <button
                className="save-liability-button"
                disabled={mutation.isPending || createLiabilityMutation.isPending}
                type="submit"
              >
                {mutation.isPending || createLiabilityMutation.isPending
                  ? "Saving..."
                  : creatingLiability
                    ? "Add liability"
                    : "Save changes"}
              </button>
              {(validationError || mutation.error || createLiabilityMutation.error) && (
                <p className="form-error liability-editor-error">
                  {validationError ??
                    mutation.error?.message ??
                    createLiabilityMutation.error?.message ??
                    "Update failed."}
                </p>
              )}
            </form>
          </article>
        </div>
      )}

      <article className="panel liabilities-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">LIABILITY SHEET / SNOWBALL ORDER</p>
            <h2>Loans and credit cards</h2>
          </div>
          <div className="liabilities-heading-actions">
            <span className="live-pill">{data.liabilities.length} ACCOUNTS</span>
            <button className="add-liability-button" onClick={beginAddLiability} type="button">
              + Add loan or card
            </button>
          </div>
        </div>

        <div className="table-scroll">
          <table className="liabilities-table">
            <thead>
              <tr>
                <th>Liability</th>
                <th>Original</th>
                <th>Current principal</th>
                <th>Repaid</th>
                <th>EMI</th>
                <th>Rate</th>
                <th>Status</th>
                <th>Snowball</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.liabilities.map((liability) => {
                const paidPercentage =
                  liability.originalAmountPaise > 0
                    ? Math.min(100, Math.round((liability.paidPaise / liability.originalAmountPaise) * 100))
                    : 0;
                return (
                  <tr
                    className={`${liability.status} ${editingId === liability.id ? "editing" : ""}`}
                    key={liability.id}
                  >
                    <td>
                      <strong>{liability.name}</strong>
                      <small>{productName(liability.productType)}</small>
                      <div className="liability-progress">
                        <i style={{ width: `${paidPercentage}%` }} />
                      </div>
                    </td>
                    <td>{money(liability.originalAmountPaise)}</td>
                    <td className="principal-cell">{money(liability.currentPrincipalPaise)}</td>
                    <td>{money(liability.paidPaise)}</td>
                    <td>{money(liability.emiPaise)}</td>
                    <td>{liability.annualRateBps == null ? "—" : `${(liability.annualRateBps / 100).toFixed(2)}%`}</td>
                    <td>
                      <span className={`status-pill ${liability.status}`}>{liability.status}</span>
                    </td>
                    <td>
                      {liability.snowballRank == null ? (
                        "—"
                      ) : (
                        <span className="rank-pill">#{liability.snowballRank}</span>
                      )}
                    </td>
                    <td>
                      <div className="liability-row-actions">
                        {liability.status === "active" && (
                          <button
                            className="clear-liability-button"
                            disabled={mutation.isPending}
                            onClick={() => markCleared(liability)}
                            type="button"
                          >
                            {mutation.isPending && mutation.variables?.id === liability.id
                              ? "Clearing..."
                              : "Mark cleared"}
                          </button>
                        )}
                        {liability.status === "cleared" && liability.canUndoClear && (
                          <button
                            className="undo-clear-button"
                            disabled={undoClearMutation.isPending}
                            onClick={() => undoClear(liability)}
                            type="button"
                          >
                            {undoClearMutation.isPending && undoClearMutation.variables === liability.id
                              ? "Restoring..."
                              : "Undo clear"}
                          </button>
                        )}
                        <button className="edit-liability-button" onClick={() => beginEdit(liability)} type="button">
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}
