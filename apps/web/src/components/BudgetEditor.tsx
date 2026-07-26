import type { BudgetLine, BudgetMonthResponse, UpdateBudgetMonthRequest } from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { updateBudget } from "../lib/api";

interface BudgetEditorProps {
  budget?: BudgetMonthResponse;
  emiPaise: number;
  historical: boolean;
  loading: boolean;
  money: (paise: number) => string;
}

interface ExpenseSheetDraft {
  actual: string;
  limit: string;
  comment: string;
}

function inputRupees(paise: number): string {
  return (paise / 100).toFixed(0);
}

function toPaise(value: string): number | null {
  const paise = Math.round(Number(value) * 100);
  return Number.isSafeInteger(paise) && paise >= 0 ? paise : null;
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function formatUpdated(value: string | null): string {
  if (!value) return "Not edited yet";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function formatRowUpdated(value: string | null): string {
  if (!value) return "Imported";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function draftFor(line: BudgetLine): ExpenseSheetDraft {
  return {
    actual: inputRupees(line.spentPaise),
    limit: inputRupees(line.plannedPaise),
    comment: line.comment,
  };
}

function lineType(line: BudgetLine): string {
  if (line.broadBucket === "debt_payment") return "Debt";
  if (line.broadBucket === "asset_building") return "Asset";
  if (line.broadBucket === "savings_investment") return "Savings";
  if (line.broadBucket === "nonbudget_expense") return "Charges";
  return "Regular";
}

export function BudgetEditor({ budget, emiPaise, historical, loading, money }: BudgetEditorProps) {
  const queryClient = useQueryClient();
  const [income, setIncome] = useState("");
  const [lineValues, setLineValues] = useState<Record<string, ExpenseSheetDraft>>({});
  const [dirty, setDirty] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const loadDraft = useCallback((currentBudget: BudgetMonthResponse) => {
    setIncome(inputRupees(currentBudget.plannedIncomePaise));
    setLineValues(Object.fromEntries(currentBudget.lines.map((line) => [line.categoryId, draftFor(line)])));
    setDirty(false);
  }, []);

  useEffect(() => {
    if (budget && !dirty) {
      loadDraft(budget);
    }
  }, [budget, dirty, loadDraft]);

  const draftTotals = useMemo(() => {
    if (!budget) {
      return { regularActual: 0, planned: 0, personalActual: 0, overallActual: 0 };
    }
    return budget.lines.reduce(
      (totals, line) => {
        const actual = toPaise(lineValues[line.categoryId]?.actual ?? "") ?? 0;
        const limit = toPaise(lineValues[line.categoryId]?.limit ?? "") ?? 0;
        if (line.budgetEligible) {
          totals.regularActual += actual;
          totals.planned += limit;
        }
        if (!["category-rent", "category-home", "category-household"].includes(line.categoryId)) {
          if (line.budgetEligible) totals.personalActual += actual;
        }
        totals.overallActual += actual;
        return totals;
      },
      { regularActual: 0, planned: 0, personalActual: 0, overallActual: 0 },
    );
  }, [budget, lineValues]);
  const plannedIncome = toPaise(income) ?? 0;
  const hasIncomePlan = plannedIncome > 0;
  const freeAfterPlan = plannedIncome - emiPaise - draftTotals.planned;

  const mutation = useMutation({
    mutationFn: (input: UpdateBudgetMonthRequest) => updateBudget(budget?.month ?? "", input),
    onSuccess: async (saved) => {
      loadDraft(saved);
      setValidationError(null);
      setSavedMessage(`Saved ${formatUpdated(saved.updatedAt)}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["budget", saved.month] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", saved.month] }),
        queryClient.invalidateQueries({ queryKey: ["expenses", "year", saved.month.slice(0, 4)] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", saved.month] }),
        queryClient.invalidateQueries({ queryKey: ["wealth"] }),
      ]);
    },
  });

  if (loading || !budget) {
    return <article className="panel loading-panel">Reading the monthly expense sheet...</article>;
  }
  const currentBudget = budget;

  function updateDraft(categoryId: string, field: keyof ExpenseSheetDraft, value: string) {
    setLineValues((current) => ({
      ...current,
      [categoryId]: {
        ...(current[categoryId] ?? { actual: "0", limit: "0", comment: "" }),
        [field]: value,
      },
    }));
    setDirty(true);
    setSavedMessage(null);
    setValidationError(null);
  }

  function reset() {
    loadDraft(currentBudget);
    setValidationError(null);
    setSavedMessage(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const plannedIncomePaise = toPaise(income);
    if (plannedIncomePaise == null) {
      setValidationError("Enter a valid non-negative monthly income.");
      return;
    }

    const changedLines: NonNullable<UpdateBudgetMonthRequest["lines"]> = [];
    for (const line of currentBudget.lines) {
      const draft = lineValues[line.categoryId] ?? draftFor(line);
      const actualPaise = toPaise(draft.actual);
      const plannedPaise = toPaise(draft.limit);
      if (actualPaise == null || (line.budgetEligible && plannedPaise == null)) {
        setValidationError(`Enter valid non-negative INR amounts for ${line.categoryName}.`);
        return;
      }
      const comment = draft.comment.trim();
      const changedActual = actualPaise !== line.spentPaise;
      const changedLimit = line.budgetEligible && plannedPaise !== line.plannedPaise;
      const changedComment = comment !== line.comment;
      if (changedActual || changedLimit || changedComment) {
        changedLines.push({
          categoryId: line.categoryId,
          ...(changedActual ? { actualPaise } : {}),
          ...(changedLimit ? { plannedPaise: plannedPaise ?? 0 } : {}),
          ...(changedComment ? { comment } : {}),
        });
      }
    }

    const changedIncome = plannedIncomePaise !== currentBudget.plannedIncomePaise;
    if (!changedIncome && changedLines.length === 0) {
      setDirty(false);
      setSavedMessage("No changes to save");
      return;
    }
    setValidationError(null);
    mutation.mutate({
      ...(changedIncome ? { plannedIncomePaise } : {}),
      ...(changedLines.length > 0 ? { lines: changedLines } : {}),
    });
  }

  return (
    <form className="panel expense-sheet" onSubmit={submit}>
      <div className="expense-sheet-heading">
        <div>
          <p className="eyebrow">MONTHLY EXPENSE SHEET / {budget.month}</p>
          <h2>{monthLabel(budget.month)} expense register</h2>
          <small>Last edited on this page: {formatUpdated(budget.updatedAt)}</small>
        </div>
        <div className="expense-sheet-actions">
          <span className={dirty ? "dirty" : ""}>
            {dirty ? "Unsaved changes" : (savedMessage ?? "All changes saved")}
          </span>
          <button disabled={!dirty || mutation.isPending} type="submit">
            {mutation.isPending ? "Saving..." : "Save sheet"}
          </button>
          <button disabled={!dirty || mutation.isPending} onClick={reset} type="button">
            Reset
          </button>
        </div>
      </div>

      <div className="budget-plan-strip expense-sheet-strip">
        <label>
          <span>Monthly income plan</span>
          <div className="sheet-money-input">
            <b>₹</b>
            <input
              aria-label="Monthly income plan in INR"
              inputMode="decimal"
              min="0"
              onChange={(event) => {
                setIncome(event.target.value);
                setDirty(true);
                setSavedMessage(null);
              }}
              step="0.01"
              type="number"
              value={income}
            />
          </div>
        </label>
        <div>
          <span>Regular expense limit</span>
          <strong>{money(draftTotals.planned)}</strong>
        </div>
        <div>
          <span>{historical ? "Recorded EMI payments" : "Scheduled monthly EMIs"}</span>
          <strong>{money(emiPaise)}</strong>
        </div>
        <div className={!hasIncomePlan ? "unknown" : freeAfterPlan < 0 ? "negative" : ""}>
          <span>Free after limits + EMIs</span>
          <strong>{hasIncomePlan ? money(freeAfterPlan) : "Not available"}</strong>
        </div>
      </div>

      <div className="expense-sheet-note">
        <strong>One source of truth.</strong>
        <span>
          Cost updates monthly ledger totals. Limit updates dashboard alerts, forecasts and emergency-fund needs.
        </span>
      </div>

      <div className="expense-sheet-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Expense type</th>
              <th scope="col">Class</th>
              <th scope="col">Cost</th>
              <th scope="col">Limit</th>
              <th scope="col">Over / short</th>
              <th scope="col">Comments</th>
              <th scope="col">Last updated</th>
            </tr>
          </thead>
          <tbody>
            {budget.lines.map((line) => {
              const draft = lineValues[line.categoryId] ?? draftFor(line);
              const actual = toPaise(draft.actual) ?? 0;
              const limit = toPaise(draft.limit) ?? 0;
              const remaining = limit - actual;
              return (
                <tr className={`sheet-row ${line.broadBucket}`} key={line.categoryId}>
                  <th scope="row">
                    <span>{line.categoryName}</span>
                  </th>
                  <td>
                    <span className={`sheet-class ${line.broadBucket}`}>{lineType(line)}</span>
                  </td>
                  <td>
                    <div className="sheet-money-input">
                      <b>₹</b>
                      <input
                        aria-label={`${line.categoryName} cost in INR`}
                        inputMode="decimal"
                        min="0"
                        onChange={(event) => updateDraft(line.categoryId, "actual", event.target.value)}
                        step="0.01"
                        type="number"
                        value={draft.actual}
                      />
                    </div>
                  </td>
                  <td>
                    {line.budgetEligible ? (
                      <div className="sheet-money-input">
                        <b>₹</b>
                        <input
                          aria-label={`${line.categoryName} limit in INR`}
                          inputMode="decimal"
                          min="0"
                          onChange={(event) => updateDraft(line.categoryId, "limit", event.target.value)}
                          step="0.01"
                          type="number"
                          value={draft.limit}
                        />
                      </div>
                    ) : (
                      <span className="sheet-not-applicable">—</span>
                    )}
                  </td>
                  <td>
                    {line.budgetEligible ? (
                      <strong className={remaining < 0 ? "sheet-over" : "sheet-short"}>
                        {remaining < 0 ? "-" : "+"}
                        {money(Math.abs(remaining))}
                      </strong>
                    ) : (
                      <span className="sheet-not-applicable">Tracked total</span>
                    )}
                  </td>
                  <td>
                    <input
                      aria-label={`${line.categoryName} comment`}
                      className="sheet-comment-input"
                      maxLength={500}
                      onChange={(event) => updateDraft(line.categoryId, "comment", event.target.value)}
                      placeholder="Optional note"
                      type="text"
                      value={draft.comment}
                    />
                  </td>
                  <td>
                    <span className="sheet-updated">{formatRowUpdated(line.updatedAt)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="expense-sheet-summary">
        <div>
          <span>Expense budget</span>
          <strong>{money(draftTotals.planned)}</strong>
        </div>
        <div>
          <span>Current regular expenses</span>
          <strong>{money(draftTotals.regularActual)}</strong>
        </div>
        <div className={draftTotals.planned - draftTotals.regularActual < 0 ? "negative" : ""}>
          <span>Remaining expense budget</span>
          <strong>{money(draftTotals.planned - draftTotals.regularActual)}</strong>
        </div>
        <div>
          <span>Personal spend excluding home, rent and house help</span>
          <strong>{money(draftTotals.personalActual)}</strong>
        </div>
        <div className="overall">
          <span>Overall total cash outflow</span>
          <strong>{money(draftTotals.overallActual)}</strong>
        </div>
      </div>

      {(validationError || mutation.error) && (
        <p className="form-error expense-sheet-error">{validationError ?? mutation.error?.message}</p>
      )}
    </form>
  );
}
