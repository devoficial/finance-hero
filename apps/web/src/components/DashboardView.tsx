import type { DashboardResponse, ExpenseYearResponse, LiabilitiesResponse } from "@finance-hero/contracts";

interface DashboardViewProps {
  dataCutoffMonth: string;
  dashboard?: DashboardResponse;
  expenseYear?: ExpenseYearResponse;
  liabilities?: LiabilitiesResponse;
  loading: boolean;
  money: (paise: number) => string;
  onOpenLedger: () => void;
  onOpenExpenses: () => void;
  onOpenLiabilities: () => void;
}

function percentage(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function monthLabel(month: string, style: "short" | "long" = "short") {
  return new Intl.DateTimeFormat("en-IN", { month: style, timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

function productName(productType: string) {
  return productType.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function DashboardView({
  dataCutoffMonth,
  dashboard,
  expenseYear,
  liabilities,
  loading,
  money,
  onOpenLedger,
  onOpenExpenses,
  onOpenLiabilities,
}: DashboardViewProps) {
  if (loading || !dashboard || !liabilities || !expenseYear) {
    return <section className="panel loading-panel">Calculating your financial position...</section>;
  }

  const income = dashboard.plannedIncomePaise;
  const available = Math.max(0, dashboard.availableAfterPlanPaise);
  const emiBurden = percentage(dashboard.totalEmiPaise, income);
  const expenseShare = percentage(dashboard.totalExpensePaise, income);
  const surplusRate = percentage(available, income);
  const receivableCoverage = percentage(liabilities.receivablePaise, liabilities.otherLiabilityPaise);
  const snowballTarget = liabilities.liabilities.find((liability) => liability.snowballRank === 1);
  const largestLiability = liabilities.liabilities
    .filter((liability) => liability.status === "active")
    .toSorted((left, right) => right.currentPrincipalPaise - left.currentPrincipalPaise)[0];
  const categoryMaximum = Math.max(1, ...dashboard.expenseCategories.map((category) => category.amountPaise));
  const importedMonths = expenseYear.months.filter((month) => month.transactionCount > 0);
  const elapsedMonths = expenseYear.months.filter((month) => month.month <= dataCutoffMonth);
  const importedElapsedMonths = elapsedMonths.filter((month) => month.transactionCount > 0);
  const trendMaximum = Math.max(1, ...importedMonths.map((month) => month.totalExpensePaise));
  const liabilityTypes = Array.from(
    liabilities.liabilities
      .filter((liability) => liability.status === "active" && liability.currentPrincipalPaise > 0)
      .reduce((groups, liability) => {
        groups.set(liability.productType, (groups.get(liability.productType) ?? 0) + liability.currentPrincipalPaise);
        return groups;
      }, new Map<string, number>()),
  )
    .map(([type, amountPaise]) => ({ type, amountPaise }))
    .toSorted((left, right) => right.amountPaise - left.amountPaise);
  const allocationSegments = [
    { label: "EMIs", amountPaise: dashboard.totalEmiPaise, share: emiBurden, color: "var(--red)" },
    { label: "Tracked expenses", amountPaise: dashboard.totalExpensePaise, share: expenseShare, color: "#c88646" },
    { label: "Available", amountPaise: available, share: surplusRate, color: "var(--green-bright)" },
  ];
  const allocationTotal = Math.max(1, income, dashboard.totalEmiPaise + dashboard.totalExpensePaise + available);
  const emiAngle = (dashboard.totalEmiPaise / allocationTotal) * 360;
  const expenseAngle = (dashboard.totalExpensePaise / allocationTotal) * 360;
  const allocationStyle = {
    background: `conic-gradient(var(--red) 0 ${emiAngle}deg, #c88646 ${emiAngle}deg ${emiAngle + expenseAngle}deg, var(--green-bright) ${emiAngle + expenseAngle}deg 360deg)`,
  };

  return (
    <>
      <section className={`financial-signal ${dashboard.dangerAlert ? "danger" : "stable"}`}>
        <div>
          <span>MONTHLY FINANCIAL SIGNAL</span>
          <strong>{dashboard.dangerAlert ? "Spending intervention required" : "Cash flow is within plan"}</strong>
        </div>
        <p>
          {dashboard.dangerAlert
            ? `${dashboard.budgetUsedPercentage}% of the regular budget is already consumed before day 20.`
            : `${dashboard.budgetUsedPercentage}% of the regular budget is used with ${money(available)} still available.`}
        </p>
        <button onClick={onOpenLedger} type="button">
          Inspect ledger
        </button>
      </section>

      <section className="finance-kpi-grid" aria-label="Core financial indicators">
        <article className="finance-kpi primary">
          <span>Available after plan</span>
          <strong>{money(dashboard.availableAfterPlanPaise)}</strong>
          <div>
            <b>{surplusRate}%</b>
            <small>of planned income remains</small>
          </div>
        </article>
        <article className={`finance-kpi ${emiBurden >= 40 ? "critical" : ""}`}>
          <span>EMI burden</span>
          <strong>{emiBurden}%</strong>
          <div>
            <b>{money(dashboard.totalEmiPaise)}</b>
            <small>{emiBurden >= 40 ? "High fixed commitment" : "of monthly income"}</small>
          </div>
        </article>
        <article className={`finance-kpi ${dashboard.budgetUsedPercentage >= 60 ? "warning" : ""}`}>
          <span>Expense budget used</span>
          <strong>{dashboard.budgetUsedPercentage}%</strong>
          <div>
            <b>{money(dashboard.regularExpensePaise)}</b>
            <small>of {money(dashboard.regularBudgetPaise)}</small>
          </div>
        </article>
        <article className="finance-kpi debt">
          <span>Net obligations</span>
          <strong>{money(liabilities.netObligationPaise)}</strong>
          <div>
            <b>{liabilities.activeCount} accounts</b>
            <small>bank debt plus personal balances</small>
          </div>
        </article>
      </section>

      <section className="dashboard-chart-grid">
        <article className="panel allocation-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">INCOME ALLOCATION / {monthLabel(dashboard.month, "long").toUpperCase()}</p>
              <h2>Where each rupee is going</h2>
            </div>
            <span className="live-pill">{money(income)} PLAN</span>
          </div>
          <div className="allocation-content">
            <div className="allocation-donut" style={allocationStyle} role="img" aria-label="Monthly income allocation">
              <div>
                <strong>{surplusRate}%</strong>
                <span>available</span>
              </div>
            </div>
            <div className="allocation-legend">
              {allocationSegments.map((segment) => (
                <div key={segment.label}>
                  <i style={{ background: segment.color }} />
                  <span>{segment.label}</span>
                  <strong>{money(segment.amountPaise)}</strong>
                  <small>{segment.share}%</small>
                </div>
              ))}
            </div>
          </div>
          <div className="allocation-callout">
            <span>Fixed commitments consume</span>
            <strong>{emiBurden}% of monthly income</strong>
            <small>Reducing EMI load has the largest impact on monthly flexibility.</small>
          </div>
        </article>

        <article className="panel trend-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">12-MONTH EXPENSE VIEW / {expenseYear.year}</p>
              <h2>Tracked spending trend</h2>
            </div>
            <button className="text-action" onClick={onOpenExpenses} type="button">
              Open expenses
            </button>
          </div>
          <div className="expense-trend-chart" role="img" aria-label={`${expenseYear.year} monthly expense chart`}>
            {expenseYear.months.map((month) => {
              const hasData = month.transactionCount > 0;
              const future = month.month > dataCutoffMonth;
              const height = hasData ? Math.max(8, (month.totalExpensePaise / trendMaximum) * 100) : 3;
              return (
                <div className={month.month === dashboard.month ? "current" : ""} key={month.month}>
                  <span>{hasData ? money(month.totalExpensePaise) : future ? "Upcoming" : "Not imported"}</span>
                  <i className={hasData ? "imported" : "empty"} style={{ height: `${height}%` }} />
                  <b>{monthLabel(month.month).slice(0, 3)}</b>
                </div>
              );
            })}
          </div>
          <footer className="trend-footer">
            <span>
              {importedElapsedMonths.length} of {elapsedMonths.length} elapsed months imported
            </span>
            <strong>Current: {money(dashboard.totalExpensePaise)}</strong>
          </footer>
        </article>
      </section>

      <section className="dashboard-detail-grid">
        <article className="panel category-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">SPENDING CONTROL / LIVE CATEGORIES</p>
              <h2>What is driving expenses</h2>
            </div>
            <span className="risk-pill">{dashboard.expenseCategories.length} CATEGORIES</span>
          </div>
          <div className="dashboard-category-chart">
            {dashboard.expenseCategories.map((category, index) => (
              <div key={category.id}>
                <span>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  {category.name}
                </span>
                <div>
                  <i style={{ width: `${Math.max(2, (category.amountPaise / categoryMaximum) * 100)}%` }} />
                </div>
                <strong>{money(category.amountPaise)}</strong>
                <small>{percentage(category.amountPaise, dashboard.totalExpensePaise)}%</small>
              </div>
            ))}
          </div>
          <button className="dashboard-ledger-button" onClick={onOpenLedger} type="button">
            Review category transactions
          </button>
        </article>

        <article className="panel portfolio-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">DEBT PORTFOLIO / SNOWBALL</p>
              <h2>{money(liabilities.totalPrincipalPaise)}</h2>
            </div>
            <span className="risk-pill">{liabilities.activeCount} ACTIVE</span>
          </div>
          <div className="portfolio-bars">
            {liabilityTypes.map((group) => (
              <div key={group.type}>
                <span>{productName(group.type)}</span>
                <strong>{money(group.amountPaise)}</strong>
                <div>
                  <i style={{ width: `${percentage(group.amountPaise, liabilities.totalPrincipalPaise)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="portfolio-facts">
            <div>
              <span>Largest exposure</span>
              <strong>{largestLiability?.name ?? "None"}</strong>
              <small>{money(largestLiability?.currentPrincipalPaise ?? 0)}</small>
            </div>
            <div>
              <span>Personal receivable cover</span>
              <strong>{receivableCoverage}%</strong>
              <small>{money(liabilities.receivablePaise)} to get back</small>
            </div>
          </div>
          {snowballTarget && (
            <div className="snowball-callout dashboard-snowball">
              <span>Next snowball target</span>
              <strong>{snowballTarget.name}</strong>
              <small>
                {money(snowballTarget.currentPrincipalPaise)} outstanding · EMI {money(snowballTarget.emiPaise)}
              </small>
            </div>
          )}
          <button className="portfolio-button" onClick={onOpenLiabilities} type="button">
            Manage liabilities
          </button>
        </article>
      </section>
    </>
  );
}
