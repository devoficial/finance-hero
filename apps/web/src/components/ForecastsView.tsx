import type {
  DashboardResponse,
  LiabilitiesResponse,
  ProjectSummaryResponse,
  WealthResponse,
} from "@finance-hero/contracts";
import { useMemo, useState } from "react";
import { buildTwelveMonthForecast } from "../lib/forecast";

interface ForecastsViewProps {
  dashboard?: DashboardResponse;
  liabilities?: LiabilitiesResponse;
  wealth?: WealthResponse;
  homeConstruction?: ProjectSummaryResponse;
  loading: boolean;
  money: (paise: number) => string;
  month: string;
}

function monthLabel(month: string, includeYear = false): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    ...(includeYear ? { year: "2-digit" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function percentage(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function paiseFromRupees(value: string): number {
  const paise = Math.round(Number(value) * 100);
  return Number.isSafeInteger(paise) && paise >= 0 ? paise : 0;
}

export function ForecastsView({
  dashboard,
  liabilities,
  wealth,
  homeConstruction,
  loading,
  money,
  month,
}: ForecastsViewProps) {
  const [extraDebtPayment, setExtraDebtPayment] = useState("0");
  const [incomeGrowth, setIncomeGrowth] = useState("0");
  const [expenseInflation, setExpenseInflation] = useState("5");

  const forecast = useMemo(() => {
    if (!dashboard || !liabilities || !wealth) {
      return null;
    }
    return buildTwelveMonthForecast({
      startMonth: month,
      plannedIncomePaise: dashboard.plannedIncomePaise,
      regularExpensePaise: dashboard.regularBudgetPaise,
      currentAssetPaise: wealth.totalAssetPaise,
      receivablePaise: liabilities.receivablePaise,
      personalPayablePaise: liabilities.otherLiabilityPaise,
      debts: liabilities.liabilities
        .filter((liability) => liability.status === "active" && liability.currentPrincipalPaise > 0)
        .map((liability) => ({
          id: liability.id,
          name: liability.name,
          principalPaise: liability.currentPrincipalPaise,
          emiPaise: liability.emiPaise,
          annualRateBps: liability.annualRateBps,
        })),
      extraDebtPaymentPaise: paiseFromRupees(extraDebtPayment),
      annualIncomeGrowthPercentage: Number(incomeGrowth) || 0,
      annualExpenseInflationPercentage: Number(expenseInflation) || 0,
    });
  }, [dashboard, expenseInflation, extraDebtPayment, incomeGrowth, liabilities, month, wealth]);

  if (loading || !dashboard || !liabilities || !wealth || !forecast) {
    return <section className="panel loading-panel">Building the 12-month outlook...</section>;
  }

  const finalMonth = forecast.months.at(-1);
  const netWorthChange = (finalMonth?.projectedNetWorthPaise ?? wealth.netWorthPaise) - wealth.netWorthPaise;
  const debtReduction = liabilities.totalPrincipalPaise - forecast.remainingDebtPaise;
  const maxChartValue = Math.max(
    1,
    ...forecast.months.flatMap((item) => [item.projectedAssetPaise, item.remainingDebtPaise]),
  );
  const emergencyGoal = wealth.goals
    .filter((goal) => goal.status === "active")
    .toSorted((left, right) => left.priority - right.priority)
    .find(
      (goal) => goal.targetMode === "emergency_cover" || goal.name.toLocaleLowerCase("en-IN").includes("emergency"),
    );
  const emergencyCompletion = emergencyGoal
    ? forecast.months.find(
        (item) =>
          emergencyGoal.allocatedPaise + Math.max(0, item.projectedAssetPaise - wealth.totalAssetPaise) >=
          emergencyGoal.targetPaise,
      )?.month
    : null;
  const monthlyNeedPaise = dashboard.regularBudgetPaise + dashboard.totalEmiPaise;
  const baseHeadroomPaise = dashboard.plannedIncomePaise - monthlyNeedPaise;
  const lowestCashMonth = forecast.months.toSorted((left, right) => left.cashSurplusPaise - right.cashSurplusPaise)[0];
  const monthsWithDeficit = forecast.months.filter((item) => item.cashSurplusPaise < 0).length;
  const ratesMissing = liabilities.liabilities.filter(
    (item) => item.status === "active" && item.currentPrincipalPaise > 0 && item.annualRateBps == null,
  ).length;

  return (
    <section className="forecast-workspace">
      <div className="forecast-hero">
        <div>
          <p className="eyebrow">12-MONTH FORWARD VIEW / EXPLAINABLE MODEL</p>
          <h2>See the next decision before it reaches your bank.</h2>
          <p>
            A cash-flow forecast built from your current income plan, expense budget, assets and live loan balances.
          </p>
        </div>
        <div className={`forecast-verdict ${monthsWithDeficit > 0 ? "danger" : ""}`}>
          <span>BASE CASE</span>
          <strong>{monthsWithDeficit > 0 ? `${monthsWithDeficit} deficit months` : "Positive monthly headroom"}</strong>
          <small>Lowest month: {lowestCashMonth ? money(lowestCashMonth.cashSurplusPaise) : money(0)}</small>
        </div>
      </div>

      <div className="forecast-controls panel">
        <div>
          <p className="eyebrow">SCENARIO CONTROLS</p>
          <h3>Change the assumptions</h3>
        </div>
        <label>
          Extra debt payment / month
          <span>
            <b>Rs</b>
            <input
              min="0"
              onChange={(event) => setExtraDebtPayment(event.target.value)}
              step="500"
              type="number"
              value={extraDebtPayment}
            />
          </span>
        </label>
        <label>
          Annual income growth
          <span>
            <input
              max="30"
              min="-20"
              onChange={(event) => setIncomeGrowth(event.target.value)}
              step="0.5"
              type="number"
              value={incomeGrowth}
            />
            <b>%</b>
          </span>
        </label>
        <label>
          Annual expense inflation
          <span>
            <input
              max="30"
              min="0"
              onChange={(event) => setExpenseInflation(event.target.value)}
              step="0.5"
              type="number"
              value={expenseInflation}
            />
            <b>%</b>
          </span>
        </label>
        <div className="forecast-presets">
          {[0, 5000, 10000, 25000].map((amount) => (
            <button
              className={Number(extraDebtPayment) === amount ? "active" : ""}
              key={amount}
              onClick={() => setExtraDebtPayment(String(amount))}
              type="button"
            >
              {amount === 0 ? "Minimum EMI" : `+ Rs ${amount / 1000}k`}
            </button>
          ))}
        </div>
      </div>

      <div className="forecast-kpis">
        <article>
          <span>12-MONTH NET WORTH</span>
          <strong className={(finalMonth?.projectedNetWorthPaise ?? 0) < 0 ? "negative" : ""}>
            {money(finalMonth?.projectedNetWorthPaise ?? wealth.netWorthPaise)}
          </strong>
          <small>
            {netWorthChange >= 0 ? "+" : ""}
            {money(netWorthChange)} change
          </small>
        </article>
        <article>
          <span>DEBT REDUCTION</span>
          <strong>{money(debtReduction)}</strong>
          <small>{percentage(debtReduction, liabilities.totalPrincipalPaise)}% of current bank principal</small>
        </article>
        <article>
          <span>PROJECTED ASSETS</span>
          <strong>{money(forecast.projectedAssetPaise)}</strong>
          <small>{money(forecast.cumulativeSurplusPaise)} retained cash flow</small>
        </article>
        <article>
          <span>EMERGENCY FUND</span>
          <strong>{emergencyCompletion ? monthLabel(emergencyCompletion, true) : "Beyond 12 mo"}</strong>
          <small>
            {emergencyGoal
              ? `${percentage(emergencyGoal.allocatedPaise, emergencyGoal.targetPaise)}% funded today`
              : "Add an emergency-cover goal"}
          </small>
        </article>
      </div>

      <div className="forecast-main-grid">
        <article className="panel forecast-chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ASSET VS DEBT TRAJECTORY</p>
              <h2>Twelve checkpoints</h2>
            </div>
            <div className="forecast-legend">
              <span>
                <i className="asset" />
                Assets
              </span>
              <span>
                <i className="debt" />
                Bank debt
              </span>
            </div>
          </div>
          <div className="forecast-chart">
            {forecast.months.map((item) => (
              <div className="forecast-chart-month" key={item.month}>
                <div className="forecast-bars">
                  <i
                    className="asset"
                    style={{ height: `${Math.max(2, (item.projectedAssetPaise / maxChartValue) * 100)}%` }}
                    title={`Assets ${money(item.projectedAssetPaise)}`}
                  />
                  <i
                    className="debt"
                    style={{ height: `${Math.max(2, (item.remainingDebtPaise / maxChartValue) * 100)}%` }}
                    title={`Debt ${money(item.remainingDebtPaise)}`}
                  />
                </div>
                <b>{monthLabel(item.month)}</b>
                <small className={item.projectedNetWorthPaise < 0 ? "negative" : ""}>
                  {money(item.projectedNetWorthPaise)}
                </small>
              </div>
            ))}
          </div>
        </article>

        <aside className="panel forecast-risk-panel">
          <div>
            <p className="eyebrow">RISK RADAR</p>
            <h2>What can move the result</h2>
          </div>
          <div className="forecast-risk-item">
            <span>Fixed monthly need</span>
            <strong>{money(monthlyNeedPaise)}</strong>
            <small>{percentage(monthlyNeedPaise, dashboard.plannedIncomePaise)}% of planned income</small>
          </div>
          <div
            className={homeConstruction?.pendingCommitmentPaise ? "forecast-risk-item warning" : "forecast-risk-item"}
          >
            <span>Construction exposure</span>
            <strong>{money(homeConstruction?.pendingCommitmentPaise ?? 0)}</strong>
            <small>Held outside this base case until payment timing is known</small>
          </div>
          <div className={ratesMissing > 0 ? "forecast-risk-item warning" : "forecast-risk-item"}>
            <span>Unknown loan rates</span>
            <strong>{ratesMissing}</strong>
            <small>
              {ratesMissing > 0 ? "Modelled at 0%; actual interest may be higher" : "All active rates available"}
            </small>
          </div>
          <div className={baseHeadroomPaise < 0 ? "forecast-risk-item danger" : "forecast-risk-item"}>
            <span>Starting monthly headroom</span>
            <strong>{money(baseHeadroomPaise)}</strong>
            <small>Before optional extra debt payment</small>
          </div>
        </aside>
      </div>

      <article className="panel forecast-table-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">MONTH-BY-MONTH MODEL</p>
            <h2>Forecast ledger</h2>
          </div>
          <span className="live-pill">INR / NOMINAL</span>
        </div>
        <div className="forecast-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Income</th>
                <th>Regular budget</th>
                <th>Debt payment</th>
                <th>Interest</th>
                <th>Cash surplus</th>
                <th>Assets</th>
                <th>Debt left</th>
                <th>Net worth</th>
              </tr>
            </thead>
            <tbody>
              {forecast.months.map((item) => (
                <tr key={item.month}>
                  <th>{monthLabel(item.month, true)}</th>
                  <td>{money(item.incomePaise)}</td>
                  <td>{money(item.regularExpensePaise)}</td>
                  <td>{money(item.debtPaymentPaise)}</td>
                  <td>{money(item.interestPaise)}</td>
                  <td className={item.cashSurplusPaise < 0 ? "negative" : "positive"}>
                    {money(item.cashSurplusPaise)}
                  </td>
                  <td>{money(item.projectedAssetPaise)}</td>
                  <td>{money(item.remainingDebtPaise)}</td>
                  <td className={item.projectedNetWorthPaise < 0 ? "negative" : ""}>
                    {money(item.projectedNetWorthPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <div className="forecast-assumptions">
        <strong>MODEL BOUNDARY</strong>
        <span>Income repeats from the selected monthly plan and grows by your scenario rate.</span>
        <span>Expenses begin at the regular budget, not the current partial-month spend.</span>
        <span>All cash surplus stays in tracked assets; no investment return or tax is assumed.</span>
        <span>Loan rates use current stored values; unknown rates are conservatively flagged.</span>
      </div>
    </section>
  );
}
