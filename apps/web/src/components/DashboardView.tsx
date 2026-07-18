import type { DashboardResponse } from "@finance-hero/contracts";

interface DashboardViewProps {
  dashboard?: DashboardResponse;
  loading: boolean;
  money: (paise: number) => string;
  year: string;
  onYearChange: (year: string) => void;
  onOpenLedger: () => void;
}

function Donut({ percentage }: { percentage: number }) {
  const safe = Math.min(100, Math.max(0, percentage));

  return (
    <div className="donut" style={{ "--percentage": `${safe * 3.6}deg` } as React.CSSProperties}>
      <div>
        <strong>{safe}%</strong>
        <span>used</span>
      </div>
    </div>
  );
}

export function DashboardView({ dashboard, loading, money, year, onYearChange, onOpenLedger }: DashboardViewProps) {
  if (loading || !dashboard) {
    return <section className="panel loading-panel">Reading the encrypted ledger...</section>;
  }

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
        <article className="panel expense-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LIVE LEDGER / {dashboard.transactionCount} RECORDS</p>
              <h2>Monthly field notes</h2>
            </div>
            <label>
              <span>Year</span>
              <select value={year} onChange={(event) => onYearChange(event.target.value)}>
                <option>2026</option>
                <option>2025</option>
              </select>
            </label>
          </div>

          <div className="month-row single-month">
            <button className="month-card live" onClick={onOpenLedger} type="button">
              <div>
                <span>July {year}</span>
                <small>Open</small>
              </div>
              <strong>{money(dashboard.regularExpensePaise)}</strong>
              <div className="progress-track">
                <i style={{ width: `${Math.min(100, dashboard.budgetUsedPercentage)}%` }} />
              </div>
              <footer>
                <span>Budget {money(dashboard.regularBudgetPaise)}</span>
                <b>Ledger -&gt;</b>
              </footer>
            </button>
          </div>

          <div className="category-breakdown">
            <Donut percentage={dashboard.budgetUsedPercentage} />
            <div className="category-list">
              {dashboard.categories.map((category) => {
                const percentage =
                  dashboard.regularExpensePaise > 0
                    ? Math.round((category.amountPaise / dashboard.regularExpensePaise) * 100)
                    : 0;
                return (
                  <div key={category.id}>
                    <span>
                      <i />
                      {category.name}
                    </span>
                    <strong>{money(category.amountPaise)}</strong>
                    <small>{percentage}%</small>
                  </div>
                );
              })}
            </div>
          </div>
        </article>

        <aside className="right-stack">
          <article className="panel debt-panel">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">SNOWBALL TARGET / LIVE DEBT</p>
                <h2>{dashboard.snowballTarget?.name ?? "No active debt"}</h2>
              </div>
              {dashboard.snowballTarget?.annualRateBps != null && (
                <span className="risk-pill">{(dashboard.snowballTarget.annualRateBps / 100).toFixed(2)}%</span>
              )}
            </div>
            <p className="debt-value">{money(dashboard.snowballTarget?.principalPaise ?? 0)}</p>
            <div className="debt-meta">
              <span>EMI {money(dashboard.snowballTarget?.emiPaise ?? 0)}</span>
              <span>Priority 01</span>
            </div>
            <div className="debt-track">
              <i />
            </div>
            <button type="button">Run prepayment scenario</button>
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
