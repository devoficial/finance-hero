import type {
  DashboardResponse,
  ExpenseYearResponse,
  LiabilitiesResponse,
  WealthResponse,
} from "@finance-hero/contracts";

interface DashboardViewProps {
  dataCutoffMonth: string;
  dashboard?: DashboardResponse;
  expenseYear?: ExpenseYearResponse;
  liabilities?: LiabilitiesResponse;
  wealth?: WealthResponse;
  loading: boolean;
  money: (paise: number) => string;
  onOpenExpenses: () => void;
  onOpenGoals: () => void;
  onOpenLiabilities: () => void;
}

function percentage(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function monthLabel(month: string, style: "short" | "long" = "short") {
  return new Intl.DateTimeFormat("en-IN", { month: style, timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

function dateLabel(date: string | null) {
  if (!date) return "from tracked cash movement";
  return `as of ${new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`))}`;
}

function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

function currentDay(): number {
  return Number(
    new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      timeZone: "Asia/Kolkata",
    }).format(new Date()),
  );
}

function productName(productType: string) {
  return productType.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function DashboardView({
  dataCutoffMonth,
  dashboard,
  expenseYear,
  liabilities,
  wealth,
  loading,
  money,
  onOpenExpenses,
  onOpenGoals,
  onOpenLiabilities,
}: DashboardViewProps) {
  if (loading || !dashboard || !liabilities || !expenseYear || !wealth) {
    return <section className="panel loading-panel">Calculating your financial position...</section>;
  }

  const income = dashboard.plannedIncomePaise;
  const historical = dashboard.month < currentMonth();
  const displayedEmiPaise = historical
    ? (dashboard.expenseCategories.find((category) => category.id === "category-emi-payments")?.amountPaise ?? 0)
    : dashboard.totalEmiPaise;
  const currentCashPaise = dashboard.cashBalancePaise;
  const positiveCashPaise = Math.max(0, currentCashPaise);
  const trackedFundsPaise = Math.max(1, dashboard.cashOutflowPaise + positiveCashPaise);
  const emiBurden = percentage(displayedEmiPaise, income);
  const expenseShare = percentage(dashboard.totalExpensePaise, trackedFundsPaise);
  const debtPaymentShare = percentage(dashboard.debtPaymentPaise, trackedFundsPaise);
  const assetBuildingShare = percentage(dashboard.assetBuildingPaise, trackedFundsPaise);
  const cashRemainingShare = percentage(positiveCashPaise, trackedFundsPaise);
  const budgetExceeded = dashboard.budgetUsedPercentage > 100;
  const lowCash = income > 0 && currentCashPaise <= income * 0.1;
  const financialRisk = dashboard.dangerAlert || budgetExceeded || lowCash;
  const budgetVariancePaise = dashboard.regularBudgetPaise - dashboard.regularExpensePaise;
  const [dashboardYear, dashboardMonth] = dashboard.month.split("-").map(Number);
  const dayOfMonth = historical
    ? new Date(Date.UTC(dashboardYear ?? 2026, dashboardMonth ?? 1, 0)).getUTCDate()
    : currentDay();
  const thresholdPaise = Math.round(dashboard.regularBudgetPaise * 0.6);
  const thresholdVariancePaise = thresholdPaise - dashboard.regularExpensePaise;
  const monthStart = !historical && dayOfMonth <= 5;
  const receivableCoverage = percentage(liabilities.receivablePaise, liabilities.otherLiabilityPaise);
  const snowballTarget = liabilities.liabilities.find((liability) => liability.snowballRank === 1);
  const goalTargetPaise = wealth.goals.reduce((sum, goal) => sum + goal.targetPaise, 0);
  const goalAllocatedPaise = wealth.goals.reduce((sum, goal) => sum + goal.allocatedPaise, 0);
  const goalFundingPercentage = percentage(goalAllocatedPaise, goalTargetPaise);
  const largestLiability = liabilities.liabilities
    .filter((liability) => liability.status === "active")
    .toSorted((left, right) => right.currentPrincipalPaise - left.currentPrincipalPaise)[0];
  const categoryMaximum = Math.max(1, ...dashboard.expenseCategories.map((category) => category.amountPaise));
  const importedMonths = expenseYear.months.filter((month) => month.transactionCount > 0);
  const elapsedMonths = expenseYear.months.filter((month) => month.month <= dataCutoffMonth);
  const importedElapsedMonths = elapsedMonths.filter((month) => month.transactionCount > 0);
  const trendMaximum = Math.max(1, ...importedMonths.map((month) => month.cashOutflowPaise));
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
    { label: "Actual expenses", amountPaise: dashboard.totalExpensePaise, share: expenseShare, color: "#c88646" },
    { label: "Debt payments", amountPaise: dashboard.debtPaymentPaise, share: debtPaymentShare, color: "var(--red)" },
    {
      label: "Asset building",
      amountPaise: dashboard.assetBuildingPaise,
      share: assetBuildingShare,
      color: "#2f6f8f",
    },
    {
      label: currentCashPaise < 0 ? "Axis overdraft" : "Current Axis balance",
      amountPaise: currentCashPaise,
      share: cashRemainingShare,
      color: "var(--green-bright)",
    },
  ];
  const expenseAngle = (dashboard.totalExpensePaise / trackedFundsPaise) * 360;
  const debtAngle = (dashboard.debtPaymentPaise / trackedFundsPaise) * 360;
  const assetAngle = (dashboard.assetBuildingPaise / trackedFundsPaise) * 360;
  const allocationStyle = {
    background: `conic-gradient(#c88646 0 ${expenseAngle}deg, var(--red) ${expenseAngle}deg ${expenseAngle + debtAngle}deg, #2f6f8f ${expenseAngle + debtAngle}deg ${expenseAngle + debtAngle + assetAngle}deg, var(--green-bright) ${expenseAngle + debtAngle + assetAngle}deg 360deg)`,
  };

  return (
    <>
      <section className={`financial-signal ${financialRisk ? "danger" : "stable"}`}>
        <div>
          <span>MONTHLY FINANCIAL SIGNAL</span>
          <strong>
            {dashboard.dangerAlert
              ? "Spending intervention required"
              : budgetExceeded
                ? "Regular expense budget exceeded"
                : lowCash
                  ? "Cash reserve is running low"
                  : "Cash flow is within plan"}
          </strong>
        </div>
        <p>
          {dashboard.dangerAlert
            ? `${money(dashboard.regularExpensePaise)} is already spent: ${money(
                Math.abs(thresholdVariancePaise),
              )} beyond the 60% early-warning line before day 20.`
            : budgetExceeded
              ? `Regular spending is ${money(dashboard.regularExpensePaise)} against ${money(
                  dashboard.regularBudgetPaise,
                )}; the budget is exceeded by ${money(Math.abs(budgetVariancePaise))}. Axis cash is ${money(
                  currentCashPaise,
                )}.`
              : `${dashboard.budgetUsedPercentage}% of the regular budget is used. Current Axis cash is ${money(
                  currentCashPaise,
                )}.`}
        </p>
        <button onClick={onOpenExpenses} type="button">
          Open expense register
        </button>
      </section>

      <section className={`month-command-brief ${dashboard.dangerAlert ? "danger" : ""}`}>
        <header>
          <span>{monthStart ? "MONTH-START BRIEF" : "MONTHLY CHECKPOINT"}</span>
          <strong>{monthLabel(dashboard.month, "long")} in one line</strong>
        </header>
        <div>
          <span>Bank cash</span>
          <strong>{money(currentCashPaise)}</strong>
          <small>{dashboard.cashBalanceSource === "bank_statement" ? "confirmed" : "calculated"}</small>
        </div>
        <div className={budgetVariancePaise < 0 ? "negative" : ""}>
          <span>Regular budget</span>
          <strong>{money(Math.abs(budgetVariancePaise))}</strong>
          <small>{budgetVariancePaise < 0 ? "over plan" : "still available"}</small>
        </div>
        <div>
          <span>Fixed EMI</span>
          <strong className="liability-value">{money(displayedEmiPaise)}</strong>
          <small>{emiBurden}% of planned income</small>
        </div>
        <div>
          <span>Debt focus</span>
          <strong>{snowballTarget?.name ?? "No active target"}</strong>
          <small className={snowballTarget ? "liability-value" : ""}>
            {snowballTarget ? money(snowballTarget.currentPrincipalPaise) : "Nothing queued"}
          </small>
        </div>
      </section>

      <section className="finance-kpi-grid" aria-label="Core financial indicators">
        <article className="finance-kpi primary">
          <span>Current Axis balance</span>
          <strong>{money(dashboard.cashBalancePaise)}</strong>
          <div>
            <b>{dashboard.cashBalanceSource === "bank_statement" ? "Bank confirmed" : "Calculated"}</b>
            <small>{dateLabel(dashboard.cashBalanceAsOf)}</small>
          </div>
        </article>
        <article className={`finance-kpi ${emiBurden >= 40 ? "critical" : ""}`}>
          <span>{historical ? "Recorded EMI payments" : "Scheduled EMI burden"}</span>
          <strong>{emiBurden}%</strong>
          <div>
            <b className="liability-value">{money(displayedEmiPaise)}</b>
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
          <strong className="liability-value">{money(liabilities.netObligationPaise)}</strong>
          <div>
            <b>{liabilities.activeCount} accounts</b>
            <small>bank debt plus personal balances</small>
          </div>
        </article>
      </section>

      <section className="dashboard-wealth-strip" aria-label="Savings and goal position">
        <div>
          <span>TRACKED ASSETS</span>
          <strong>{money(wealth.totalAssetPaise)}</strong>
          <small>{money(wealth.restrictedWalletPaise)} is food-wallet spending balance</small>
        </div>
        <div>
          <span>GOAL CAPITAL</span>
          <strong>{money(goalAllocatedPaise)}</strong>
          <small>{goalFundingPercentage}% of combined goal targets</small>
        </div>
        <div className={wealth.netWorthPaise < 0 ? "negative" : ""}>
          <span>TRACKED NET WORTH</span>
          <strong>{money(wealth.netWorthPaise)}</strong>
          <small>Assets and receivables less all obligations</small>
        </div>
        <button onClick={onOpenGoals} type="button">
          Open savings &amp; goals
        </button>
      </section>

      <section className="dashboard-chart-grid">
        <article className="panel allocation-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">CASH ALLOCATION / {monthLabel(dashboard.month, "long").toUpperCase()}</p>
              <h2>Where tracked cash went</h2>
            </div>
            <span className="live-pill">{money(trackedFundsPaise)} TRACKED</span>
          </div>
          <div className="allocation-content">
            <div className="allocation-donut" style={allocationStyle} role="img" aria-label="Monthly cash allocation">
              <div>
                <strong>{cashRemainingShare}%</strong>
                <span>{currentCashPaise < 0 ? "overdrawn" : "cash left"}</span>
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
            <span>Monthly cash movement</span>
            <strong>{money(dashboard.cashOutflowPaise)} tracked outflow</strong>
            <small>
              Includes {money(dashboard.debtPaymentPaise)} debt payments and {money(dashboard.assetBuildingPaise)}{" "}
              toward assets. Current reconciled Axis cash is {money(currentCashPaise)}.
            </small>
          </div>
        </article>

        <article className="panel trend-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">12-MONTH CASH-FLOW VIEW / {expenseYear.year}</p>
              <h2>Tracked outflow trend</h2>
            </div>
            <button className="text-action" onClick={onOpenExpenses} type="button">
              Open expenses
            </button>
          </div>
          <div className="expense-trend-chart" role="img" aria-label={`${expenseYear.year} monthly expense chart`}>
            {expenseYear.months.map((month) => {
              const hasData = month.transactionCount > 0;
              const future = month.month > dataCutoffMonth;
              const height = hasData ? Math.max(8, (month.cashOutflowPaise / trendMaximum) * 100) : 3;
              return (
                <div className={month.month === dashboard.month ? "current" : ""} key={month.month}>
                  <span>{hasData ? money(month.cashOutflowPaise) : future ? "Upcoming" : "Not imported"}</span>
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
            <strong>Current outflow: {money(dashboard.cashOutflowPaise)}</strong>
          </footer>
        </article>
      </section>

      <section className="dashboard-detail-grid">
        <article className="panel category-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">CASH-FLOW CONTROL / LIVE CATEGORIES</p>
              <h2>What is driving outflow</h2>
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
                <small>{percentage(category.amountPaise, dashboard.cashOutflowPaise)}%</small>
              </div>
            ))}
          </div>
          <button className="dashboard-expenses-button" onClick={onOpenExpenses} type="button">
            Review expense categories
          </button>
        </article>

        <article className="panel portfolio-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">DEBT PORTFOLIO / SNOWBALL</p>
              <h2 className="liability-value">{money(liabilities.totalPrincipalPaise)}</h2>
            </div>
            <span className="risk-pill">{liabilities.activeCount} ACTIVE</span>
          </div>
          <div className="portfolio-bars">
            {liabilityTypes.map((group) => (
              <div key={group.type}>
                <span>{productName(group.type)}</span>
                <strong className="liability-value">{money(group.amountPaise)}</strong>
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
              <small className="liability-value">{money(largestLiability?.currentPrincipalPaise ?? 0)}</small>
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
                <span className="liability-value">{money(snowballTarget.currentPrincipalPaise)}</span> outstanding · EMI{" "}
                <span className="liability-value">{money(snowballTarget.emiPaise)}</span>
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
