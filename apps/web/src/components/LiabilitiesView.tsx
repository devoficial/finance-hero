import type { LiabilitiesResponse, Liability, UpdateLiabilityRequest } from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { updateLiability } from "../lib/api";

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
  const [form, setForm] = useState<LiabilityForm | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
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

  if (loading || !data) {
    return <section className="panel loading-panel">Reading the liability register...</section>;
  }

  function beginEdit(liability: Liability) {
    setEditingId(liability.id);
    setForm(formFromLiability(liability));
    setValidationError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(null);
    setValidationError(null);
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId || !form) {
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

    mutation.mutate({
      id: editingId,
      input: {
        name: form.name,
        productType: form.productType,
        originalAmountPaise,
        currentPrincipalPaise,
        emiPaise,
        annualRateBps,
        status: form.status,
      },
    });
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
          <span>Original obligations</span>
          <strong>{money(data.totalOriginalPaise)}</strong>
          <small>Includes cleared facilities</small>
        </article>
        <article className="metric-card liability-metric-card positive">
          <span>Cleared accounts</span>
          <strong>{data.clearedCount}</strong>
          <small>Retained for repayment history</small>
        </article>
      </section>

      {editingId && form && (
        <article className="panel liability-editor-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">UPDATE ENCRYPTED LIABILITY RECORD</p>
              <h2>Edit {form.name}</h2>
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
            <button className="save-liability-button" disabled={mutation.isPending} type="submit">
              {mutation.isPending ? "Saving..." : "Save changes"}
            </button>
            {(validationError || mutation.error) && (
              <p className="form-error liability-editor-error">
                {validationError ?? mutation.error?.message ?? "Update failed."}
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
          <span className="live-pill">{data.liabilities.length} ACCOUNTS</span>
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
                      <button className="edit-liability-button" onClick={() => beginEdit(liability)} type="button">
                        Edit
                      </button>
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
