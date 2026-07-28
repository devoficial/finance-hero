import type { BudgetMonthResponse, DashboardResponse, ExpenseYearResponse } from "@finance-hero/contracts";
import { useEffect, useRef } from "react";
import { BudgetEditor } from "./BudgetEditor";

interface ExpensesViewProps {
  dataCutoffMonth: string;
  year: string;
  selectedMonth: string;
  yearData?: ExpenseYearResponse;
  selectedDashboard?: DashboardResponse;
  budget?: BudgetMonthResponse;
  budgetLoading: boolean;
  loading: boolean;
  money: (paise: number) => string;
  onYearChange: (year: string) => void;
  onSelectMonth: (month: string) => void;
}

const pieColors = ["#173f35", "#f4b942", "#d64b35", "#32765e", "#8f6a3d", "#8ca99c", "#d49a75"];

function monthName(month: string, style: "long" | "short" = "long") {
  return new Intl.DateTimeFormat("en-IN", { month: style, timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

function CategoryPie({ dashboard, money }: { dashboard: DashboardResponse; money: (paise: number) => string }) {
  let cursor = 0;
  const segments = dashboard.expenseCategories.map((category, index) => {
    const start = cursor;
    cursor += dashboard.cashOutflowPaise > 0 ? (category.amountPaise / dashboard.cashOutflowPaise) * 360 : 0;
    return `${pieColors[index % pieColors.length]} ${start}deg ${cursor}deg`;
  });

  return (
    <div
      aria-label={`Cash outflow category pie chart. Total ${money(dashboard.cashOutflowPaise)}`}
      className="category-pie"
      role="img"
      style={{ background: segments.length > 0 ? `conic-gradient(${segments.join(", ")})` : "#d9d8d0" }}
    >
      <div>
        <strong>{money(dashboard.cashOutflowPaise)}</strong>
        <span>cash outflow</span>
      </div>
    </div>
  );
}

export function ExpensesView({
  dataCutoffMonth,
  year,
  selectedMonth,
  yearData,
  selectedDashboard,
  budget,
  budgetLoading,
  loading,
  money,
  onYearChange,
  onSelectMonth,
}: ExpensesViewProps) {
  const monthTabsRef = useRef<HTMLDivElement>(null);
  const currentMonth = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const historical = selectedMonth < currentMonth;
  const recordedEmiPaise = budget?.lines.find((line) => line.categoryId === "category-emi-payments")?.spentPaise ?? 0;
  useEffect(() => {
    monthTabsRef.current
      ?.querySelector<HTMLElement>(`[data-month="${selectedMonth}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selectedMonth]);

  if (loading || !yearData || !selectedDashboard) {
    return <section className="panel loading-panel">Building the monthly expense register...</section>;
  }

  const spentYtd = yearData.months.reduce((sum, month) => sum + month.cashOutflowPaise, 0);
  const budgetYtd = yearData.months.reduce((sum, month) => sum + month.regularBudgetPaise, 0);
  const trackedMonths = yearData.months.filter((month) => month.transactionCount > 0).length;

  return (
    <>
      <article className="panel expense-period-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">EXPENSE REGISTER / {year}</p>
            <h2>Choose a month</h2>
            <small>The selected month opens directly in the editable register below.</small>
          </div>
          <label>
            <span>Year</span>
            <select value={year} onChange={(event) => onYearChange(event.target.value)}>
              <option>2026</option>
              <option>2025</option>
            </select>
          </label>
        </div>

        <div aria-label={`${year} expense months`} className="expense-month-tabs" ref={monthTabsRef} role="tablist">
          {yearData.months.map((month) => {
            const imported = month.transactionCount > 0 || month.regularBudgetPaise > 0;
            const future = month.month > dataCutoffMonth;
            const selected = month.month === selectedMonth;
            return (
              <button
                aria-controls="selected-month-expense-register"
                aria-selected={selected}
                className={`expense-month-tab ${selected ? "selected" : ""} ${
                  imported ? "has-data" : future ? "future" : "empty"
                } ${month.budgetUsedPercentage > 100 ? "over-budget" : ""}`}
                data-month={month.month}
                key={month.month}
                onClick={() => {
                  onSelectMonth(month.month);
                }}
                role="tab"
                type="button"
              >
                <header>
                  <span>{monthName(month.month, "short").toUpperCase()}</span>
                  <small>
                    {imported ? `${month.transactionCount} entries` : future ? "Upcoming" : "Awaiting import"}
                  </small>
                </header>
                <strong>{imported ? money(month.cashOutflowPaise) : future ? "Upcoming" : "Not imported"}</strong>
                <footer>
                  {imported && month.regularBudgetPaise > 0
                    ? `${month.budgetUsedPercentage}% of regular budget`
                    : future
                      ? "Planning available"
                      : "Open month"}
                </footer>
              </button>
            );
          })}
        </div>
      </article>

      <div id="selected-month-expense-register" role="tabpanel">
        <BudgetEditor
          budget={budget}
          emiPaise={historical ? recordedEmiPaise : selectedDashboard.totalEmiPaise}
          historical={historical}
          key={selectedMonth}
          loading={budgetLoading}
          money={money}
        />
      </div>

      <section className="expense-overview-grid" aria-label="Annual expense summary">
        <article className="metric-card">
          <span>Cash outflow in {year}</span>
          <strong>{money(spentYtd)}</strong>
          <small>
            Across {trackedMonths} populated month{trackedMonths === 1 ? "" : "s"}
          </small>
        </article>
        <article className="metric-card">
          <span>Allocated budget</span>
          <strong>{money(budgetYtd)}</strong>
          <small>Only confirmed budgets are counted</small>
        </article>
        <article className="metric-card">
          <span>Selected month</span>
          <strong>{money(selectedDashboard.cashOutflowPaise)}</strong>
          <small>{money(selectedDashboard.totalExpensePaise)} is expense; the rest is debt or asset movement</small>
        </article>
      </section>

      <article className="panel selected-expense-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">SELECTED MONTH / {selectedMonth}</p>
            <h2>{monthName(selectedMonth)} cash-flow breakdown</h2>
          </div>
        </div>

        {selectedDashboard.expenseCategories.length > 0 ? (
          <>
            <div className="cashflow-classification">
              <div>
                <span>Actual expenses</span>
                <strong>{money(selectedDashboard.totalExpensePaise)}</strong>
                <small>Consumption and charges</small>
              </div>
              <div>
                <span>Debt payments</span>
                <strong>{money(selectedDashboard.debtPaymentPaise)}</strong>
                <small>Not counted as normal spending</small>
              </div>
              <div>
                <span>Assets and savings</span>
                <strong>{money(selectedDashboard.assetBuildingPaise)}</strong>
                <small>Construction and wealth-building</small>
              </div>
              <div>
                <span>Total cash outflow</span>
                <strong>{money(selectedDashboard.cashOutflowPaise)}</strong>
                <small>Amount that left available cash</small>
              </div>
            </div>
            <div className="expense-detail-grid">
              <CategoryPie dashboard={selectedDashboard} money={money} />
              <div className="category-list expense-category-list">
                {selectedDashboard.expenseCategories.map((category, index) => {
                  const percentage = Math.round((category.amountPaise / selectedDashboard.cashOutflowPaise) * 100);
                  return (
                    <div key={category.id}>
                      <span>
                        <i style={{ background: pieColors[index % pieColors.length] }} />
                        {category.name}
                      </span>
                      <strong>{money(category.amountPaise)}</strong>
                      <small>{percentage}%</small>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="empty-month-state">
            <strong>No expense entries for {monthName(selectedMonth)}.</strong>
            <span>The card remains available so transactions and a budget can be added later.</span>
          </div>
        )}
      </article>
    </>
  );
}
