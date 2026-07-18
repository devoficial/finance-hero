import type { DashboardResponse, ExpenseYearResponse } from "@finance-hero/contracts";

interface ExpensesViewProps {
  year: string;
  selectedMonth: string;
  yearData?: ExpenseYearResponse;
  selectedDashboard?: DashboardResponse;
  loading: boolean;
  money: (paise: number) => string;
  onYearChange: (year: string) => void;
  onSelectMonth: (month: string) => void;
  onOpenStatement: (month: string) => void;
}

const pieColors = ["#173f35", "#f4b942", "#d64b35", "#32765e", "#8f6a3d", "#8ca99c", "#d49a75"];

function monthName(month: string, style: "long" | "short" = "long") {
  return new Intl.DateTimeFormat("en-IN", { month: style, timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

function CategoryPie({ dashboard, money }: { dashboard: DashboardResponse; money: (paise: number) => string }) {
  let cursor = 0;
  const segments = dashboard.categories.map((category, index) => {
    const start = cursor;
    cursor += dashboard.regularExpensePaise > 0 ? (category.amountPaise / dashboard.regularExpensePaise) * 360 : 0;
    return `${pieColors[index % pieColors.length]} ${start}deg ${cursor}deg`;
  });

  return (
    <div
      aria-label={`Expense category pie chart. Total ${money(dashboard.regularExpensePaise)}`}
      className="category-pie"
      role="img"
      style={{ background: segments.length > 0 ? `conic-gradient(${segments.join(", ")})` : "#d9d8d0" }}
    >
      <div>
        <strong>{money(dashboard.regularExpensePaise)}</strong>
        <span>month total</span>
      </div>
    </div>
  );
}

export function ExpensesView({
  year,
  selectedMonth,
  yearData,
  selectedDashboard,
  loading,
  money,
  onYearChange,
  onSelectMonth,
  onOpenStatement,
}: ExpensesViewProps) {
  if (loading || !yearData || !selectedDashboard) {
    return <section className="panel loading-panel">Building the monthly expense register...</section>;
  }

  const spentYtd = yearData.months.reduce((sum, month) => sum + month.regularExpensePaise, 0);
  const budgetYtd = yearData.months.reduce((sum, month) => sum + month.regularBudgetPaise, 0);
  const trackedMonths = yearData.months.filter((month) => month.transactionCount > 0).length;

  return (
    <>
      <section className="expense-overview-grid" aria-label="Annual expense summary">
        <article className="metric-card">
          <span>Recorded in {year}</span>
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
          <strong>{money(selectedDashboard.regularExpensePaise)}</strong>
          <small>{selectedDashboard.transactionCount} ledger records</small>
        </article>
      </section>

      <article className="panel expense-year-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">DAILY EXPENSE REGISTER / 12 MONTHS</p>
            <h2>{year} monthly cards</h2>
          </div>
          <label>
            <span>Year</span>
            <select value={year} onChange={(event) => onYearChange(event.target.value)}>
              <option>2026</option>
              <option>2025</option>
            </select>
          </label>
        </div>

        <div className="expense-month-grid">
          {yearData.months.map((month) => {
            const imported = month.transactionCount > 0 || month.regularBudgetPaise > 0;
            return (
              <button
                className={`month-card ${month.month === selectedMonth ? "selected" : ""} ${imported ? "has-data" : "empty"}`}
                key={month.month}
                onClick={() => {
                  onSelectMonth(month.month);
                  onOpenStatement(month.month);
                }}
                type="button"
              >
                <div>
                  <span>{monthName(month.month, "short").toUpperCase()}</span>
                  <small>{imported ? `${month.transactionCount} entries` : "Awaiting import"}</small>
                </div>
                <strong>{imported ? money(month.regularExpensePaise) : "Not imported"}</strong>
                <div className="progress-track">
                  <i style={{ width: `${Math.min(100, month.budgetUsedPercentage)}%` }} />
                </div>
                <footer>
                  <span>
                    {imported && month.regularBudgetPaise > 0
                      ? `Budget ${money(month.regularBudgetPaise)}`
                      : "No source data"}
                  </span>
                  <b>{imported && month.budgetUsedPercentage > 0 ? `${month.budgetUsedPercentage}%` : "OPEN →"}</b>
                </footer>
              </button>
            );
          })}
        </div>
      </article>

      <article className="panel selected-expense-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">SELECTED MONTH / {selectedMonth}</p>
            <h2>{monthName(selectedMonth)} expense breakdown</h2>
          </div>
          <button className="statement-button" onClick={() => onOpenStatement(selectedMonth)} type="button">
            Open detailed statement
          </button>
        </div>

        {selectedDashboard.categories.length > 0 ? (
          <div className="expense-detail-grid">
            <CategoryPie dashboard={selectedDashboard} money={money} />
            <div className="category-list expense-category-list">
              {selectedDashboard.categories.map((category, index) => {
                const percentage = Math.round((category.amountPaise / selectedDashboard.regularExpensePaise) * 100);
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
        ) : (
          <div className="empty-month-state">
            <strong>No ledger entries for {monthName(selectedMonth)}.</strong>
            <span>The card remains available so transactions and a budget can be added later.</span>
          </div>
        )}
      </article>
    </>
  );
}
