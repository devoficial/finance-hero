import { formatInr } from "@finance-hero/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DashboardView } from "./components/DashboardView";
import { ExpensesView } from "./components/ExpensesView";
import { LedgerView } from "./components/LedgerView";
import { LiabilitiesView } from "./components/LiabilitiesView";
import { getDashboard, getExpenseYear, getHealth, getLedger, getLiabilities, getReferenceData } from "./lib/api";

const navItems = ["Home", "Ledger", "Expenses", "Imports", "Liabilities", "Goals", "Projects"];
const ACTIVE_MONTH = "2026-07";

export function App() {
  const [privacy, setPrivacy] = useState(false);
  const [activeNav, setActiveNav] = useState("Home");
  const [year, setYear] = useState("2026");
  const [selectedMonth, setSelectedMonth] = useState(ACTIVE_MONTH);
  const health = useQuery({ queryKey: ["health"], queryFn: ({ signal }) => getHealth(signal) });
  const dashboard = useQuery({
    queryKey: ["dashboard", ACTIVE_MONTH],
    queryFn: ({ signal }) => getDashboard(ACTIVE_MONTH, signal),
  });
  const ledger = useQuery({
    queryKey: ["ledger", selectedMonth],
    queryFn: ({ signal }) => getLedger(selectedMonth, signal),
  });
  const expenseYear = useQuery({
    queryKey: ["expenses", "year", year],
    queryFn: ({ signal }) => getExpenseYear(year, signal),
  });
  const selectedExpense = useQuery({
    queryKey: ["dashboard", selectedMonth],
    queryFn: ({ signal }) => getDashboard(selectedMonth, signal),
  });
  const liabilities = useQuery({ queryKey: ["liabilities"], queryFn: ({ signal }) => getLiabilities(signal) });
  const referenceData = useQuery({
    queryKey: ["reference-data"],
    queryFn: ({ signal }) => getReferenceData(signal),
  });

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  }, []);

  const money = (paise: number) => (privacy ? "Rs --,---" : formatInr(paise / 100));
  const visibleMonth = activeNav === "Expenses" || activeNav === "Ledger" ? selectedMonth : ACTIVE_MONTH;
  const visiblePeriod = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${visibleMonth}-01T00:00:00Z`))
    .toUpperCase();
  const hasViewError =
    (activeNav === "Home" && (dashboard.isError || liabilities.isError)) ||
    (activeNav === "Ledger" && (ledger.isError || referenceData.isError)) ||
    (activeNav === "Expenses" && (expenseYear.isError || selectedExpense.isError)) ||
    (activeNav === "Liabilities" && liabilities.isError);

  function openCurrentLedger() {
    setSelectedMonth(ACTIVE_MONTH);
    setActiveNav("Ledger");
  }

  function changeExpenseYear(nextYear: string) {
    setYear(nextYear);
    setSelectedMonth(`${nextYear}-${selectedMonth.slice(5, 7)}`);
  }

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
              {item === "Imports" && <span className="nav-badge">0</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className={`status-dot ${health.data?.database === "encrypted" ? "online" : ""}`} />
          <div>
            <strong>{health.isSuccess ? "Mac connected" : "Cached mode"}</strong>
            <small>{health.data?.database ?? "Checking local API"}</small>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">
              {activeNav.toUpperCase()} / LIVE LOCAL DATA / {visiblePeriod}
            </p>
            <h1>{activeNav === "Home" ? `${greeting}, Debasis.` : activeNav}</h1>
          </div>
          <div className="top-actions">
            <button className="add-button" onClick={openCurrentLedger} type="button">
              + Add transaction
            </button>
            <button className="ghost-button" onClick={() => setPrivacy((value) => !value)} type="button">
              {privacy ? "Show amounts" : "Privacy mode"}
            </button>
            <button className="sync-button" disabled type="button">
              <span /> Sync sources
              <b>0</b>
            </button>
          </div>
        </header>

        {hasViewError ? (
          <section className="alert-strip" aria-label="Local database error">
            <span className="alert-code">DATA</span>
            <p>
              <strong>The encrypted ledger could not be loaded.</strong> Check that the local API is running.
            </p>
          </section>
        ) : activeNav === "Home" ? (
          <DashboardView
            dashboard={dashboard.data}
            liabilities={liabilities.data}
            loading={dashboard.isLoading || liabilities.isLoading}
            money={money}
            onOpenLedger={openCurrentLedger}
            onOpenLiabilities={() => setActiveNav("Liabilities")}
          />
        ) : activeNav === "Expenses" ? (
          <ExpensesView
            loading={expenseYear.isLoading || selectedExpense.isLoading}
            money={money}
            onOpenStatement={(month) => {
              setSelectedMonth(month);
              setActiveNav("Ledger");
            }}
            onSelectMonth={setSelectedMonth}
            onYearChange={changeExpenseYear}
            selectedDashboard={selectedExpense.data}
            selectedMonth={selectedMonth}
            year={year}
            yearData={expenseYear.data}
          />
        ) : activeNav === "Ledger" ? (
          <LedgerView
            ledger={ledger.data}
            loading={ledger.isLoading || referenceData.isLoading}
            money={money}
            month={selectedMonth}
            referenceData={referenceData.data}
          />
        ) : activeNav === "Liabilities" ? (
          <LiabilitiesView data={liabilities.data} loading={liabilities.isLoading} money={money} />
        ) : (
          <section className="panel feature-placeholder">
            <p className="eyebrow">MODULE BOUNDARY READY</p>
            <h2>{activeNav} is the next vertical slice.</h2>
            <p>
              The unified ledger and opening snapshot are live. This tracker will now be built over the same database.
            </p>
          </section>
        )}

        <footer className="page-footer">
          <span>
            LOCAL DATA CUTOFF:{" "}
            {health.data ? new Date(health.data.checkedAt).toLocaleTimeString("en-IN") : "OFFLINE CACHE"}
          </span>
          <span>ENCRYPTED SQLITE / INR ONLY / ASIA-KOLKATA</span>
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
