import type { DashboardResponse, LiabilitiesResponse } from "@finance-hero/contracts";

interface DashboardViewProps {
  dashboard?: DashboardResponse;
  liabilities?: LiabilitiesResponse;
  loading: boolean;
  money: (paise: number) => string;
  onOpenLedger: () => void;
  onOpenLiabilities: () => void;
}

export function DashboardView({
  dashboard,
  liabilities,
  loading,
  money,
  onOpenLedger,
  onOpenLiabilities,
}: DashboardViewProps) {
  if (loading || !dashboard || !liabilities) {
    return <section className="panel loading-panel">Reading the encrypted ledger...</section>;
  }

  const visibleLiabilities = liabilities.liabilities
    .filter((liability) => liability.status === "active" && liability.currentPrincipalPaise > 0)
    .slice(0, 4);
  const snowballTarget = liabilities.liabilities.find((liability) => liability.snowballRank === 1);

  const metrics = [
    {
      label: "Monthly income plan",
      value: dashboard.plannedIncomePaise,
      detail:
        dashboard.actualIncomePaise > 0 ? `${money(dashboard.actualIncomePaise)} received` : "Awaiting income entries",
      kind: "positive",
    },
    {
      label: "Regular expenses",
      value: dashboard.regularExpensePaise,
      detail: `${dashboard.budgetUsedPercentage}% of July budget`,
      kind: dashboard.dangerAlert ? "warning" : "neutral",
    },
    {
      label: "Total EMI",
      value: dashboard.totalEmiPaise,
      detail: `Debt principal ${money(dashboard.debtPrincipalPaise)}`,
      kind: "neutral",
    },
    {
      label: "Available after plan",
      value: dashboard.availableAfterPlanPaise,
      detail: "Income plan less expenses and EMI",
      kind: "positive",
    },
  ];

  return (
    <>
      {dashboard.dangerAlert && (
        <section className="alert-strip" aria-label="Financial alert">
          <span className="alert-code">RISK 01</span>
          <p>
            <strong>Regular spending crossed 60% before day 20.</strong> {dashboard.budgetUsedPercentage}% of the
            approved budget is already used.
          </p>
          <button onClick={onOpenLedger} type="button">
            Review July
          </button>
        </section>
      )}

      <section className="metric-grid" aria-label="Financial summary">
        {metrics.map((metric) => (
          <article className={`metric-card ${metric.kind}`} key={metric.label}>
            <span>{metric.label}</span>
            <strong>{money(metric.value)}</strong>
            <small>{metric.detail}</small>
          </article>
        ))}
      </section>

      <section className="workspace-grid">
        <article className="panel cash-flow-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">JULY CASH-FLOW PLAN / LIVE POSITION</p>
              <h2>Where the salary is committed</h2>
            </div>
            <span className="live-pill">{dashboard.transactionCount} RECORDS</span>
          </div>

          <div className="cash-flow-chart" role="img" aria-label="July planned cash flow">
            {[
              ["Monthly income", dashboard.plannedIncomePaise, "income"],
              ["EMI commitments", dashboard.totalEmiPaise, "emi"],
              ["Regular expenses", dashboard.regularExpensePaise, "expense"],
              ["Available after plan", dashboard.availableAfterPlanPaise, "available"],
            ].map(([label, value, kind]) => {
              const amount = value as number;
              const width =
                dashboard.plannedIncomePaise > 0
                  ? Math.max(2, (Math.max(0, amount) / dashboard.plannedIncomePaise) * 100)
                  : 0;
              return (
                <div className="cash-flow-row" key={label as string}>
                  <div>
                    <span>{label}</span>
                    <strong>{money(amount)}</strong>
                  </div>
                  <div className="cash-flow-track">
                    <i className={kind as string} style={{ width: `${Math.min(100, width)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="dashboard-notes">
            <article>
              <span>Budget pressure</span>
              <strong>{dashboard.budgetUsedPercentage}%</strong>
              <small>{dashboard.dangerAlert ? "Action needed before day 20" : "Within configured threshold"}</small>
            </article>
            <article>
              <span>Largest expense</span>
              <strong>{dashboard.categories[0]?.name ?? "No entries"}</strong>
              <small>{money(dashboard.categories[0]?.amountPaise ?? 0)} recorded</small>
            </article>
            <article>
              <span>Next action</span>
              <strong>Review ledger</strong>
              <small>Confirm aggregates with detailed statements</small>
            </article>
          </div>

          <button className="dashboard-ledger-button" onClick={onOpenLedger} type="button">
            Review all July ledger entries
          </button>
        </article>

        <aside className="right-stack">
          <article className="panel debt-panel">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">LIABILITY PORTFOLIO / LIVE DEBT</p>
                <h2>{money(liabilities.totalPrincipalPaise)}</h2>
              </div>
              <span className="risk-pill">{liabilities.activeCount} ACTIVE</span>
            </div>
            <div className="debt-meta">
              <span>Monthly EMI {money(liabilities.totalEmiPaise)}</span>
              <span>{liabilities.clearedCount} cleared</span>
            </div>
            <div className="home-balance-summary">
              <div>
                <span>Other liabilities</span>
                <strong>{money(liabilities.otherLiabilityPaise)}</strong>
              </div>
              <div>
                <span>Money to get back</span>
                <strong className="receivable">-{money(liabilities.receivablePaise)}</strong>
              </div>
              <div>
                <span>Net obligations</span>
                <strong>{money(liabilities.netObligationPaise)}</strong>
              </div>
            </div>
            <div className="home-liability-list">
              {visibleLiabilities.map((liability) => (
                <div key={liability.id}>
                  <span>{liability.name}</span>
                  <strong>{money(liability.currentPrincipalPaise)}</strong>
                </div>
              ))}
            </div>
            {snowballTarget && (
              <div className="snowball-callout">
                <span>Snowball priority #1</span>
                <strong>{snowballTarget.name}</strong>
                <small>{money(snowballTarget.currentPrincipalPaise)} outstanding</small>
              </div>
            )}
            <button onClick={onOpenLiabilities} type="button">
              Open complete liability sheet
            </button>
          </article>

          <article className="panel sync-panel">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">IMPORT STATUS</p>
                <h2>No pending discoveries</h2>
              </div>
              <span className="source-time">Not connected</span>
            </div>
            <ul>
              <li>
                <span className="source gmail">G</span>
                <div>
                  <strong>Gmail</strong>
                  <small>Connector scheduled for Phase 4</small>
                </div>
                <b>0</b>
              </li>
              <li>
                <span className="source sms">S</span>
                <div>
                  <strong>iPhone messages</strong>
                  <small>Shortcut not paired</small>
                </div>
                <b>0</b>
              </li>
              <li>
                <span className="source file">F</span>
                <div>
                  <strong>Statements</strong>
                  <small>Upload pipeline is next</small>
                </div>
                <b>0</b>
              </li>
            </ul>
            <button disabled type="button">
              Connectors coming next
            </button>
          </article>
        </aside>
      </section>
    </>
  );
}
