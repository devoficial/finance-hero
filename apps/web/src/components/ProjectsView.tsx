import type {
  CreateProjectCommitmentRequest,
  ProjectCommitment,
  ProjectSummaryResponse,
  ReferenceDataResponse,
} from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import {
  createProjectCommitment,
  createProjectExpense,
  updateProjectCommitment,
  updateProjectExpense,
} from "../lib/api";

interface ProjectsViewProps {
  data?: ProjectSummaryResponse;
  referenceData?: ReferenceDataResponse;
  loading: boolean;
  money: (paise: number) => string;
}

type ProjectTab = "expenses" | "vendors";
type ExpenseFilter = "all" | "needs_review" | "excluded";

function localDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

function rupeesToPaise(value: string): number | null {
  const paise = Math.round(Number(value) * 100);
  return Number.isSafeInteger(paise) && paise >= 0 ? paise : null;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function ProjectsView({ data, referenceData, loading, money }: ProjectsViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ProjectTab>("expenses");
  const [expenseFilter, setExpenseFilter] = useState<ExpenseFilter>("all");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseDate, setExpenseDate] = useState(localDate);
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [editingVendor, setEditingVendor] = useState<ProjectCommitment | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [vendorEstimate, setVendorEstimate] = useState("");
  const [vendorPending, setVendorPending] = useState("");
  const [vendorStatus, setVendorStatus] = useState<"open" | "settled" | "unknown">("open");
  const [formError, setFormError] = useState<string | null>(null);

  const refreshProjects = async () => {
    await queryClient.invalidateQueries({ queryKey: ["projects", "home-construction"] });
  };

  const expenseMutation = useMutation({
    mutationFn: createProjectExpense,
    onSuccess: async (expense) => {
      setShowExpenseForm(false);
      setExpenseDescription("");
      setExpenseAmount("");
      setFormError(null);
      const month = expense.occurredOn.slice(0, 7);
      await Promise.all([
        refreshProjects(),
        queryClient.invalidateQueries({ queryKey: ["dashboard", month] }),
        queryClient.invalidateQueries({ queryKey: ["expenses", "year", month.slice(0, 4)] }),
      ]);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateProjectExpense>[1] }) =>
      updateProjectExpense(id, input),
    onSuccess: refreshProjects,
  });

  const vendorMutation = useMutation({
    mutationFn: async (input: CreateProjectCommitmentRequest) =>
      editingVendor ? updateProjectCommitment(editingVendor.id, input) : createProjectCommitment(input),
    onSuccess: async () => {
      setShowVendorForm(false);
      setEditingVendor(null);
      setVendorName("");
      setVendorEstimate("");
      setVendorPending("");
      setVendorStatus("open");
      setFormError(null);
      await refreshProjects();
    },
  });

  const paymentAccounts = (referenceData?.accounts ?? []).filter(
    (account) => account.accountClass === "asset" || account.accountType === "credit_card",
  );
  const effectiveAccountId =
    paymentAccounts.find((account) => account.id === expenseAccountId)?.id ??
    paymentAccounts.find((account) => account.id === "account-primary-bank")?.id ??
    paymentAccounts[0]?.id ??
    "";

  const filteredExpenses = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-IN");
    return (data?.expenses ?? []).filter((expense) => {
      const filterMatches =
        expenseFilter === "all" ||
        (expenseFilter === "needs_review" && expense.reviewStatus === "needs_review") ||
        (expenseFilter === "excluded" && !expense.includedInActual);
      return filterMatches && (!needle || expense.description.toLocaleLowerCase("en-IN").includes(needle));
    });
  }, [data?.expenses, expenseFilter, search]);
  const visibleExpenses = showAll ? filteredExpenses : filteredExpenses.slice(0, 30);
  const chartMaximum = Math.max(...(data?.monthlySpend.map((item) => item.amountPaise) ?? [1]), 1);

  if (loading || !data) {
    return <section className="panel loading-panel">Reading the construction register...</section>;
  }

  function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountPaise = rupeesToPaise(expenseAmount);
    if (!expenseDescription.trim() || amountPaise == null || amountPaise <= 0 || !effectiveAccountId) {
      setFormError("Enter a description, a positive INR amount, and a payment account.");
      return;
    }
    setFormError(null);
    expenseMutation.mutate({
      occurredOn: expenseDate,
      description: expenseDescription,
      amountPaise,
      accountId: effectiveAccountId,
      idempotencyKey: `web-project:${crypto.randomUUID()}`,
    });
  }

  function beginVendor(commitment?: ProjectCommitment) {
    setEditingVendor(commitment ?? null);
    setVendorName(commitment?.vendorName ?? "");
    setVendorEstimate(commitment ? String(commitment.estimatedPaise / 100) : "");
    setVendorPending(commitment ? String(commitment.pendingPaise / 100) : "");
    setVendorStatus(commitment?.status ?? "open");
    setFormError(null);
    setShowVendorForm(true);
  }

  function submitVendor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const estimatedPaise = rupeesToPaise(vendorEstimate);
    const pendingPaise = rupeesToPaise(vendorPending);
    if (!vendorName.trim() || estimatedPaise == null || pendingPaise == null) {
      setFormError("Enter a vendor name and valid non-negative INR amounts.");
      return;
    }
    if (pendingPaise > estimatedPaise && estimatedPaise > 0) {
      setFormError("Pending amount cannot be higher than the current estimate.");
      return;
    }
    setFormError(null);
    vendorMutation.mutate({
      vendorName,
      estimatedPaise,
      pendingPaise,
      status: vendorStatus,
    });
  }

  function editDescription(id: string, current: string) {
    const next = window.prompt("Update the project description:", current);
    if (next?.trim() && next.trim() !== current) {
      reviewMutation.mutate({ id, input: { description: next.trim() } });
    }
  }

  return (
    <section className="project-workspace">
      <div className="project-brief">
        <div>
          <p className="eyebrow">PROJECT CONTROL / MIGRATED SOURCE SNAPSHOT</p>
          <h2>{data.name}</h2>
          <p>Construction is active. The old sheet is preserved as-is; new entries update your financial records.</p>
        </div>
        <div className="project-status-stack">
          <span className="project-status active">ACTIVE PROJECT</span>
          <span className="project-status stale">NEEDS UPDATE</span>
        </div>
      </div>

      <div className="project-kpis">
        <article>
          <span>SOURCE RECORDED</span>
          <strong>{money(data.sourceExpensePaise)}</strong>
          <small>{data.expenses.length} migrated expense rows</small>
        </article>
        <article>
          <span>INCLUDED ACTUAL</span>
          <strong>{money(data.actualExpensePaise)}</strong>
          <small>{money(data.excludedPaise)} explicitly excluded</small>
        </article>
        <article>
          <span>PENDING COMMITMENTS</span>
          <strong>{money(data.pendingCommitmentPaise)}</strong>
          <small>{data.commitments.filter((item) => item.status !== "settled").length} vendor balances</small>
        </article>
        <article className="forecast">
          <span>PRELIMINARY FORECAST</span>
          <strong>{money(data.forecastPaise)}</strong>
          <small>Included actual + current pending</small>
        </article>
      </div>

      <div className="project-alert">
        <b>{data.needsReviewCount}</b>
        <div>
          <strong>Imported rows still need a decision</strong>
          <span>
            Latest source entry: {data.latestExpenseOn ? displayDate(data.latestExpenseOn) : "None"}. Forecast remains
            preliminary until vendor balances are refreshed.
          </span>
        </div>
        <button
          onClick={() => {
            setTab("expenses");
            setExpenseFilter("needs_review");
          }}
          type="button"
        >
          Review flagged rows
        </button>
      </div>

      <article className="panel project-trend">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">MONTHLY BUILD COST</p>
            <h2>Spend velocity</h2>
          </div>
          <span>{money(data.actualExpensePaise)} included</span>
        </div>
        <div className="project-bars" aria-label="Monthly Home Construction spend chart" role="img">
          {data.monthlySpend.map((item) => (
            <div key={item.month}>
              <span>{money(item.amountPaise)}</span>
              <i style={{ height: `${Math.max(8, (item.amountPaise / chartMaximum) * 100)}%` }} />
              <b>
                {new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(
                  new Date(`${item.month}-01T00:00:00Z`),
                )}
              </b>
            </div>
          ))}
        </div>
      </article>

      <article className="panel project-register">
        <div className="project-register-head">
          <div className="project-tabs" role="tablist" aria-label="Construction registers">
            <button className={tab === "expenses" ? "active" : ""} onClick={() => setTab("expenses")} type="button">
              Expenses <span>{data.expenses.length}</span>
            </button>
            <button className={tab === "vendors" ? "active" : ""} onClick={() => setTab("vendors")} type="button">
              Vendors <span>{data.commitments.length}</span>
            </button>
          </div>
          <button
            className="project-primary-action"
            onClick={() => (tab === "expenses" ? setShowExpenseForm(true) : beginVendor())}
            type="button"
          >
            {tab === "expenses" ? "+ Add expense" : "+ Add vendor"}
          </button>
        </div>

        {tab === "expenses" && showExpenseForm && (
          <form className="project-form" onSubmit={submitExpense}>
            <label>
              Date
              <input
                onChange={(event) => setExpenseDate(event.target.value)}
                required
                type="date"
                value={expenseDate}
              />
            </label>
            <label className="project-form-wide">
              Description
              <input
                onChange={(event) => setExpenseDescription(event.target.value)}
                placeholder="e.g. Electrical wiring"
                required
                value={expenseDescription}
              />
            </label>
            <label>
              Amount (INR)
              <input
                inputMode="decimal"
                min="0.01"
                onChange={(event) => setExpenseAmount(event.target.value)}
                placeholder="0.00"
                required
                step="0.01"
                type="number"
                value={expenseAmount}
              />
            </label>
            <label>
              Paid from
              <select onChange={(event) => setExpenseAccountId(event.target.value)} value={effectiveAccountId}>
                {paymentAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="project-form-actions">
              <button disabled={expenseMutation.isPending} type="submit">
                {expenseMutation.isPending ? "Posting..." : "Post expense"}
              </button>
              <button onClick={() => setShowExpenseForm(false)} type="button">
                Cancel
              </button>
            </div>
            {(formError || expenseMutation.error) && (
              <p className="form-error">{formError ?? expenseMutation.error?.message}</p>
            )}
          </form>
        )}

        {tab === "expenses" ? (
          <>
            <div className="project-tools">
              <input
                aria-label="Search construction expenses"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search expense description"
                type="search"
                value={search}
              />
              <select
                aria-label="Filter construction expenses"
                onChange={(event) => setExpenseFilter(event.target.value as ExpenseFilter)}
                value={expenseFilter}
              >
                <option value="all">All rows</option>
                <option value="needs_review">Needs review</option>
                <option value="excluded">Excluded</option>
              </select>
              <span>
                Showing {visibleExpenses.length} of {filteredExpenses.length}
              </span>
            </div>
            <div className="project-table-wrap">
              <table className="project-table">
                <thead>
                  <tr>
                    <th>Date / Expense</th>
                    <th>Amount</th>
                    <th>Running balance</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleExpenses.map((expense) => (
                    <tr className={!expense.includedInActual ? "excluded" : ""} key={expense.id}>
                      <td>
                        <strong>{expense.description}</strong>
                        <span>{displayDate(expense.occurredOn)}</span>
                      </td>
                      <td>{money(expense.amountPaise)}</td>
                      <td>{expense.runningBalancePaise == null ? "—" : money(expense.runningBalancePaise)}</td>
                      <td>
                        <span className={`source-pill ${expense.source}`}>{expense.source}</span>
                      </td>
                      <td>
                        <span className={`review-pill ${expense.reviewStatus}`}>
                          {expense.includedInActual
                            ? expense.reviewStatus === "needs_review"
                              ? "Needs review"
                              : "Included"
                            : "Excluded"}
                        </span>
                      </td>
                      <td>
                        <div className="project-row-actions">
                          {expense.reviewStatus === "needs_review" && (
                            <button
                              onClick={() =>
                                reviewMutation.mutate({ id: expense.id, input: { reviewStatus: "confirmed" } })
                              }
                              type="button"
                            >
                              Confirm
                            </button>
                          )}
                          {expense.source === "imported" && (
                            <button
                              onClick={() =>
                                reviewMutation.mutate({
                                  id: expense.id,
                                  input: { includedInActual: !expense.includedInActual },
                                })
                              }
                              type="button"
                            >
                              {expense.includedInActual ? "Exclude" : "Restore"}
                            </button>
                          )}
                          {expense.source === "imported" && (
                            <button onClick={() => editDescription(expense.id, expense.description)} type="button">
                              Rename
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredExpenses.length > 30 && (
              <button className="show-register-button" onClick={() => setShowAll((value) => !value)} type="button">
                {showAll ? "Show latest 30" : `Show all ${filteredExpenses.length} rows`}
              </button>
            )}
          </>
        ) : (
          <>
            {showVendorForm && (
              <form className="project-form vendor-form" onSubmit={submitVendor}>
                <label className="project-form-wide">
                  Vendor
                  <input
                    onChange={(event) => setVendorName(event.target.value)}
                    placeholder="Vendor or contractor"
                    required
                    value={vendorName}
                  />
                </label>
                <label>
                  Estimated (INR)
                  <input
                    min="0"
                    onChange={(event) => setVendorEstimate(event.target.value)}
                    required
                    step="0.01"
                    type="number"
                    value={vendorEstimate}
                  />
                </label>
                <label>
                  Pending (INR)
                  <input
                    min="0"
                    onChange={(event) => setVendorPending(event.target.value)}
                    required
                    step="0.01"
                    type="number"
                    value={vendorPending}
                  />
                </label>
                <label>
                  Status
                  <select
                    onChange={(event) => setVendorStatus(event.target.value as typeof vendorStatus)}
                    value={vendorStatus}
                  >
                    <option value="open">Open</option>
                    <option value="settled">Settled</option>
                    <option value="unknown">Needs update</option>
                  </select>
                </label>
                <div className="project-form-actions">
                  <button disabled={vendorMutation.isPending} type="submit">
                    {editingVendor ? "Save vendor" : "Add vendor"}
                  </button>
                  <button onClick={() => setShowVendorForm(false)} type="button">
                    Cancel
                  </button>
                </div>
                {(formError || vendorMutation.error) && (
                  <p className="form-error">{formError ?? vendorMutation.error?.message}</p>
                )}
              </form>
            )}
            <div className="project-table-wrap">
              <table className="project-table vendor-table">
                <thead>
                  <tr>
                    <th>Vendor / Contractor</th>
                    <th>Estimated</th>
                    <th>Pending</th>
                    <th>Paid / Covered</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.commitments.map((commitment) => (
                    <tr key={commitment.id}>
                      <td>
                        <strong>{commitment.vendorName}</strong>
                        <span>Imported commitment</span>
                      </td>
                      <td>{money(commitment.estimatedPaise)}</td>
                      <td className={commitment.pendingPaise > 0 ? "project-pending" : ""}>
                        {money(commitment.pendingPaise)}
                      </td>
                      <td>{money(Math.max(0, commitment.estimatedPaise - commitment.pendingPaise))}</td>
                      <td>
                        <span className={`review-pill ${commitment.status}`}>{commitment.status}</span>
                      </td>
                      <td>
                        <div className="project-row-actions">
                          {commitment.status !== "settled" && (
                            <button
                              onClick={() =>
                                updateProjectCommitment(commitment.id, { pendingPaise: 0, status: "settled" }).then(
                                  refreshProjects,
                                )
                              }
                              type="button"
                            >
                              Mark settled
                            </button>
                          )}
                          <button onClick={() => beginVendor(commitment)} type="button">
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </article>
    </section>
  );
}
