import type {
  BudgetLine,
  BudgetMonthResponse,
  MonthlyCashAdjustment,
  UpdateBudgetMonthRequest,
} from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { updateBudget } from "../lib/api";
import { parseRupeeExpression, rupeeInput } from "../lib/money-expression";

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

interface CashAdjustmentDraft {
  id?: string;
  occurredOn: string;
  label: string;
  amount: string;
  source: "manual" | "imported_credit";
  transactionId: string | null;
}

interface SheetSnapshot {
  income: string;
  lineValues: Record<string, ExpenseSheetDraft>;
  cashAdjustments: CashAdjustmentDraft[];
}

const HISTORY_LIMIT = 100;

function snapshotSignature(snapshot: SheetSnapshot): string {
  return JSON.stringify(snapshot);
}

function copySnapshot(snapshot: SheetSnapshot): SheetSnapshot {
  return {
    income: snapshot.income,
    lineValues: Object.fromEntries(
      Object.entries(snapshot.lineValues).map(([categoryId, line]) => [categoryId, { ...line }]),
    ),
    cashAdjustments: snapshot.cashAdjustments.map((adjustment) => ({ ...adjustment })),
  };
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
    actual: rupeeInput(line.spentPaise),
    limit: rupeeInput(line.plannedPaise),
    comment: line.comment,
  };
}

function cashDraftFor(adjustment: MonthlyCashAdjustment): CashAdjustmentDraft {
  return {
    id: adjustment.id,
    occurredOn: adjustment.occurredOn,
    label: adjustment.label,
    amount: rupeeInput(adjustment.amountPaise),
    source: adjustment.source,
    transactionId: adjustment.transactionId,
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
  const [cashAdjustments, setCashAdjustments] = useState<CashAdjustmentDraft[]>([]);
  const [undoStack, setUndoStack] = useState<SheetSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<SheetSnapshot[]>([]);
  const [savedSignature, setSavedSignature] = useState("");
  const [dirty, setDirty] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const loadDraft = useCallback((currentBudget: BudgetMonthResponse) => {
    const snapshot = {
      income: rupeeInput(currentBudget.plannedIncomePaise),
      lineValues: Object.fromEntries(currentBudget.lines.map((line) => [line.categoryId, draftFor(line)])),
      cashAdjustments: currentBudget.cashBridge.adjustments.map(cashDraftFor),
    };
    setIncome(snapshot.income);
    setLineValues(snapshot.lineValues);
    setCashAdjustments(snapshot.cashAdjustments);
    setSavedSignature(snapshotSignature(snapshot));
    setUndoStack([]);
    setRedoStack([]);
    setDirty(false);
  }, []);

  useEffect(() => {
    if (budget) {
      loadDraft(budget);
    }
  }, [budget, loadDraft]);

  const draftTotals = useMemo(() => {
    if (!budget) {
      return { regularActual: 0, planned: 0, personalActual: 0, overallActual: 0 };
    }
    return budget.lines.reduce(
      (totals, line) => {
        const actual = parseRupeeExpression(lineValues[line.categoryId]?.actual ?? "") ?? 0;
        const limit = parseRupeeExpression(lineValues[line.categoryId]?.limit ?? "") ?? 0;
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
  const adjustmentTotal = cashAdjustments.reduce(
    (sum, adjustment) => sum + (parseRupeeExpression(adjustment.amount, true) ?? 0),
    0,
  );
  const persistedSheetOutflow = budget?.lines.reduce((sum, line) => sum + line.spentPaise, 0) ?? 0;
  const draftCashOutflow =
    (budget?.cashBridge.cashOutflowPaise ?? 0) + (draftTotals.overallActual - persistedSheetOutflow);
  const fundsAvailable = (budget?.cashBridge.carryoverPaise ?? 0) + adjustmentTotal;
  const closingBalance = fundsAvailable - draftCashOutflow;
  const plannedIncome = parseRupeeExpression(income) ?? 0;
  const hasIncomePlan = plannedIncome > 0;
  const freeAfterPlan = plannedIncome - emiPaise - draftTotals.planned;

  const mutation = useMutation({
    mutationFn: (input: UpdateBudgetMonthRequest) => updateBudget(budget?.month ?? "", input),
    onSuccess: async (saved) => {
      loadDraft(saved);
      setValidationError(null);
      setSavedMessage(`Saved ${formatUpdated(saved.updatedAt)}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["budget"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", saved.month] }),
        queryClient.invalidateQueries({ queryKey: ["expenses", "year", saved.month.slice(0, 4)] }),
        queryClient.invalidateQueries({ queryKey: ["imports"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["wealth"] }),
      ]);
    },
  });

  if (loading || !budget) {
    return <article className="panel loading-panel">Reading the monthly expense sheet...</article>;
  }
  const currentBudget = budget;

  function currentSnapshot(): SheetSnapshot {
    return copySnapshot({ income, lineValues, cashAdjustments });
  }

  function applySnapshot(snapshot: SheetSnapshot) {
    const copy = copySnapshot(snapshot);
    setIncome(copy.income);
    setLineValues(copy.lineValues);
    setCashAdjustments(copy.cashAdjustments);
    setDirty(snapshotSignature(copy) !== savedSignature);
    setSavedMessage(null);
    setValidationError(null);
  }

  function checkpoint() {
    const snapshot = currentSnapshot();
    setUndoStack((current) => [...current.slice(-(HISTORY_LIMIT - 1)), snapshot]);
    setRedoStack([]);
  }

  function undo() {
    const previous = undoStack.at(-1);
    if (!previous || mutation.isPending) return;
    const current = currentSnapshot();
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), current]);
    applySnapshot(previous);
  }

  function redo() {
    const next = redoStack.at(-1);
    if (!next || mutation.isPending) return;
    const current = currentSnapshot();
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), current]);
    applySnapshot(next);
  }

  function handleSheetKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    const command = event.metaKey || event.ctrlKey;
    if (!command) return;
    if (event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    }
  }

  function updateDraft(categoryId: string, field: keyof ExpenseSheetDraft, value: string) {
    checkpoint();
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

  function updateCashAdjustment(index: number, field: "occurredOn" | "label" | "amount", value: string) {
    checkpoint();
    setCashAdjustments((current) =>
      current.map((adjustment, adjustmentIndex) =>
        adjustmentIndex === index ? { ...adjustment, [field]: value } : adjustment,
      ),
    );
    setDirty(true);
    setSavedMessage(null);
    setValidationError(null);
  }

  function addCashAdjustment() {
    checkpoint();
    setCashAdjustments((current) => [
      ...current,
      {
        occurredOn: `${currentBudget.month}-01`,
        label: "",
        amount: "",
        source: "manual",
        transactionId: null,
      },
    ]);
    setDirty(true);
    setSavedMessage(null);
  }

  function removeCashAdjustment(index: number) {
    checkpoint();
    setCashAdjustments((current) => current.filter((_, adjustmentIndex) => adjustmentIndex !== index));
    setDirty(true);
    setSavedMessage(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const plannedIncomePaise = parseRupeeExpression(income);
    if (plannedIncomePaise == null) {
      setValidationError("Enter a valid non-negative monthly income.");
      return;
    }

    const changedLines: NonNullable<UpdateBudgetMonthRequest["lines"]> = [];
    for (const line of currentBudget.lines) {
      const draft = lineValues[line.categoryId] ?? draftFor(line);
      const actualPaise = parseRupeeExpression(draft.actual);
      const plannedPaise = parseRupeeExpression(draft.limit);
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
          ...(changedComment ? { comment } : {}),
        });
      }
    }

    const normalizedAdjustments: NonNullable<UpdateBudgetMonthRequest["cashAdjustments"]> = [];
    for (const adjustment of cashAdjustments) {
      const amountPaise = parseRupeeExpression(adjustment.amount, true);
      if (
        !adjustment.occurredOn.startsWith(`${currentBudget.month}-`) ||
        !adjustment.label.trim() ||
        amountPaise == null ||
        amountPaise === 0
      ) {
        setValidationError("Each cash entry needs a date in this month, a label, and a non-zero amount.");
        return;
      }
      normalizedAdjustments.push({
        ...(adjustment.id ? { id: adjustment.id } : {}),
        occurredOn: adjustment.occurredOn,
        label: adjustment.label.trim(),
        amountPaise,
        source: adjustment.source,
        transactionId: adjustment.transactionId,
      });
    }
    const currentAdjustments = currentBudget.cashBridge.adjustments.map((adjustment) => ({
      id: adjustment.id,
      occurredOn: adjustment.occurredOn,
      label: adjustment.label,
      amountPaise: adjustment.amountPaise,
      source: adjustment.source,
      transactionId: adjustment.transactionId,
    }));
    const changedAdjustments = JSON.stringify(normalizedAdjustments) !== JSON.stringify(currentAdjustments);
    const changedIncome = plannedIncomePaise !== currentBudget.plannedIncomePaise;
    if (!changedIncome && !changedAdjustments && changedLines.length === 0) {
      setDirty(false);
      setSavedMessage("No changes to save");
      return;
    }
    setValidationError(null);
    mutation.mutate({
      ...(changedIncome ? { plannedIncomePaise } : {}),
      ...(changedAdjustments ? { cashAdjustments: normalizedAdjustments } : {}),
      ...(changedLines.length > 0 ? { lines: changedLines } : {}),
    });
  }

  return (
    <form className="panel expense-sheet" onKeyDown={handleSheetKeyDown} onSubmit={submit}>
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
          <button
            aria-label="Undo last sheet edit"
            className="history-button"
            disabled={undoStack.length === 0 || mutation.isPending}
            onClick={undo}
            title="Undo (Cmd/Ctrl+Z)"
            type="button"
          >
            Undo
          </button>
          <button
            aria-label="Redo last sheet edit"
            className="history-button"
            disabled={redoStack.length === 0 || mutation.isPending}
            onClick={redo}
            title="Redo (Shift+Cmd/Ctrl+Z)"
            type="button"
          >
            Redo
          </button>
          <button className="save-button" disabled={!dirty || mutation.isPending} type="submit">
            {mutation.isPending ? "Saving..." : "Save sheet"}
          </button>
          <button disabled={!dirty || mutation.isPending} onClick={reset} type="button">
            Reset
          </button>
        </div>
      </div>

      <section className="cash-bridge" aria-label="Monthly cash bridge">
        <div className="cash-bridge-heading">
          <div>
            <p className="eyebrow">CARRYOVER + RECEIPTS - OUTFLOW</p>
            <h3>Monthly cash bridge</h3>
            <small>Positive entries add cash. Negative entries subtract cash.</small>
          </div>
          <button onClick={addCashAdjustment} type="button">
            + Add cash entry
          </button>
        </div>
        <div className="cash-bridge-equation">
          <article className={budget.cashBridge.carryoverPaise < 0 ? "negative" : ""}>
            <span>Previous month carryover</span>
            <strong>{money(budget.cashBridge.carryoverPaise)}</strong>
            <small>Automatic from the prior closing balance</small>
          </article>
          <article className={adjustmentTotal < 0 ? "negative" : ""}>
            <span>Salary + extra adjustments</span>
            <strong>{money(adjustmentTotal)}</strong>
            <small>{cashAdjustments.length} dated cash entries</small>
          </article>
          <article className={fundsAvailable < 0 ? "negative" : ""}>
            <span>Funds available</span>
            <strong>{money(fundsAvailable)}</strong>
            <small>Carryover plus signed entries</small>
          </article>
          <article>
            <span>Tracked cash outflow</span>
            <strong>-{money(draftCashOutflow)}</strong>
            <small>Updates with the expense sheet</small>
          </article>
          <article className={`closing ${closingBalance < 0 ? "negative" : ""}`}>
            <span>Current / closing balance</span>
            <strong>{money(closingBalance)}</strong>
            <small>Becomes next month’s carryover</small>
          </article>
        </div>
        <div className="cash-adjustment-list">
          {cashAdjustments.map((adjustment, index) => (
            <div className="cash-adjustment-row" key={adjustment.id ?? `new-${index}`}>
              <input
                aria-label={`Cash entry ${index + 1} date`}
                onChange={(event) => updateCashAdjustment(index, "occurredOn", event.target.value)}
                type="date"
                value={adjustment.occurredOn}
              />
              <input
                aria-label={`Cash entry ${index + 1} label`}
                onChange={(event) => updateCashAdjustment(index, "label", event.target.value)}
                placeholder="Salary, extra income, correction"
                type="text"
                value={adjustment.label}
              />
              <div className="sheet-money-input">
                <b>₹</b>
                <input
                  aria-label={`Cash entry ${index + 1} amount`}
                  inputMode="decimal"
                  onChange={(event) => updateCashAdjustment(index, "amount", event.target.value)}
                  placeholder="+300893 or -500"
                  type="text"
                  value={adjustment.amount}
                />
              </div>
              <button
                aria-label={`Remove cash entry ${index + 1}`}
                disabled={adjustment.source === "imported_credit"}
                onClick={() => removeCashAdjustment(index)}
                title={
                  adjustment.source === "imported_credit"
                    ? "Move this transaction back to pending from Imports to remove it."
                    : undefined
                }
                type="button"
              >
                {adjustment.source === "imported_credit" ? "Imported credit" : "Remove"}
              </button>
            </div>
          ))}
          {cashAdjustments.length === 0 && <p>No salary or extra cash recorded for this month yet.</p>}
        </div>
      </section>

      <div className="budget-plan-strip expense-sheet-strip">
        <label>
          <span>Expected monthly salary plan</span>
          <div className="sheet-money-input">
            <b>₹</b>
            <input
              aria-label="Monthly income plan in INR"
              inputMode="decimal"
              onChange={(event) => {
                checkpoint();
                setIncome(event.target.value);
                setDirty(true);
                setSavedMessage(null);
              }}
              placeholder="300893+bonus-correction"
              type="text"
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
          Money cells accept additions and subtractions such as 16433+500-200. Cost updates recorded spending; limits
          update alerts, forecasts and emergency-fund needs.
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
              const actual = parseRupeeExpression(draft.actual) ?? 0;
              const limit = parseRupeeExpression(draft.limit) ?? 0;
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
                        onChange={(event) => updateDraft(line.categoryId, "actual", event.target.value)}
                        placeholder="16433+500-200"
                        type="text"
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
                          onChange={(event) => updateDraft(line.categoryId, "limit", event.target.value)}
                          placeholder="20500+1000"
                          type="text"
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
