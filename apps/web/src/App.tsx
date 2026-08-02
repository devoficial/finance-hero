import { formatInr } from "@finance-hero/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AccountsView } from "./components/AccountsView";
import { DashboardView } from "./components/DashboardView";
import { ExpensesView } from "./components/ExpensesView";
import { FinanceAssistant } from "./components/FinanceAssistant";
import { ForecastsView } from "./components/ForecastsView";
import { GoalsView } from "./components/GoalsView";
import { ImportsView } from "./components/ImportsView";
import { LiabilitiesView } from "./components/LiabilitiesView";
import { ProjectsView } from "./components/ProjectsView";
import {
  getAccounts,
  getAssistantStatus,
  getBudget,
  getDashboard,
  getExpenseYear,
  getHealth,
  getHomeConstruction,
  getImports,
  getLiabilities,
  getReferenceData,
  getWealth,
} from "./lib/api";
import { evaluateFinanceNotifications, requestFinanceNotifications } from "./lib/finance-notifications";

const navItems = ["Home", "Accounts", "Expenses", "Imports", "Liabilities", "Goals", "Forecasts", "Projects"] as const;
type NavItem = (typeof navItems)[number];

export function currentLocalMonth(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(now);
}

const ACTIVE_MONTH = currentLocalMonth();

interface PwaInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface StandaloneNavigator extends Navigator {
  standalone?: boolean;
}

const navSlugs = {
  Home: "home",
  Accounts: "accounts",
  Expenses: "expenses",
  Imports: "imports",
  Liabilities: "liabilities",
  Goals: "goals",
  Forecasts: "forecasts",
  Projects: "projects",
} as const satisfies Record<NavItem, string>;

function normalizeRoutePeriod(nav: NavItem, month: string, year: string, activeMonth = ACTIVE_MONTH) {
  if (nav === "Home" && month > activeMonth) {
    return { month: activeMonth, year: activeMonth.slice(0, 4) };
  }

  return { month, year };
}

export function parseRouteHash(
  hash: string,
  activeMonth = ACTIVE_MONTH,
): { nav: NavItem; month: string; year: string } {
  const [path = "home", search = ""] = hash.replace(/^#\/?/, "").split("?");
  const nav = path === "ledger" ? "Expenses" : (navItems.find((item) => navSlugs[item] === path) ?? "Home");
  const params = new URLSearchParams(search);
  const routeMonth = params.get("month");
  const month = routeMonth && /^\d{4}-\d{2}$/.test(routeMonth) ? routeMonth : activeMonth;
  const routeYear = params.get("year");
  const year = routeYear && /^\d{4}$/.test(routeYear) ? routeYear : month.slice(0, 4);
  return { nav, ...normalizeRoutePeriod(nav, month, year, activeMonth) };
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
  const [reportStatus, setReportStatus] = useState<"idle" | "generating" | "error">("idle");
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(
    "Notification" in window ? Notification.permission : "unsupported",
  );
  const health = useQuery({ queryKey: ["health"], queryFn: ({ signal }) => getHealth(signal) });
  const assistantStatus = useQuery({
    queryKey: ["assistant", "status"],
    queryFn: ({ signal }) => getAssistantStatus(signal),
    refetchInterval: 15_000,
  });
  const dashboard = useQuery({
    queryKey: ["dashboard", selectedMonth],
    queryFn: ({ signal }) => getDashboard(selectedMonth, signal),
  });
  const reportDashboard = useQuery({
    queryKey: ["dashboard", ACTIVE_MONTH],
    queryFn: ({ signal }) => getDashboard(ACTIVE_MONTH, signal),
  });
  const budget = useQuery({
    queryKey: ["budget", selectedMonth],
    queryFn: ({ signal }) => getBudget(selectedMonth, signal),
  });
  const expenseYear = useQuery({
    queryKey: ["expenses", "year", year],
    queryFn: ({ signal }) => getExpenseYear(year, signal),
  });
  const liabilities = useQuery({ queryKey: ["liabilities"], queryFn: ({ signal }) => getLiabilities(signal) });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: ({ signal }) => getAccounts(signal) });
  const referenceData = useQuery({
    queryKey: ["reference-data"],
    queryFn: ({ signal }) => getReferenceData(signal),
  });
  const imports = useQuery({
    queryKey: ["imports"],
    queryFn: ({ signal }) => getImports(signal),
  });
  const homeConstruction = useQuery({
    queryKey: ["projects", "home-construction"],
    queryFn: ({ signal }) => getHomeConstruction(signal),
  });
  const wealth = useQuery({
    queryKey: ["wealth"],
    queryFn: ({ signal }) => getWealth(signal),
  });

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  }, []);

  useEffect(() => {
    const initialHash = routeHash(initialRoute.nav, initialRoute.month, initialRoute.year);
    if (window.location.hash !== initialHash) {
      window.history.replaceState(null, "", initialHash);
    }

    const syncFromLocation = () => {
      const route = readRoute();
      const canonicalHash = routeHash(route.nav, route.month, route.year);
      if (window.location.hash !== canonicalHash) {
        window.history.replaceState(null, "", canonicalHash);
      }
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

  useEffect(() => {
    if (reportDashboard.data) evaluateFinanceNotifications(reportDashboard.data);
  }, [reportDashboard.data]);

  useEffect(() => {
    const refreshAlerts = () => {
      if (document.visibilityState === "visible") void reportDashboard.refetch();
    };
    window.addEventListener("focus", refreshAlerts);
    document.addEventListener("visibilitychange", refreshAlerts);
    return () => {
      window.removeEventListener("focus", refreshAlerts);
      document.removeEventListener("visibilitychange", refreshAlerts);
    };
  }, [reportDashboard.refetch]);

  const money = (paise: number) => (privacy ? "Rs --,---" : formatInr(paise / 100));
  const visibleMonth = selectedMonth;
  const visiblePeriod = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${visibleMonth}-01T00:00:00Z`))
    .toUpperCase();
  const hasViewError =
    (activeNav === "Home" && (dashboard.isError || liabilities.isError || wealth.isError)) ||
    (activeNav === "Accounts" && (accounts.isError || wealth.isError || homeConstruction.isError)) ||
    (activeNav === "Expenses" && (expenseYear.isError || dashboard.isError || budget.isError)) ||
    (activeNav === "Imports" && (imports.isError || referenceData.isError)) ||
    (activeNav === "Liabilities" && liabilities.isError) ||
    (activeNav === "Goals" && wealth.isError) ||
    (activeNav === "Forecasts" &&
      (dashboard.isError || liabilities.isError || wealth.isError || homeConstruction.isError)) ||
    (activeNav === "Projects" && (homeConstruction.isError || referenceData.isError));

  function navigate(nav: NavItem, month = selectedMonth, nextYear = year) {
    const period = normalizeRoutePeriod(nav, month, nextYear);
    const hash = routeHash(nav, period.month, period.year);
    if (window.location.hash !== hash) {
      window.history.pushState(null, "", hash);
    }
    setActiveNav(nav);
    setSelectedMonth(period.month);
    setYear(period.year);
  }

  function navigateFromSidebar(nav: NavItem) {
    if (nav === "Expenses") {
      navigate(nav, ACTIVE_MONTH, ACTIVE_MONTH.slice(0, 4));
      return;
    }
    navigate(nav);
  }

  function openExpenses() {
    navigate("Expenses", ACTIVE_MONTH, ACTIVE_MONTH.slice(0, 4));
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

  async function downloadSummary() {
    if (!reportDashboard.data || !accounts.data || !liabilities.data || !wealth.data) return;
    setReportStatus("generating");
    try {
      const { downloadFinancialReport } = await import("./lib/financial-report");
      await downloadFinancialReport({
        generatedOn: new Date(),
        dashboard: reportDashboard.data,
        accounts: accounts.data,
        liabilities: liabilities.data,
        wealth: wealth.data,
      });
    } catch (error) {
      console.error("Unable to generate financial summary PDF", error);
      setReportStatus("error");
      return;
    }
    setReportStatus("idle");
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
              onClick={() => navigateFromSidebar(item)}
              type="button"
            >
              <span className="nav-index">0{index + 1}</span>
              {item}
              {item === "Imports" && <span className="nav-badge">{imports.data?.pendingCount ?? 0}</span>}
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
              {activeNav.toUpperCase()} / {activeNav === "Home" ? "LATEST DATA CUTOFF" : "LIVE LOCAL DATA"} /{" "}
              {visiblePeriod}
            </p>
            <h1>{activeNav === "Home" ? `${greeting}, Debasis.` : activeNav}</h1>
          </div>
          <div className="top-actions">
            {notificationPermission !== "granted" && (
              <button
                className="ghost-button"
                onClick={async () => setNotificationPermission(await requestFinanceNotifications())}
                title="Enable local budget and month-start alerts"
                type="button"
              >
                Enable alerts
              </button>
            )}
            <button
              aria-label="Download complete financial summary PDF"
              className="report-button"
              disabled={
                reportStatus === "generating" ||
                !reportDashboard.data ||
                !accounts.data ||
                !liabilities.data ||
                !wealth.data
              }
              onClick={downloadSummary}
              title="Download complete financial summary PDF"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4" />
              </svg>
              <span>{reportStatus === "generating" ? "Building PDF" : "PDF summary"}</span>
            </button>
            {!isInstalled && (
              <button className="install-button" onClick={installApp} type="button">
                Install app
              </button>
            )}
            <button className="add-button" onClick={openExpenses} type="button">
              + Add expense
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

        {reportStatus === "error" && (
          <section aria-live="assertive" className="report-error" role="alert">
            The PDF could not be generated. Your financial data was not sent anywhere. Please try again.
            <button onClick={() => setReportStatus("idle")} type="button">
              Dismiss
            </button>
          </section>
        )}

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
              <strong>The encrypted financial data could not be loaded.</strong> Check that the local API is running.
            </p>
          </section>
        ) : activeNav === "Home" ? (
          <DashboardView
            dataCutoffMonth={ACTIVE_MONTH}
            dashboard={dashboard.data}
            expenseYear={expenseYear.data}
            liabilities={liabilities.data}
            loading={dashboard.isLoading || liabilities.isLoading || wealth.isLoading}
            money={money}
            onOpenExpenses={openExpenses}
            onOpenLiabilities={() => navigate("Liabilities")}
            onOpenGoals={() => navigate("Goals")}
            wealth={wealth.data}
          />
        ) : activeNav === "Expenses" ? (
          <ExpensesView
            budget={budget.data}
            budgetLoading={budget.isLoading}
            dataCutoffMonth={ACTIVE_MONTH}
            loading={expenseYear.isLoading || dashboard.isLoading}
            money={money}
            onSelectMonth={(month) => navigate("Expenses", month, month.slice(0, 4))}
            onYearChange={changeExpenseYear}
            selectedDashboard={dashboard.data}
            selectedMonth={selectedMonth}
            year={year}
            yearData={expenseYear.data}
          />
        ) : activeNav === "Imports" ? (
          <ImportsView
            data={imports.data}
            loading={imports.isLoading || referenceData.isLoading}
            money={money}
            referenceData={referenceData.data}
          />
        ) : activeNav === "Accounts" ? (
          <AccountsView
            data={accounts.data}
            loading={accounts.isLoading || wealth.isLoading || homeConstruction.isLoading}
            money={money}
            onOpenExpenses={() => navigate("Expenses")}
            onOpenGoals={() => navigate("Goals")}
            onOpenLiabilities={() => navigate("Liabilities")}
            onOpenProjects={() => navigate("Projects")}
            project={homeConstruction.data}
            wealth={wealth.data}
          />
        ) : activeNav === "Liabilities" ? (
          <LiabilitiesView
            data={liabilities.data}
            loading={liabilities.isLoading}
            money={money}
            month={selectedMonth}
          />
        ) : activeNav === "Goals" ? (
          <GoalsView
            dashboard={dashboard.data}
            data={wealth.data}
            liabilities={liabilities.data}
            loading={wealth.isLoading || dashboard.isLoading || liabilities.isLoading}
            money={money}
          />
        ) : activeNav === "Forecasts" ? (
          <ForecastsView
            dashboard={dashboard.data}
            homeConstruction={homeConstruction.data}
            liabilities={liabilities.data}
            loading={dashboard.isLoading || liabilities.isLoading || wealth.isLoading || homeConstruction.isLoading}
            money={money}
            month={selectedMonth}
            onOpenBudget={() => navigate("Expenses")}
            wealth={wealth.data}
          />
        ) : activeNav === "Projects" ? (
          <ProjectsView
            data={homeConstruction.data}
            loading={homeConstruction.isLoading || referenceData.isLoading}
            money={money}
            referenceData={referenceData.data}
          />
        ) : (
          <section className="panel feature-placeholder">
            <p className="eyebrow">MODULE BOUNDARY READY</p>
            <h2>{activeNav} is the next vertical slice.</h2>
            <p>The accounting engine and opening snapshot are live. This tracker uses the same encrypted database.</p>
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
        {(["Home", "Accounts", "Expenses", "Imports", "Liabilities", "Goals", "Forecasts", "Projects"] as const).map(
          (item) => (
            <button
              className={activeNav === item ? "active" : ""}
              key={item}
              onClick={() => navigate(item)}
              type="button"
            >
              {item}
            </button>
          ),
        )}
      </nav>
      <FinanceAssistant context={{ page: navSlugs[activeNav], month: selectedMonth }} status={assistantStatus.data} />
    </div>
  );
}
