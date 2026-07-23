import { formatInr } from "@finance-hero/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { DashboardView } from "./components/DashboardView";
import { ExpensesView } from "./components/ExpensesView";
import { LedgerView } from "./components/LedgerView";
import { LiabilitiesView } from "./components/LiabilitiesView";
import { getDashboard, getExpenseYear, getHealth, getLedger, getLiabilities, getReferenceData } from "./lib/api";

const navItems = ["Home", "Ledger", "Expenses", "Imports", "Liabilities", "Goals", "Projects"] as const;
type NavItem = (typeof navItems)[number];
const ACTIVE_MONTH = "2026-07";

interface PwaInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface StandaloneNavigator extends Navigator {
  standalone?: boolean;
}

const navSlugs: Record<NavItem, string> = {
  Home: "home",
  Ledger: "ledger",
  Expenses: "expenses",
  Imports: "imports",
  Liabilities: "liabilities",
  Goals: "goals",
  Projects: "projects",
};

export function parseRouteHash(hash: string): { nav: NavItem; month: string; year: string } {
  const [path = "home", search = ""] = hash.replace(/^#\/?/, "").split("?");
  const nav = navItems.find((item) => navSlugs[item] === path) ?? "Home";
  const params = new URLSearchParams(search);
  const routeMonth = params.get("month");
  const month = routeMonth && /^\d{4}-\d{2}$/.test(routeMonth) ? routeMonth : ACTIVE_MONTH;
  const routeYear = params.get("year");
  const year = routeYear && /^\d{4}$/.test(routeYear) ? routeYear : month.slice(0, 4);
  return { nav, month, year };
}

function readRoute() {
  return parseRouteHash(window.location.hash);
}

export function routeHash(nav: NavItem, month: string, year: string) {
  return `#/${navSlugs[nav]}?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`;
}

export function App() {
  const initialRoute = useMemo(readRoute, []);
  const [privacy, setPrivacy] = useState(false);
  const [activeNav, setActiveNav] = useState<NavItem>(initialRoute.nav);
  const [year, setYear] = useState(initialRoute.year);
  const [selectedMonth, setSelectedMonth] = useState(initialRoute.month);
  const [installPrompt, setInstallPrompt] = useState<PwaInstallPromptEvent | null>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const health = useQuery({ queryKey: ["health"], queryFn: ({ signal }) => getHealth(signal) });
  const dashboard = useQuery({
    queryKey: ["dashboard", selectedMonth],
    queryFn: ({ signal }) => getDashboard(selectedMonth, signal),
  });
  const ledger = useQuery({
    queryKey: ["ledger", selectedMonth],
    queryFn: ({ signal }) => getLedger(selectedMonth, signal),
  });
  const expenseYear = useQuery({
    queryKey: ["expenses", "year", year],
    queryFn: ({ signal }) => getExpenseYear(year, signal),
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

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, "", routeHash(initialRoute.nav, initialRoute.month, initialRoute.year));
    }

    const syncFromLocation = () => {
      const route = readRoute();
      setActiveNav(route.nav);
      setSelectedMonth(route.month);
      setYear(route.year);
    };
    window.addEventListener("hashchange", syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncFromLocation);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, [initialRoute]);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as StandaloneNavigator).standalone === true;
    setIsInstalled(standalone);

    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as PwaInstallPromptEvent);
    };
    const markInstalled = () => {
      setInstallPrompt(null);
      setShowInstallHelp(false);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  const money = (paise: number) => (privacy ? "Rs --,---" : formatInr(paise / 100));
  const visibleMonth = selectedMonth;
  const visiblePeriod = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${visibleMonth}-01T00:00:00Z`))
    .toUpperCase();
  const hasViewError =
    (activeNav === "Home" && (dashboard.isError || liabilities.isError)) ||
    (activeNav === "Ledger" && (ledger.isError || referenceData.isError)) ||
    (activeNav === "Expenses" && (expenseYear.isError || dashboard.isError)) ||
    (activeNav === "Liabilities" && liabilities.isError);

  function navigate(nav: NavItem, month = selectedMonth, nextYear = year) {
    const hash = routeHash(nav, month, nextYear);
    if (window.location.hash !== hash) {
      window.history.pushState(null, "", hash);
    }
    setActiveNav(nav);
    setSelectedMonth(month);
    setYear(nextYear);
  }

  function openCurrentLedger() {
    navigate("Ledger");
  }

  function changeExpenseYear(nextYear: string) {
    navigate("Expenses", `${nextYear}-${selectedMonth.slice(5, 7)}`, nextYear);
  }

  async function installApp() {
    if (!installPrompt) {
      setShowInstallHelp(true);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallPrompt(null);
      setShowInstallHelp(false);
    }
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
              onClick={() => navigate(item)}
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
            {!isInstalled && (
              <button className="install-button" onClick={installApp} type="button">
                Install app
              </button>
            )}
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

        {showInstallHelp && (
          <section className="install-guide" aria-label="Install Finance Hero">
            <div>
              <span>INSTALL FINANCE HERO</span>
              <strong>
                {/iPhone|iPad|iPod/i.test(navigator.userAgent)
                  ? "In Safari, tap Share and choose Add to Home Screen."
                  : "Use your browser menu and choose Install Finance Hero or Add to Dock."}
              </strong>
              <small>Installation requires a secure local address. On this Mac, 127.0.0.1 is treated as secure.</small>
            </div>
            <button onClick={() => setShowInstallHelp(false)} type="button">
              Close
            </button>
          </section>
        )}

        {hasViewError ? (
          <section className="alert-strip" aria-label="Local database error">
            <span className="alert-code">DATA</span>
            <p>
              <strong>The encrypted ledger could not be loaded.</strong> Check that the local API is running.
            </p>
          </section>
        ) : activeNav === "Home" ? (
          <DashboardView
            dataCutoffMonth={ACTIVE_MONTH}
            dashboard={dashboard.data}
            expenseYear={expenseYear.data}
            liabilities={liabilities.data}
            loading={dashboard.isLoading || liabilities.isLoading}
            money={money}
            onOpenLedger={openCurrentLedger}
            onOpenExpenses={() => navigate("Expenses")}
            onOpenLiabilities={() => navigate("Liabilities")}
          />
        ) : activeNav === "Expenses" ? (
          <ExpensesView
            dataCutoffMonth={ACTIVE_MONTH}
            loading={expenseYear.isLoading || dashboard.isLoading}
            money={money}
            onOpenStatement={(month) => {
              navigate("Ledger", month, month.slice(0, 4));
            }}
            onSelectMonth={(month) => navigate("Expenses", month, month.slice(0, 4))}
            onYearChange={changeExpenseYear}
            selectedDashboard={dashboard.data}
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
            onClick={() => navigate(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </nav>
    </div>
  );
}
