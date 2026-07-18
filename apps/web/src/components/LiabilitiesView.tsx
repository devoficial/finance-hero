import type {
  CreateLiabilityRequest,
  CreatePersonalBalanceRequest,
  LiabilitiesResponse,
  Liability,
  PersonalBalance,
  UpdateLiabilityRequest,
  UpdatePersonalBalanceRequest,
} from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
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

export function LiabilitiesView({ data, loading, money }: LiabilitiesViewProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingLiability, setCreatingLiability] = useState(false);
  const [form, setForm] = useState<LiabilityForm | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [personalForm, setPersonalForm] = useState<PersonalBalanceForm | null>(null);
  const [personalValidationError, setPersonalValidationError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateLiabilityRequest }) => updateLiability(id, input),
    onSuccess: async () => {
      setEditingId(null);
      setForm(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["liabilities"] }),
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
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  const undoClearMutation = useMutation({
    mutationFn: (id: string) => undoLiabilityClear(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["liabilities"] }),
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

      {(editingId || creatingLiability) && form && (
        <article className="panel liability-editor-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">
                {creatingLiability ? "ADD ENCRYPTED LIABILITY RECORD" : "UPDATE ENCRYPTED LIABILITY RECORD"}
              </p>
              <h2>{creatingLiability ? "Add loan or credit card" : `Edit ${form.name}`}</h2>
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
