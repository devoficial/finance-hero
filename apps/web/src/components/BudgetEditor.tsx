import type { BudgetMonthResponse, UpdateBudgetMonthRequest } from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { updateBudget } from "../lib/api";

interface BudgetEditorProps {
  budget?: BudgetMonthResponse;
  emiPaise: number;
  loading: boolean;
  money: (paise: number) => string;
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

export function BudgetEditor({ budget, emiPaise, loading, money }: BudgetEditorProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [income, setIncome] = useState("");
  const [lineValues, setLineValues] = useState<Record<string, string>>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!budget || editing) {
      return;
    }
    setIncome(inputRupees(budget.plannedIncomePaise));
    setLineValues(Object.fromEntries(budget.lines.map((line) => [line.categoryId, inputRupees(line.plannedPaise)])));
  }, [budget, editing]);

  const plannedLineTotal = useMemo(
    () =>
      Object.values(lineValues).reduce((sum, value) => {
        const paise = toPaise(value);
        return sum + (paise ?? 0);
      }, 0),
    [lineValues],
  );
  const plannedIncome = toPaise(income) ?? 0;
  const freeAfterPlan = plannedIncome - emiPaise - plannedLineTotal;

  const mutation = useMutation({
    mutationFn: (input: UpdateBudgetMonthRequest) => updateBudget(budget?.month ?? "", input),
    onSuccess: async (saved) => {
      setEditing(false);
      setValidationError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["budget", saved.month] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", saved.month] }),
        queryClient.invalidateQueries({ queryKey: ["expenses", "year", saved.month.slice(0, 4)] }),
      ]);
    },
  });

  if (loading || !budget) {
    return <article className="panel loading-panel">Reading the monthly allocation...</article>;
  }
  const currentBudget = budget;

  function startEditing() {
    setIncome(inputRupees(currentBudget.plannedIncomePaise));
    setLineValues(
      Object.fromEntries(currentBudget.lines.map((line) => [line.categoryId, inputRupees(line.plannedPaise)])),
    );
    setValidationError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setValidationError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const plannedIncomePaise = toPaise(income);
    const lines = currentBudget.lines.map((line) => ({
      categoryId: line.categoryId,
      plannedPaise: toPaise(lineValues[line.categoryId] ?? ""),
    }));
    if (plannedIncomePaise == null || lines.some((line) => line.plannedPaise == null)) {
      setValidationError("Enter valid non-negative INR amounts.");
      return;
    }
    setValidationError(null);
    mutation.mutate({
      plannedIncomePaise,
      lines: lines.map((line) => ({ categoryId: line.categoryId, plannedPaise: line.plannedPaise ?? 0 })),
    });
  }

  return (
    <article className="panel budget-editor">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">MONTHLY ALLOCATION / {budget.month}</p>
          <h2>{monthLabel(budget.month)} spending plan</h2>
        </div>
        {!editing && (
          <button className="budget-edit-button" onClick={startEditing} type="button">
            Edit allocation
          </button>
        )}
      </div>

      <div className="budget-plan-strip">
        <div>
          <span>Income plan</span>
          <strong>{money(budget.plannedIncomePaise)}</strong>
        </div>
        <div>
          <span>Category budget</span>
          <strong>{money(budget.regularBudgetPaise)}</strong>
        </div>
        <div>
          <span>Monthly EMIs</span>
          <strong>{money(emiPaise)}</strong>
        </div>
        <div className={budget.plannedIncomePaise - budget.regularBudgetPaise - emiPaise < 0 ? "negative" : ""}>
          <span>Free after plan</span>
          <strong>{money(budget.plannedIncomePaise - budget.regularBudgetPaise - emiPaise)}</strong>
        </div>
      </div>

      {editing ? (
        <form className="budget-form" onSubmit={submit}>
          <div className="budget-income-field">
            <label>
              Planned monthly income (INR)
              <input
                inputMode="decimal"
                min="0"
                onChange={(event) => setIncome(event.target.value)}
                step="0.01"
                type="number"
                value={income}
              />
            </label>
            <div className={freeAfterPlan < 0 ? "budget-balance negative" : "budget-balance"}>
              <span>Live balance after category plan and EMIs</span>
              <strong>{money(freeAfterPlan)}</strong>
            </div>
          </div>
          <div className="budget-line-editor">
            {budget.lines.map((line) => (
              <label key={line.categoryId}>
                <span>
                  <b>{line.categoryName}</b>
                  <small>{line.alertEligible ? "Regular expense" : "Planned allocation"}</small>
                </span>
                <input
                  aria-label={`${line.categoryName} budget in INR`}
                  min="0"
                  onChange={(event) =>
                    setLineValues((current) => ({ ...current, [line.categoryId]: event.target.value }))
                  }
                  step="0.01"
                  type="number"
                  value={lineValues[line.categoryId] ?? ""}
                />
              </label>
            ))}
          </div>
          <div className="budget-form-footer">
            <span>
              CATEGORY TOTAL <strong>{money(plannedLineTotal)}</strong>
            </span>
            <div>
              <button disabled={mutation.isPending} type="submit">
                {mutation.isPending ? "Saving..." : "Save allocation"}
              </button>
              <button onClick={cancelEditing} type="button">
                Cancel
              </button>
            </div>
          </div>
          {(validationError || mutation.error) && (
            <p className="form-error">{validationError ?? mutation.error?.message}</p>
          )}
        </form>
      ) : (
        <div className="budget-line-list">
          {budget.lines.map((line) => {
            const percentage =
              line.plannedPaise > 0 ? Math.max(0, Math.round((line.spentPaise / line.plannedPaise) * 100)) : 0;
            return (
              <div className={line.remainingPaise < 0 ? "over" : ""} key={line.categoryId}>
                <div>
                  <strong>{line.categoryName}</strong>
                  <span>{line.alertEligible ? "Expense limit" : "Planned allocation"}</span>
                </div>
                <div className="budget-progress">
                  <i style={{ width: `${Math.min(100, percentage)}%` }} />
                </div>
                <span>
                  Spent <b>{money(line.spentPaise)}</b>
                </span>
                <span>
                  Budget <b>{money(line.plannedPaise)}</b>
                </span>
                <span>
                  {line.remainingPaise < 0 ? "Over" : "Left"} <b>{money(Math.abs(line.remainingPaise))}</b>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
