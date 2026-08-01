import type {
  DashboardResponse,
  LiabilitiesResponse,
  ProjectSummaryResponse,
  WealthResponse,
} from "@finance-hero/contracts";
import { useEffect, useMemo, useState } from "react";
import { buildTwelveMonthForecast } from "../lib/forecast";

interface ForecastsViewProps {
  dashboard?: DashboardResponse;
  liabilities?: LiabilitiesResponse;
  wealth?: WealthResponse;
  homeConstruction?: ProjectSummaryResponse;
  loading: boolean;
  money: (paise: number) => string;
  month: string;
  onOpenBudget: () => void;
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

export const PERSONAL_MONTHLY_SALARY_PAISE = 30089300;

export function forecastIncomeDefault(dashboard?: DashboardResponse): number {
  return dashboard && dashboard.plannedIncomePaise > 0 ? dashboard.plannedIncomePaise : PERSONAL_MONTHLY_SALARY_PAISE;
}

export function ForecastsView({
  dashboard,
  liabilities,
  wealth,
  homeConstruction,
  loading,
  money,
  month,
  onOpenBudget,
}: ForecastsViewProps) {
  const [scenarioIncome, setScenarioIncome] = useState("");
  const [scenarioExpense, setScenarioExpense] = useState("");
  const [extraDebtPayment, setExtraDebtPayment] = useState("0");
  const [incomeGrowth, setIncomeGrowth] = useState("0");
  const [expenseInflation, setExpenseInflation] = useState("5");

  function resetScenario() {
    if (!dashboard) {
      return;
    }
    setScenarioIncome(String(forecastIncomeDefault(dashboard) / 100));
    setScenarioExpense(String(dashboard.regularBudgetPaise / 100));
    setExtraDebtPayment("0");
    setIncomeGrowth("0");
    setExpenseInflation("5");
  }

  useEffect(() => {
    if (!dashboard) {
      return;
    }
    setScenarioIncome(String(forecastIncomeDefault(dashboard) / 100));
    setScenarioExpense(String(dashboard.regularBudgetPaise / 100));
    setExtraDebtPayment("0");
    setIncomeGrowth("0");
    setExpenseInflation("5");
  }, [dashboard]);

  const scenarioIncomePaise =
    scenarioIncome === "" ? forecastIncomeDefault(dashboard) : paiseFromRupees(scenarioIncome);
  const scenarioExpensePaise =
    scenarioExpense === "" ? (dashboard?.regularBudgetPaise ?? 0) : paiseFromRupees(scenarioExpense);
  const extraDebtPaymentPaise = paiseFromRupees(extraDebtPayment);

  const forecast = useMemo(() => {
    if (!dashboard || !liabilities || !wealth) {
      return null;
    }
    return buildTwelveMonthForecast({
      startMonth: month,
      plannedIncomePaise: scenarioIncomePaise,
      regularExpensePaise: scenarioExpensePaise,
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
      extraDebtPaymentPaise,
      annualIncomeGrowthPercentage: Number(incomeGrowth) || 0,
      annualExpenseInflationPercentage: Number(expenseInflation) || 0,
    });
  }, [
    dashboard,
    expenseInflation,
    extraDebtPaymentPaise,
    incomeGrowth,
    liabilities,
    month,
    scenarioExpensePaise,
    scenarioIncomePaise,
    wealth,
  ]);

  if (loading || !dashboard || !liabilities || !wealth || !forecast) {
    return <section className="panel loading-panel">Building the 12-month outlook...</section>;
  }

  const finalMonth = forecast.months.at(-1);
  const finalNetWorthPaise = finalMonth?.projectedNetWorthPaise ?? wealth.netWorthPaise;
  const netWorthChange = finalNetWorthPaise - wealth.netWorthPaise;
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
  const scheduledEmiPaise = dashboard.totalEmiPaise;
  const monthlyNeedPaise = scenarioExpensePaise + scheduledEmiPaise + extraDebtPaymentPaise;
  const baseHeadroomPaise = scenarioIncomePaise - monthlyNeedPaise;
  const lowestCashMonth = forecast.months.toSorted((left, right) => left.cashSurplusPaise - right.cashSurplusPaise)[0];
  const monthsWithDeficit = forecast.months.filter((item) => item.cashSurplusPaise < 0).length;
  const ratesMissing = liabilities.liabilities.filter(
    (item) => item.status === "active" && item.currentPrincipalPaise > 0 && item.annualRateBps == null,
  ).length;
  const scenarioChanged =
    scenarioIncomePaise !== forecastIncomeDefault(dashboard) ||
    scenarioExpensePaise !== dashboard.regularBudgetPaise ||
    extraDebtPaymentPaise !== 0 ||
    Number(incomeGrowth) !== 0 ||
    Number(expenseInflation) !== 5;

  return (
    <section className="forecast-workspace">
      <div className="forecast-hero">
        <div>
          <p className="eyebrow">12-MONTH FORWARD VIEW / EXPLAINABLE MODEL</p>
          <h2>Test a decision before it reaches your bank.</h2>
          <p>
            The live plan is your starting point. Inputs below are a private what-if scenario and never overwrite saved
            income, budgets, assets or loan balances.
          </p>
        </div>
        <div className={`forecast-verdict ${monthsWithDeficit > 0 ? "danger" : ""}`}>
          <span>{scenarioChanged ? "CUSTOM SCENARIO" : "LIVE PLAN SCENARIO"}</span>
          <strong>{monthsWithDeficit > 0 ? `${monthsWithDeficit} deficit months` : "Positive monthly headroom"}</strong>
          <small>Lowest monthly surplus: {lowestCashMonth ? money(lowestCashMonth.cashSurplusPaise) : money(0)}</small>
        </div>
      </div>

      <div className="forecast-controls panel">
        <div className="forecast-controls-heading">
          <div>
            <p className="eyebrow">EDITABLE WHAT-IF MODEL</p>
            <h3>Scenario assumptions</h3>
            <small>Changes recalculate instantly and remain unsaved.</small>
          </div>
          <div>
            <button className="ghost-button" onClick={resetScenario} type="button">
              Reset to live plan
            </button>
            <button className="ghost-button" onClick={onOpenBudget} type="button">
              Edit saved budget
            </button>
          </div>
        </div>
        <label>
          Monthly take-home
          <span>
            <b>Rs</b>
            <input
              min="0"
              onChange={(event) => setScenarioIncome(event.target.value)}
              step="100"
              type="number"
              value={scenarioIncome}
            />
          </span>
        </label>
        <label>
          Regular expense budget
          <span>
            <b>Rs</b>
            <input
              min="0"
              onChange={(event) => setScenarioExpense(event.target.value)}
              step="100"
              type="number"
              value={scenarioExpense}
            />
          </span>
        </label>
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
          <small>EXTRA DEBT PRESETS</small>
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

      <div className={`forecast-cash-equation ${baseHeadroomPaise < 0 ? "danger" : ""}`}>
        <article>
          <span>MONTHLY INCOME</span>
          <strong className="money-value">{money(scenarioIncomePaise)}</strong>
        </article>
        <i>−</i>
        <article>
          <span>REGULAR BUDGET</span>
          <strong className="money-value">{money(scenarioExpensePaise)}</strong>
        </article>
        <i>−</i>
        <article>
          <span>SCHEDULED EMIS</span>
          <strong className="money-value">{money(scheduledEmiPaise)}</strong>
        </article>
        <i>−</i>
        <article>
          <span>EXTRA DEBT</span>
          <strong className="money-value">{money(extraDebtPaymentPaise)}</strong>
        </article>
        <i>=</i>
        <article className="result">
          <span>STARTING SURPLUS</span>
          <strong className="money-value">{money(baseHeadroomPaise)}</strong>
        </article>
      </div>

      <div className="forecast-kpis">
        <article>
          <span>NET WORTH AFTER 12 MONTHS</span>
          <strong className={`money-value ${finalNetWorthPaise < 0 ? "negative" : ""}`}>
            {money(finalNetWorthPaise)}
          </strong>
          <small>
            Today {money(wealth.netWorthPaise)} · {netWorthChange >= 0 ? "up" : "down"}{" "}
            {money(Math.abs(netWorthChange))}
          </small>
        </article>
        <article>
          <span>BANK DEBT AFTER 12 MONTHS</span>
          <strong className="money-value">{money(forecast.remainingDebtPaise)}</strong>
          <small>
            Down {money(debtReduction)} ({percentage(debtReduction, liabilities.totalPrincipalPaise)}%) from today
          </small>
        </article>
        <article>
          <span>ASSETS AFTER 12 MONTHS</span>
          <strong className="money-value">{money(forecast.projectedAssetPaise)}</strong>
          <small>
            Today {money(wealth.totalAssetPaise)} · retained surplus {money(forecast.cumulativeSurplusPaise)}
          </small>
        </article>
        <article>
          <span>EMERGENCY RESERVE OUTLOOK</span>
          <strong className="forecast-date-value">
            {emergencyGoal
              ? emergencyCompletion
                ? monthLabel(emergencyCompletion, true)
                : "Beyond 12 months"
              : "No goal"}
          </strong>
          <small>
            {emergencyGoal
              ? `${money(emergencyGoal.allocatedPaise)} of ${money(emergencyGoal.targetPaise)} allocated today`
              : "Create an emergency-cover goal first"}
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
            <p className="eyebrow">RISK AND SCOPE</p>
            <h2>What can move the result</h2>
          </div>
          <div className="forecast-risk-item">
            <span>Monthly committed need</span>
            <strong className="money-value">{money(monthlyNeedPaise)}</strong>
            <small>{percentage(monthlyNeedPaise, scenarioIncomePaise)}% of scenario income</small>
          </div>
          <div
            className={homeConstruction?.pendingCommitmentPaise ? "forecast-risk-item warning" : "forecast-risk-item"}
          >
            <span>Construction exposure</span>
            <strong className="money-value">{money(homeConstruction?.pendingCommitmentPaise ?? 0)}</strong>
            <small>Excluded because payment timing is not scheduled</small>
          </div>
          <div className={ratesMissing > 0 ? "forecast-risk-item warning" : "forecast-risk-item"}>
            <span>Unknown loan rates</span>
            <strong>{ratesMissing}</strong>
            <small>
              {ratesMissing > 0 ? "Modelled at 0%; actual interest may be higher" : "All active rates available"}
            </small>
          </div>
          <div className={baseHeadroomPaise < 0 ? "forecast-risk-item danger" : "forecast-risk-item"}>
            <span>Starting monthly surplus</span>
            <strong className="money-value">{money(baseHeadroomPaise)}</strong>
            <small>Income less budget, scheduled EMIs and extra debt</small>
          </div>
        </aside>
      </div>

      <article className="panel forecast-table-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">MONTH-BY-MONTH MODEL</p>
            <h2>Forecast schedule</h2>
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
        <span>Scenario inputs are temporary; “Edit saved budget” changes the live monthly plan.</span>
        <span>Regular budget is used instead of partial-month actual spend.</span>
        <span>Positive cash surplus stays in tracked assets; no investment return or tax is assumed.</span>
        <span>Emergency completion assumes all new surplus is directed to that goal.</span>
        <span>Loan rates use current stored values; missing rates are modelled at 0% and flagged.</span>
      </div>
    </section>
  );
}
