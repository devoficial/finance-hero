import { formatInr } from "@finance-hero/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getHealth } from "./lib/api";

const navItems = ["Home", "Ledger", "Expenses", "Imports", "Liabilities", "Goals", "Projects"];

const monthData = [
  { month: "July", spend: 60048, budget: 78499, status: "Open", tone: "live" },
  { month: "June", spend: 65369, budget: 78499, status: "Closed", tone: "settled" },
  { month: "May", spend: 71240, budget: 78499, status: "Closed", tone: "watch" },
] as const;

const metrics = [
  { label: "Monthly income", value: 300893, detail: "Salary account", kind: "positive" },
  { label: "Regular expenses", value: 60048, detail: "76% of July budget", kind: "warning" },
  { label: "Total EMI", value: 127451, detail: "7 active facilities", kind: "neutral" },
  { label: "Available after plan", value: 113394, detail: "Before pending imports", kind: "positive" },
] as const;

const categories = [
  { name: "Home and rent", amount: 29500, percentage: 49 },
  { name: "Food and household", amount: 14080, percentage: 23 },
  { name: "Learning and lifestyle", amount: 8268, percentage: 14 },
  { name: "Transport and medical", amount: 8200, percentage: 14 },
] as const;

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

export function App() {
  const [privacy, setPrivacy] = useState(false);
  const [activeNav, setActiveNav] = useState("Home");
  const [year, setYear] = useState("2026");
  const health = useQuery({ queryKey: ["health"], queryFn: ({ signal }) => getHealth(signal) });
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  }, []);

  const money = (value: number) => (privacy ? "Rs --,---" : formatInr(value));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">
          <span>FH</span>
          <div>
            <strong>FINANCE</strong>
            <small>HERO / LOCAL</small>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          {navItems.map((item, index) => (
            <button
              className={activeNav === item ? "active" : ""}
              key={item}
              onClick={() => setActiveNav(item)}
              type="button"
            >
              <span className="nav-index">0{index + 1}</span>
              {item}
              {item === "Imports" && <span className="nav-badge">12</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className={`status-dot ${health.isSuccess ? "online" : ""}`} />
          <div>
            <strong>{health.isSuccess ? "Mac connected" : "Cached mode"}</strong>
            <small>{health.data?.database ?? "Checking local API"}</small>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">PERSONAL CONTROL ROOM / JUL 2026</p>
            <h1>{greeting}, Debasis.</h1>
          </div>
          <div className="top-actions">
            <button className="ghost-button" onClick={() => setPrivacy((value) => !value)} type="button">
              {privacy ? "Show amounts" : "Privacy mode"}
            </button>
            <button className="sync-button" type="button">
              <span /> Sync sources
              <b>12</b>
            </button>
          </div>
        </header>

        <section className="alert-strip" aria-label="Financial alert">
          <span className="alert-code">RISK 01</span>
          <p>
            <strong>Regular spending crossed 60% before day 20.</strong> Current pace projects a Rs 9,420 overrun.
          </p>
          <button type="button">Review July</button>
        </section>

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
                <p className="eyebrow">EXPENSE PULSE</p>
                <h2>Monthly field notes</h2>
              </div>
              <label>
                <span>Year</span>
                <select value={year} onChange={(event) => setYear(event.target.value)}>
                  <option>2026</option>
                  <option>2025</option>
                </select>
              </label>
            </div>

            <div className="month-row">
              {monthData.map((item) => (
                <button className={`month-card ${item.tone}`} key={item.month} type="button">
                  <div>
                    <span>
                      {item.month} {year}
                    </span>
                    <small>{item.status}</small>
                  </div>
                  <strong>{money(item.spend)}</strong>
                  <div className="progress-track">
                    <i style={{ width: `${Math.min(100, (item.spend / item.budget) * 100)}%` }} />
                  </div>
                  <footer>
                    <span>Budget {money(item.budget)}</span>
                    <b>Open -&gt;</b>
                  </footer>
                </button>
              ))}
            </div>

            <div className="category-breakdown">
              <Donut percentage={76} />
              <div className="category-list">
                {categories.map((category) => (
                  <div key={category.name}>
                    <span>
                      <i />
                      {category.name}
                    </span>
                    <strong>{money(category.amount)}</strong>
                    <small>{category.percentage}%</small>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <aside className="right-stack">
            <article className="panel debt-panel">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">SNOWBALL TARGET</p>
                  <h2>Groww personal loan</h2>
                </div>
                <span className="risk-pill">16.99%</span>
              </div>
              <p className="debt-value">{money(339487)}</p>
              <div className="debt-meta">
                <span>EMI {money(11181)}</span>
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
                  <p className="eyebrow">REVIEW QUEUE</p>
                  <h2>12 discoveries</h2>
                </div>
                <span className="source-time">2m ago</span>
              </div>
              <ul>
                <li>
                  <span className="source gmail">G</span>
                  <div>
                    <strong>Gmail</strong>
                    <small>7 transaction alerts</small>
                  </div>
                  <b>7</b>
                </li>
                <li>
                  <span className="source sms">S</span>
                  <div>
                    <strong>iPhone messages</strong>
                    <small>3 likely matches</small>
                  </div>
                  <b>3</b>
                </li>
                <li>
                  <span className="source file">F</span>
                  <div>
                    <strong>Statements</strong>
                    <small>2 rows need account</small>
                  </div>
                  <b>2</b>
                </li>
              </ul>
              <button type="button">Open sync review</button>
            </article>
          </aside>
        </section>

        <footer className="page-footer">
          <span>
            LOCAL DATA CUTOFF:{" "}
            {health.data ? new Date(health.data.checkedAt).toLocaleTimeString("en-IN") : "OFFLINE CACHE"}
          </span>
          <span>INR ONLY / ASIA-KOLKATA</span>
        </footer>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.slice(0, 4).map((item) => (
          <button
            className={activeNav === item ? "active" : ""}
            key={item}
            onClick={() => setActiveNav(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </nav>
    </div>
  );
}
